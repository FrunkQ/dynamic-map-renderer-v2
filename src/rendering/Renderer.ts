import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FogCompositor } from './FogCompositor.ts';
import { buildShaderObject, updateUniforms } from './ShaderMaterial.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import type { FilterDefinition } from '../filters/schema.ts';
import type { FilterParamValues, FilterState, FogState, ViewState } from '../types.ts';

/**
 * Renderer
 *
 * Architecture:
 *   Scene (all layers, rendered by RenderPass):
 *     Plane 0 — Map:     base image texture
 *     Plane 1 — Fog:     CanvasTexture from FogCompositor (transparent, blended over map)
 *     Plane 2 — Markers: stub mesh, empty until markers feature is built
 *
 *   EffectComposer:
 *     RenderPass  → renders the scene to a render target
 *     ShaderPass  → applies the active filter GLSL to the whole composited image
 *
 *   GM Overlay (separate scene, rendered AFTER composer — never filtered):
 *     Fog drawing handles, polygon selection outlines, etc.
 *     Only shown when gmOverlayEnabled = true.
 *
 * This means ALL layers (including future markers and lighting) receive the
 * filter effect correctly since the shader sees one composited image.
 */
export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene:    THREE.Scene;
  private gmScene:  THREE.Scene;  // GM overlay — bypasses filter
  private camera:   THREE.OrthographicCamera;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private shaderPass: ShaderPass | null = null;
  private resolution: THREE.Vector2;
  private clock = new THREE.Clock();

  // Layer meshes
  private mapMesh:     THREE.Mesh | null = null;
  private fogMesh:     THREE.Mesh | null = null;
  private mapTexture:  THREE.Texture | null = null;
  private fogCompositor: FogCompositor;

  // Current filter state (needed when filter changes)
  private activeFilter: FilterDefinition | null = null;

  private animFrameId: number | null = null;
  private gmOverlayEnabled = false;
  private aspectRatio = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);

    this.resolution = new THREE.Vector2(canvas.clientWidth, canvas.clientHeight);

    this.scene   = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.gmScene = new THREE.Scene();

    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 100);
    this.camera.position.set(0, 0, 10);

    this.fogCompositor = new FogCompositor(1024, 1024);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.setFilter({ filterId: 'none', params: {} });
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Load a new map from an ArrayBuffer; resizes fog compositor to match */
  loadMap(buffer: ArrayBuffer): void {
    const blob = new Blob([buffer]);
    const url  = URL.createObjectURL(blob);

    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => {
      URL.revokeObjectURL(url);

      if (this.mapTexture) this.mapTexture.dispose();
      tex.colorSpace = THREE.SRGBColorSpace;
      this.mapTexture = tex;

      const img = tex.image as HTMLImageElement;
      this.aspectRatio = img.naturalWidth / img.naturalHeight;
      this.fogCompositor.resize(img.naturalWidth, img.naturalHeight);

      this.rebuildLayerMeshes();
      this.updateCameraFrustum();
    });
  }

  updateFog(fog: FogState): void {
    this.fogCompositor.redraw(fog);
  }

  setFilter(filterState: FilterState): void {
    const filter = filterRegistry.getOrFallback(filterState.filterId);
    const defaults = filterRegistry.defaultParams(filter.id);
    const values = { ...defaults, ...(filterState.params[filter.id] ?? {}) };

    this.activeFilter = filter;

    const shaderObj = buildShaderObject(filter, values, this.resolution);

    if (this.shaderPass) {
      this.composer.removePass(this.shaderPass);
      this.shaderPass.dispose?.();
    }

    this.shaderPass = new ShaderPass(shaderObj);
    this.shaderPass.renderToScreen = true;
    this.composer.addPass(this.shaderPass);
  }

  updateFilterParams(filterId: string, values: FilterParamValues): void {
    if (!this.shaderPass || !this.activeFilter || this.activeFilter.id !== filterId) return;
    updateUniforms(this.shaderPass.uniforms, this.activeFilter, values);
  }

  setView(view: ViewState): void {
    // Convert normalised 0–1 center coords to world-space offset
    const hw = 0.5 / view.scale;
    const hh = hw / this.aspectRatio;

    const cx = (view.centerX - 0.5) * this.aspectRatio;
    const cy = -(view.centerY - 0.5);

    this.camera.left   = cx - hw;
    this.camera.right  = cx + hw;
    this.camera.top    = cy + hh;
    this.camera.bottom = cy - hh;
    this.camera.updateProjectionMatrix();
  }

  /** Enable GM overlay rendering (separate scene, no filter shader) */
  enableGMOverlay(): void {
    this.gmOverlayEnabled = true;
  }

  /** Add a mesh to the GM overlay scene (fog drawing tools, etc.) */
  addGMOverlayObject(obj: THREE.Object3D): void {
    this.gmScene.add(obj);
  }

  removeGMOverlayObject(obj: THREE.Object3D): void {
    this.gmScene.remove(obj);
  }

  start(): void {
    if (this.animFrameId !== null) return;
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      this.renderFrame();
    };
    loop();
  }

  stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  dispose(): void {
    this.stop();
    this.fogCompositor.dispose();
    this.mapTexture?.dispose();
    this.renderer.dispose();
    window.removeEventListener('resize', () => this.handleResize());
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private renderFrame(): void {
    const elapsed = this.clock.getElapsedTime();

    // Tick time uniform in active shader pass
    if (this.shaderPass?.uniforms['time']) {
      this.shaderPass.uniforms['time']!.value = elapsed;
    }

    // Render scene → composer → ShaderPass → screen
    this.renderer.clear();
    this.composer.render();

    // Render GM overlay on top (bypasses filter shader)
    if (this.gmOverlayEnabled) {
      this.renderer.render(this.gmScene, this.camera);
    }
  }

  private rebuildLayerMeshes(): void {
    // Remove existing layers
    if (this.mapMesh)  { this.scene.remove(this.mapMesh);  this.mapMesh = null; }
    if (this.fogMesh)  { this.scene.remove(this.fogMesh);  this.fogMesh = null; }

    const geo = new THREE.PlaneGeometry(this.aspectRatio, 1);

    // Map layer
    const mapMat = new THREE.MeshBasicMaterial({
      map: this.mapTexture!,
      depthWrite: false,
    });
    this.mapMesh = new THREE.Mesh(geo, mapMat);
    this.mapMesh.position.z = 0;
    this.scene.add(this.mapMesh);

    // Fog layer — transparent, composited on top
    const fogMat = new THREE.MeshBasicMaterial({
      map: this.fogCompositor.texture,
      transparent: true,
      depthWrite: false,
    });
    this.fogMesh = new THREE.Mesh(geo, fogMat);
    this.fogMesh.position.z = 0.01;  // Slightly in front of map
    this.scene.add(this.fogMesh);

    // Marker layer stub (Plane 2) — added here so render order is established
    // Populated by MarkerLayer when that feature is built
  }

  private handleResize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (canvas.width !== w || canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      this.composer.setSize(w, h);
    }

    this.resolution.set(w, h);
    if (this.shaderPass?.uniforms['resolution']) {
      this.shaderPass.uniforms['resolution']!.value.set(w, h);
    }

    this.updateCameraFrustum();
  }

  private updateCameraFrustum(): void {
    const canvas = this.renderer.domElement;
    const screenAspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);

    // Default view: fit the map plane in screen (letterbox / pillarbox as needed)
    const mapAspect = this.aspectRatio;
    let hw: number, hh: number;

    if (screenAspect > mapAspect) {
      // Screen wider than map — pillarbox
      hh = 0.5;
      hw = hh * screenAspect;
    } else {
      // Screen taller than map — letterbox
      hw = mapAspect * 0.5;
      hh = hw / screenAspect;
    }

    this.camera.left   = -hw;
    this.camera.right  =  hw;
    this.camera.top    =  hh;
    this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
  }
}
