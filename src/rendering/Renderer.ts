import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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
  private outputPass: OutputPass;
  private resolution: THREE.Vector2;
  private startTime = performance.now();

  // Layer meshes
  private mapMesh:      THREE.Mesh | null = null;
  private fogMesh:      THREE.Mesh | null = null;
  private mapTexture:   THREE.Texture | null = null;
  private fogCompositor: FogCompositor;

  // GM overlay — map border line (inverted background colour)
  private mapBorderLine: THREE.Line | null = null;
  private mapBorderMat:  THREE.LineBasicMaterial | null = null;

  // Current filter state (needed when filter changes)
  private activeFilter: FilterDefinition | null = null;

  private animFrameId: number | null = null;
  private gmOverlayEnabled = false;
  private filterEnabled = true;
  private aspectRatio = 1;
  private fogOpacity = 1.0;
  /**
   * Dirty flag: when true the next animation frame will render.
   * Set to true on any state change (map, fog, view, filter, resize).
   * Cleared after each render so static filters only render once per change
   * instead of burning GPU at 60 fps doing identical work.
   */
  private needsRender = true;
  /** True only for filters that visibly animate via the time uniform. */
  private isAnimatedFilter = false;
  private lastFogState: FogState = { polygons: [] };
  /** Incremented on every loadMap call; callbacks check against this to discard stale loads */
  private loadGen = 0;

  /** Called once the map texture has loaded and aspectRatio is known. */
  onMapLoaded: ((aspectRatio: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);

    // Placeholder; handleResize() (called below) sets the correct physical-pixel value.
    this.resolution = new THREE.Vector2(
      canvas.clientWidth  * window.devicePixelRatio,
      canvas.clientHeight * window.devicePixelRatio
    );

    this.scene   = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.gmScene = new THREE.Scene();

    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 100);
    this.camera.position.set(0, 0, 10);

    this.fogCompositor = new FogCompositor(1024, 1024);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // OutputPass is always the final step — it applies renderer.outputColorSpace
    // (SRGBColorSpace by default in Three.js r152+) to the composed image.
    // Without it, custom ShaderMaterial passes bypass Three.js's automatic
    // colorspace_fragment injection, so the output stays in linear space and
    // appears noticeably darker than the GM's direct-render view.
    // setFilter() removes and re-appends this pass so it stays last whenever
    // the active filter changes.
    this.outputPass = new OutputPass();

    this.setFilter({ filterId: 'none', params: {} });
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Load a new map from an ArrayBuffer; resizes fog compositor to match.
   *
   * `fog` — the fog state for this map. Stored immediately so the async
   * texture callback always redraws the correct fog regardless of how many
   * further loadMap calls may have started in the meantime.
   *
   * A generation counter ensures that only the LATEST call's callback applies
   * state. Any in-flight texture decode from a previous loadMap call is
   * silently discarded when it eventually completes.
   */
  loadMap(buffer: ArrayBuffer, fog?: FogState): void {
    const gen = ++this.loadGen;

    // Lock in the fog for this load immediately — before the async decode.
    // This prevents a rapid second loadMap from clobbering lastFogState with
    // its own fog before this callback fires.
    if (fog !== undefined) {
      this.lastFogState = fog;
    }

    const blob = new Blob([buffer]);
    const url  = URL.createObjectURL(blob);

    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => {
      URL.revokeObjectURL(url);

      // Discard callbacks from superseded loads — the latest load already won.
      if (gen !== this.loadGen) {
        tex.dispose();
        return;
      }

      if (this.mapTexture) this.mapTexture.dispose();
      tex.colorSpace = THREE.SRGBColorSpace;
      this.mapTexture = tex;

      const img = tex.image as HTMLImageElement;
      this.aspectRatio = img.naturalWidth / img.naturalHeight;

      // Recreate the FogCompositor for every map load.
      //
      // Re-using the same CanvasTexture after the OffscreenCanvas is resized
      // triggers "glCopySubTextureCHROMIUM: Offset overflows texture dimensions"
      // in Chrome whenever the new map is larger than the previous one: WebGL
      // already allocated a texture at the old size, so the larger canvas upload
      // exceeds its bounds and the GPU texture is left with the old fog data.
      //
      // A fresh compositor creates a new OffscreenCanvas AND a new CanvasTexture,
      // so Three.js allocates a correctly-sized GPU texture from scratch.
      // rebuildLayerMeshes() always reads this.fogCompositor.texture, so it
      // automatically picks up the new texture without extra wiring.
      //
      // The fog canvas is fixed at 1024×1024 regardless of map resolution.
      // Fog vertices are stored in 0–1 normalised coords relative to the map;
      // the plane geometry UV mapping stretches the square canvas to the map's
      // actual aspect ratio, so polygon positions are always correct.
      this.fogCompositor.dispose();
      this.fogCompositor = new FogCompositor(1024, 1024);
      this.fogCompositor.redraw(this.lastFogState);

      this.rebuildLayerMeshes();
      this.updateCameraFrustum();
      this.needsRender = true;
      this.onMapLoaded?.(this.aspectRatio);
    });
  }

  updateFog(fog: FogState): void {
    this.lastFogState = fog;
    this.fogCompositor.redraw(fog);
    this.needsRender = true;
  }

  /**
   * Immediately clear the fog compositor.
   * Called at the start of a map switch so the old map's fog is never visible on the new map.
   * lastFogState is set to empty; loadMap() will override it once the correct state is known.
   */
  clearFog(): void {
    this.lastFogState = { polygons: [] };
    this.fogCompositor.redraw({ polygons: [] });
    this.needsRender = true;
  }

  setFilter(filterState: FilterState): void {
    const filter = filterRegistry.getOrFallback(filterState.filterId);
    const defaults = filterRegistry.defaultParams(filter.id);
    const values = { ...defaults, ...(filterState.params[filter.id] ?? {}) };

    this.activeFilter = filter;
    this.isAnimatedFilter = filter.animated ?? false;
    this.needsRender = true;

    const shaderObj = buildShaderObject(filter, values, this.resolution);

    if (this.shaderPass) {
      this.composer.removePass(this.shaderPass);
      this.shaderPass.dispose?.();
    }
    // Always remove OutputPass before adding the new ShaderPass so it can be
    // re-appended afterwards — EffectComposer executes passes in insertion order.
    this.composer.removePass(this.outputPass);

    this.shaderPass = new ShaderPass(shaderObj);
    // renderToScreen stays false (default) — OutputPass is the final output.
    this.composer.addPass(this.shaderPass);
    this.composer.addPass(this.outputPass);
  }

  updateFilterParams(filterId: string, values: FilterParamValues): void {
    if (!this.shaderPass || !this.activeFilter || this.activeFilter.id !== filterId) return;
    updateUniforms(this.shaderPass.uniforms, this.activeFilter, values);
    this.needsRender = true;
  }

  /** Apply the background colour without touching the camera — used by the GM renderer */
  setBackgroundColour(colour: string): void {
    (this.scene.background as THREE.Color).set(colour);
    this.renderer.setClearColor(new THREE.Color(colour), 1);
    // Keep the GM map border colour in sync (inverted background)
    if (this.mapBorderMat) {
      this.mapBorderMat.color.set(this.invertColour(colour));
    }
    this.needsRender = true;
  }

  setView(view: ViewState): void {
    this.needsRender = true;
    this.setBackgroundColour(view.backgroundColor ?? '#000000');

    // Base frustum at scale=1: fit the whole map on screen — same formula as
    // updateCameraFrustum so that broadcasting the default view does not visibly
    // change the player camera (previously setView ignored screenAspect, causing
    // a jarring resize whenever any view_update arrived).
    const canvas = this.renderer.domElement;
    const screenAspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    const mapAspect = this.aspectRatio;
    let hwBase: number, hhBase: number;
    if (screenAspect > mapAspect) {
      hhBase = 0.5;
      hwBase = hhBase * screenAspect;
    } else {
      hwBase = mapAspect * 0.5;
      hhBase = hwBase / screenAspect;
    }

    const hw = hwBase / view.scale;
    const hh = hhBase / view.scale;

    const cx = (view.centerX - 0.5) * mapAspect;
    const cy = -(view.centerY - 0.5);

    this.camera.left   = cx - hw;
    this.camera.right  = cx + hw;
    this.camera.top    = cy + hh;
    this.camera.bottom = cy - hh;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Disable the post-processing filter for the GM view.
   * GM sees the raw composited scene without any shader effects —
   * they need an uncluttered view for fog drawing and map management.
   * Effects are only applied on the player renderer.
   */
  setFilterEnabled(enabled: boolean): void {
    this.filterEnabled = enabled;
  }

  /** Enable GM overlay rendering (separate scene, no filter shader) */
  enableGMOverlay(): void {
    this.gmOverlayEnabled = true;
  }

  /** Set the opacity of the fog mesh — 1.0 for players, lower for GM so the map shows through */
  setFogOpacity(opacity: number): void {
    this.fogOpacity = opacity;
    if (this.fogMesh) {
      (this.fogMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  /** Add a mesh to the GM overlay scene (fog drawing tools, etc.) */
  addGMOverlayObject(obj: THREE.Object3D): void {
    this.gmScene.add(obj);
    this.needsRender = true;
  }

  removeGMOverlayObject(obj: THREE.Object3D): void {
    this.gmScene.remove(obj);
    this.needsRender = true;
  }

  /** Force a re-render on the next animation frame.
   *  Call this whenever the GM overlay changes (fog drawing, selection, etc.)
   *  without going through one of the typed state-change methods above. */
  markDirty(): void {
    this.needsRender = true;
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
    this.mapBorderLine?.geometry.dispose();
    this.mapBorderMat?.dispose();
    this.outputPass.dispose();
    this.renderer.dispose();
    window.removeEventListener('resize', () => this.handleResize());
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private renderFrame(): void {
    // Skip rendering if nothing has changed and the active filter doesn't animate.
    // This prevents expensive shaders (ballpoint, watercolour, etc.) from running
    // at 60 fps when the scene is completely static.
    if (!this.needsRender && !this.isAnimatedFilter) return;
    this.needsRender = false;

    const elapsed = (performance.now() - this.startTime) / 1000;

    // Tick time uniform only for animated filters (no-op for static ones)
    if (this.shaderPass?.uniforms['time']) {
      this.shaderPass.uniforms['time']!.value = elapsed;
    }

    this.renderer.clear();

    if (this.filterEnabled) {
      // Player mode: full EffectComposer pipeline — scene → RenderPass → ShaderPass → screen
      this.composer.render();
    } else {
      // GM mode: render scene directly, no post-processing shader
      // GM needs a clean, unfiltered view for fog drawing and map management
      this.renderer.render(this.scene, this.camera);
    }

    // GM overlay always renders on top of whichever mode, bypassing filter
    if (this.gmOverlayEnabled) {
      this.renderer.render(this.gmScene, this.camera);
    }
  }

  private rebuildLayerMeshes(): void {
    // Remove existing layers
    if (this.mapMesh)  { this.scene.remove(this.mapMesh);  this.mapMesh = null; }
    if (this.fogMesh)  { this.scene.remove(this.fogMesh);  this.fogMesh = null; }

    // Remove previous border from gmScene
    if (this.mapBorderLine) {
      this.gmScene.remove(this.mapBorderLine);
      this.mapBorderLine.geometry.dispose();
      this.mapBorderLine = null;
    }
    if (this.mapBorderMat) {
      this.mapBorderMat.dispose();
      this.mapBorderMat = null;
    }

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
      opacity: this.fogOpacity,
    });
    this.fogMesh = new THREE.Mesh(geo, fogMat);
    this.fogMesh.position.z = 0.01;  // Slightly in front of map
    this.scene.add(this.fogMesh);

    // GM overlay — 1px border around the map edge so it reads against any background
    const hw = this.aspectRatio / 2;
    const hh = 0.5;
    const borderPts = new Float32Array([
      -hw, -hh, 0.02,
       hw, -hh, 0.02,
       hw,  hh, 0.02,
      -hw,  hh, 0.02,
      -hw, -hh, 0.02,   // close rectangle
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(borderPts, 3));
    const bgColour = (this.scene.background as THREE.Color).getHexString();
    this.mapBorderMat = new THREE.LineBasicMaterial({
      color: this.invertColour('#' + bgColour),
    });
    this.mapBorderLine = new THREE.Line(borderGeo, this.mapBorderMat);
    this.gmScene.add(this.mapBorderLine);

    // Marker layer stub (Plane 2) — added here so render order is established
    // Populated by MarkerLayer when that feature is built
  }

  private invertColour(hex: string): string {
    const c = new THREE.Color(hex);
    const r = (255 - Math.round(c.r * 255)).toString(16).padStart(2, '0');
    const g = (255 - Math.round(c.g * 255)).toString(16).padStart(2, '0');
    const b = (255 - Math.round(c.b * 255)).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  private handleResize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // setSize honours the pixelRatio set in the constructor, so the actual
    // framebuffer becomes w*dpr × h*dpr.  Always call it so canvas.width/height
    // are authoritative physical-pixel values we can rely on below.
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);

    // resolution must be in *physical* pixels to match gl_FragCoord.xy.
    // clientWidth/clientHeight are CSS pixels; canvas.width/height are the
    // real framebuffer dimensions after setSize applies devicePixelRatio.
    const pw = canvas.width;
    const ph = canvas.height;
    this.resolution.set(pw, ph);
    if (this.shaderPass?.uniforms['resolution']) {
      this.shaderPass.uniforms['resolution']!.value.set(pw, ph);
    }

    this.updateCameraFrustum();
    this.needsRender = true;
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
