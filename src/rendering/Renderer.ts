import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FogCompositor } from './FogCompositor.ts';
import { MapFXCompositor } from './MapFXCompositor.ts';
import { buildShaderObject, updateUniforms } from './ShaderMaterial.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import type { FilterDefinition } from '../filters/schema.ts';
import type { FilterParamValues, FilterState, FogState, ViewState, MapFXEntity } from '../types.ts';

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
  /**
   * Clip pass — placed between the filter shader and OutputPass.
   * Replaces pixels outside the GM-defined viewport rectangle with the
   * background colour, so the player can never see map content the GM
   * hasn't revealed regardless of screen aspect ratio.
   * Defaults to full pass-through (uRect = 0,0,1,1) until setView() fires.
   */
  private clipPass!: ShaderPass;
  private resolution: THREE.Vector2;
  private startTime = performance.now();

  // Layer meshes
  private mapMesh:      THREE.Mesh | null = null;
  private mapFXMesh:    THREE.Mesh | null = null; // v2.12/M4
  private fogMesh:      THREE.Mesh | null = null;
  private mapTexture:   THREE.Texture | null = null;
  private fogCompositor: FogCompositor;
  private mapFXCompositor: MapFXCompositor;  // v2.12/M4

  // Marker layer split as of v2.10.29:
  //   - Motion overlay (return blobs, scan rings) → single shared OffscreenCanvas
  //     fed by MarkerTexture, attached as `markerMesh` at z=0.015.
  //   - Marker icons themselves → per-marker THREE.Mesh group, attached via
  //     setMarkerSpriteGroup() at z=0.02 (above motion blobs, so a marker
  //     token sits on top of its own return blob).
  private markerCanvas: OffscreenCanvas | null = null;
  private markerTex:    THREE.CanvasTexture | null = null;
  private markerMesh:   THREE.Mesh | null = null;
  private markerSpriteGroup: THREE.Object3D | null = null;

  // GM overlay — map border line (inverted background colour)
  private mapBorderLine: THREE.Line | null = null;
  private mapBorderMat:  THREE.LineBasicMaterial | null = null;

  // Current filter state (needed when filter changes)
  private activeFilter: FilterDefinition | null = null;

  private animFrameId: number | null = null;
  private gmOverlayEnabled = false;
  private filterEnabled = true;
  private aspectRatio = 1;
  /** Read-only map aspect ratio (width / height). Set when a map loads. */
  get mapAspect(): number { return this.aspectRatio; }
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
  /** Last view state set by setView(); null means "show full map" (GM mode or no view set yet). */
  private currentView: ViewState | null = null;

  /** Called once the map texture has loaded and aspectRatio is known. */
  onMapLoaded: ((aspectRatio: number) => void) | null = null;
  /** Fired when the WebGL context is lost (GPU reclaimed by OS/browser). */
  onContextLost: (() => void) | null = null;
  /** Fired when the WebGL context has been restored and is ready to use again. */
  onContextRestored: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, options?: { preserveDrawingBuffer?: boolean }) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      // Player renderer needs preserveDrawingBuffer: true so createImageBitmap()
      // can snapshot the canvas for transition animations outside the rAF loop.
      preserveDrawingBuffer: options?.preserveDrawingBuffer ?? false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);

    // Allow the browser to auto-restore a lost context; fire callbacks so the
    // player app can re-feed cached state rather than showing a black screen.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.onContextRestored?.();
    });

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
    this.mapFXCompositor = new MapFXCompositor(1024, 1024);

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

    this.clipPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uRect:    { value: new THREE.Vector4(0, 0, 1, 1) }, // x1,y1,x2,y2 UV space
        uBgColor: { value: new THREE.Vector3(0, 0, 0) },    // linear sRGB
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec4 uRect;
        uniform vec3 uBgColor;
        varying vec2 vUv;
        void main() {
          if (vUv.x < uRect.x || vUv.x > uRect.z ||
              vUv.y < uRect.y || vUv.y > uRect.w)
            gl_FragColor = vec4(uBgColor, 1.0);
          else
            gl_FragColor = texture2D(tDiffuse, vUv);
        }`,
    });

    this.setFilter({ filterId: 'none', params: {} });

    // ResizeObserver fires whenever the canvas element changes size — including
    // the first time it gets non-zero dimensions after the initial layout.  This
    // is more reliable than window.resize on mobile (Android Chrome, iOS Safari)
    // where window.resize only fires on orientation changes, not on initial layout.
    // On desktop it behaves identically to the old window.resize listener.
    new ResizeObserver(() => this.handleResize()).observe(canvas);
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
  loadMap(buffer: ArrayBuffer, fog?: FogState): Promise<void> {
    const gen = ++this.loadGen;

    // Lock in the fog for this load immediately — before the async decode.
    // This prevents a rapid second loadMap from clobbering lastFogState with
    // its own fog before this callback fires.
    if (fog !== undefined) {
      this.lastFogState = fog;
    }

    const blob = new Blob([buffer]);
    const url  = URL.createObjectURL(blob);

    return new Promise<void>((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.load(url, (tex) => {
        URL.revokeObjectURL(url);

        // Discard callbacks from superseded loads — the latest load already won.
        // Still resolve so any awaiting transition animation can proceed.
        if (gen !== this.loadGen) {
          tex.dispose();
          resolve();
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
        this.mapFXCompositor.dispose();
        this.mapFXCompositor = new MapFXCompositor(1024, 1024);

        this.rebuildLayerMeshes();
        this.refreshCamera();
        this.needsRender = true;
        this.onMapLoaded?.(this.aspectRatio);
        resolve();
      }, undefined, (_err) => {
        URL.revokeObjectURL(url);
        resolve(); // failed load — don't block the transition
      });
    });
  }

  updateFog(fog: FogState): void {
    this.lastFogState = fog;
    this.fogCompositor.redraw(fog);
    // The brush snapshot (alpha PNG) only arrives via this path on map_change /
    // full_state; live strokes call applyFogBrushStroke instead. Decode async
    // so the polygon redraw doesn't block on PNG decode — the brush layer
    // re-composites itself once setBrushSnapshot lands.
    void this._applyBrushSnapshot(fog.brush);
    this.needsRender = true;
  }

  /** Replace the in-memory FoW brush bitmap from a base64 PNG. Pass an empty
   *  string / undefined to clear. Fire-and-forget — caller doesn't await. */
  private async _applyBrushSnapshot(base64Png: string | undefined): Promise<void> {
    if (!base64Png) {
      this.fogCompositor.clearBrush();
      this.fogCompositor.redraw(this.lastFogState);
      this.needsRender = true;
      return;
    }
    try {
      const img = await this._decodePng(base64Png);
      this.fogCompositor.setBrushSnapshot(img);
      this.fogCompositor.redraw(this.lastFogState);
      this.needsRender = true;
    } catch { /* malformed snapshot — leave brush layer untouched */ }
  }

  /** Live FoW brush stroke — paints directly into the brush canvas and
   *  re-composites without touching the polygons. Caller is responsible
   *  for broadcasting the stroke to players. */
  applyFogBrushStroke(stroke: { points: { x: number; y: number }[]; radius: number; mode: 'paint' | 'erase'; color: string }): void {
    this.fogCompositor.applyBrushStroke(stroke);
    this.fogCompositor.redraw(this.lastFogState);
    this.needsRender = true;
  }

  /** Wipe the FoW brush canvas. */
  clearFogBrush(): void {
    this.fogCompositor.clearBrush();
    this.fogCompositor.redraw(this.lastFogState);
    this.needsRender = true;
  }

  /** Export the current FoW brush layer as base64 PNG. Used by the GM when
   *  persisting state / broadcasting a full snapshot. */
  exportFogBrush(): Promise<string | null> {
    return this.fogCompositor.exportBrushPng();
  }

  // ─── v2.12/M4 — MapFX entities ───────────────────────────────────────────

  /** Push the latest MapFX state into the compositor and trigger a redraw.
   *  Patch decode is async (PNGs) — texture refresh runs after it. */
  async updateMapFX(entities: MapFXEntity[], selectedId: string | null): Promise<void> {
    await this.mapFXCompositor.syncPatches(entities);
    this.mapFXCompositor.redraw(entities, selectedId);
    this.needsRender = true;
  }

  /** Clear the MapFX layer entirely. */
  clearMapFX(): void {
    this.mapFXCompositor.clear();
    this.needsRender = true;
  }

  private _decodePng(base64Png: string): Promise<ImageBitmap | HTMLImageElement> {
    const url = base64Png.startsWith('data:') ? base64Png : `data:image/png;base64,${base64Png}`;
    if (typeof Image !== 'undefined') {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    }
    return fetch(url).then((r) => r.blob()).then(createImageBitmap);
  }

  /**
   * Immediately clear the fog compositor.
   * Called at the start of a map switch so the old map's fog is never visible on the new map.
   * lastFogState is set to empty; loadMap() will override it once the correct state is known.
   */
  clearFog(): void {
    this.lastFogState = { polygons: [] };
    this.fogCompositor.redraw({ polygons: [] });
    this.fogCompositor.clearBrush();
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
    // Remove clip + output before rebuilding so insertion order is always:
    //   RenderPass → clipPass → filter ShaderPass → OutputPass
    // Clip runs first so the filter sees the complete frame (map + solid
    // background bars) and applies its effect uniformly across everything.
    this.composer.removePass(this.clipPass);
    this.composer.removePass(this.outputPass);

    this.shaderPass = new ShaderPass(shaderObj);
    this.composer.addPass(this.clipPass);    // clip viewport → fill bars with bg
    this.composer.addPass(this.shaderPass); // filter sees full frame incl. bars
    this.composer.addPass(this.outputPass); // SRGB conversion last
  }

  updateFilterParams(filterId: string, values: FilterParamValues): void {
    if (!this.shaderPass || !this.activeFilter || this.activeFilter.id !== filterId) return;
    updateUniforms(this.shaderPass.uniforms, this.activeFilter, values);
    this.needsRender = true;
  }

  /** Apply the background colour without touching the camera — used by the GM renderer */
  setBackgroundColour(colour: string): void {
    const c = new THREE.Color(colour);
    (this.scene.background as THREE.Color).copy(c);
    this.renderer.setClearColor(c, 1);
    // Keep the GM map border colour in sync (inverted background)
    if (this.mapBorderMat) {
      this.mapBorderMat.color.set(this.invertColour(colour));
    }
    // Keep clip-pass background colour in sync (linear Three.js values match
    // scene rendering before OutputPass applies SRGB conversion)
    this.clipPass.uniforms['uBgColor']!.value.set(c.r, c.g, c.b);
    this.needsRender = true;
  }

  setView(view: ViewState): void {
    this.currentView = { ...view };
    this.needsRender = true;
    this.setBackgroundColour(view.backgroundColor ?? '#000000');

    // The map plane occupies width=mapAspect, height=1 in Three.js world units.
    // viewNW/viewNH define the visible fraction of the map in each axis —
    // independent of either the GM's or the player's screen shape.
    const canvas    = this.renderer.domElement;
    const cw        = canvas.clientWidth;
    const ch        = canvas.clientHeight;

    // Canvas not yet laid out (mobile initial paint) — store currentView so
    // refreshCamera() can re-apply it once the ResizeObserver fires with real
    // dimensions.  Do not attempt camera/clip math with zero dimensions.
    if (cw === 0 || ch === 0) return;

    const sa        = cw / ch;
    const ma        = this.aspectRatio;

    // Viewport half-extents in world units
    const hw_vp = (view.viewNW / 2) * ma;
    const hh_vp =  view.viewNH / 2;

    // Fit the viewport rectangle into the player's screen, letterboxing /
    // pillarboxing as needed based on the player's own aspect ratio.
    const va = hw_vp / Math.max(hh_vp, 0.0001);  // viewport aspect ratio
    let hw: number, hh: number;
    if (sa > va) {
      // Player screen wider than viewport — pillarbox
      hh = hh_vp;
      hw = hh * sa;
    } else {
      // Player screen taller than viewport — letterbox
      hw = hw_vp;
      hh = hw / sa;
    }

    const cx = (view.centerX - 0.5) * ma;
    const cy = -(view.centerY - 0.5);

    this.camera.left   = cx - hw;
    this.camera.right  = cx + hw;
    this.camera.top    = cy + hh;
    this.camera.bottom = cy - hh;
    this.camera.updateProjectionMatrix();

    // Compute where the viewport rectangle sits in UV space on the player's screen
    // and update the clip pass so pixels outside it are filled with background.
    // sa > va → wide screen, viewport fills full height, bars left/right
    // sa < va → tall screen, viewport fills full width, bars top/bottom
    let x1 = 0, y1 = 0, x2 = 1, y2 = 1;
    if (sa > va) {
      x1 = (1 - va / sa) / 2;
      x2 = 1 - x1;
    } else if (sa < va) {
      y1 = (1 - sa / va) / 2;
      y2 = 1 - y1;
    }
    this.clipPass.uniforms['uRect']!.value.set(x1, y1, x2, y2);
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

  /**
   * Give the renderer an OffscreenCanvas whose contents should be composited
   * as the motion-overlay layer (return blobs, scan rings), subject to
   * filters. Pass null to remove.
   */
  setMarkerCanvas(canvas: OffscreenCanvas | null): void {
    this.markerCanvas = canvas;
    if (this.mapMesh) this._rebuildMarkerMesh();
    else this.needsRender = true;
  }

  /**
   * Attach (or remove) the marker-sprite group built by MarkerSprites.
   * Each child is its own THREE.Mesh + CanvasTexture sized to the marker's
   * pixel needs, so quality scales with marker size and DPR independent
   * of the motion-overlay canvas.
   */
  setMarkerSpriteGroup(group: THREE.Object3D | null): void {
    if (this.markerSpriteGroup && this.markerSpriteGroup !== group) {
      this.scene.remove(this.markerSpriteGroup);
    }
    this.markerSpriteGroup = group;
    if (group && !group.parent) this.scene.add(group);
    this.needsRender = true;
  }

  /** Call after re-rendering the motion-overlay canvas to upload to GPU. */
  markMarkersDirty(): void {
    if (this.markerTex) this.markerTex.needsUpdate = true;
    this.needsRender = true;
  }

  /**
   * Project a world coordinate to a CSS-pixel coordinate on the canvas
   * (relative to canvas top-left). Used by the screen-space marker
   * overlay to position labels above the WebGL view.
   *
   * Returns null when the canvas isn't laid out yet (zero dims).
   */
  private _projVec = new THREE.Vector3();
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } | null {
    const canvas = this.renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this._projVec.set(worldX, worldY, 0);
    this._projVec.project(this.camera);
    return {
      x: (this._projVec.x + 1) / 2 * rect.width,
      y: (1 - this._projVec.y) / 2 * rect.height,
    };
  }

  /**
   * CSS pixels per world-unit on each axis at the current camera + canvas
   * size. Used by the marker overlay to convert icon half-extents
   * (expressed in world units) to screen px for handle positioning.
   * Accounts for camera.zoom — denser pixels-per-world when zoomed in.
   */
  worldToScreenScale(): { pxPerWorldX: number; pxPerWorldY: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { pxPerWorldX: 0, pxPerWorldY: 0 };
    const zoom = this.camera.zoom || 1;
    return {
      pxPerWorldX: rect.width  * zoom / Math.max(0.0001, this.camera.right - this.camera.left),
      pxPerWorldY: rect.height * zoom / Math.max(0.0001, this.camera.top   - this.camera.bottom),
    };
  }

  /**
   * Inverse of worldToScreen — a CSS-pixel coord (relative to canvas
   * top-left) → world coord using the current camera. The GM-side editors
   * use this to map clicks back into world / map-normalised space when the
   * camera has been panned / zoomed away from the default fit.
   */
  screenToWorld(cssX: number, cssY: number): { x: number; y: number } | null {
    const canvas = this.renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndcX = (cssX / rect.width)  * 2 - 1;
    const ndcY = -((cssY / rect.height) * 2 - 1);
    this._projVec.set(ndcX, ndcY, 0);
    this._projVec.unproject(this.camera);
    return { x: this._projVec.x, y: this._projVec.y };
  }

  /**
   * Drive the orthographic camera from a pan/zoom transform. Scale maps to
   * camera.zoom (1 = identity, larger zooms in). Offsets map to
   * camera.position (world coord that sits at the canvas centre). The base
   * frustum (camera.left/right/top/bottom) is set by setView() or
   * updateCameraFrustum() and is NOT touched here — Three.js applies zoom
   * + position on top, so this method is safe to call alongside the
   * existing view-fit logic.
   */
  setCameraTransform(scale: number, offsetX: number, offsetY: number): void {
    this.camera.zoom       = Math.max(0.0001, scale);
    this.camera.position.x = offsetX;
    this.camera.position.y = offsetY;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  /**
   * Map-normalised coord (0..1 in each axis) → CSS-pixel coord on the
   * canvas, accounting for the current camera transform. The GM-side
   * editors (fog, viewport, projector-viewport, marker overlay) all use
   * this so their canvas drawing tracks the workspace pan/zoom without
   * each needing its own letterbox math.
   */
  mapNormToCanvasCss(mx: number, my: number): { x: number; y: number } | null {
    const wx =  (mx - 0.5) * this.aspectRatio;
    const wy = -(my - 0.5);
    return this.worldToScreen(wx, wy);
  }

  /**
   * Inverse: CSS-pixel canvas coord → map-normalised coord. Returns coords
   * outside [0,1] when the click landed in letterbox / off-map area; callers
   * that need clamping can apply their own.
   */
  canvasCssToMapNorm(cssX: number, cssY: number): { x: number; y: number } | null {
    const w = this.screenToWorld(cssX, cssY);
    if (!w) return null;
    return { x: w.x / this.aspectRatio + 0.5, y: -w.y + 0.5 };
  }

  // ─── Reveal-overlay (handout animation) ────────────────────────────────
  //
  // Sits as an extra plane mesh INSIDE the main scene (above the map +
  // fog + marker layers) so the EffectComposer post-effect filter runs
  // over its pixels too. The TransitionEngine paints the reveal
  // animation onto an offscreen canvas; the renderer pulls those
  // pixels into the WebGL pipeline via a CanvasTexture. This is the
  // architectural difference that puts "filter over both halves of the
  // reveal" within reach without rewriting every transition.

  private revealOverlayCanvas:  HTMLCanvasElement | null = null;
  private revealOverlayTexture: THREE.CanvasTexture | null = null;
  private revealOverlayMesh:    THREE.Mesh | null = null;
  private revealPumpId:         number | null = null;

  /** Begin a reveal-overlay pass. Returns an offscreen canvas the
   *  caller can paint to each frame. Adds a textured plane at z=0.03
   *  (above markers, below the GM border line). Starts a per-frame
   *  pump that marks the CanvasTexture dirty so canvas → GPU uploads
   *  happen automatically while the reveal animation runs. */
  beginRevealOverlay(width: number, height: number): HTMLCanvasElement {
    if (!this.revealOverlayCanvas) this.revealOverlayCanvas = document.createElement('canvas');
    this.revealOverlayCanvas.width  = Math.max(1, Math.round(width));
    this.revealOverlayCanvas.height = Math.max(1, Math.round(height));
    if (!this.revealOverlayTexture) {
      this.revealOverlayTexture = new THREE.CanvasTexture(this.revealOverlayCanvas);
      this.revealOverlayTexture.colorSpace = THREE.SRGBColorSpace;
      this.revealOverlayTexture.minFilter  = THREE.LinearFilter;
    } else {
      // CanvasTexture caches dimensions — force a fresh upload after
      // a resize so the GPU side matches.
      this.revealOverlayTexture.needsUpdate = true;
    }
    if (!this.revealOverlayMesh) {
      const geo = new THREE.PlaneGeometry(this.aspectRatio || 1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: this.revealOverlayTexture,
        transparent: true,
        depthWrite: false,
      });
      this.revealOverlayMesh = new THREE.Mesh(geo, mat);
      this.revealOverlayMesh.position.z = 0.03;
      this.scene.add(this.revealOverlayMesh);
    }
    // Per-frame pump — marks the texture dirty so the CanvasTexture
    // uploads the latest canvas pixels every render frame while the
    // reveal is in flight. Cheap; only runs while the mesh exists.
    const pump = (): void => {
      if (!this.revealOverlayMesh) {
        this.revealPumpId = null;
        return;
      }
      if (this.revealOverlayTexture) this.revealOverlayTexture.needsUpdate = true;
      this.needsRender = true;
      this.revealPumpId = requestAnimationFrame(pump);
    };
    if (this.revealPumpId === null) this.revealPumpId = requestAnimationFrame(pump);
    this.needsRender = true;
    return this.revealOverlayCanvas;
  }

  /** Tear down the reveal overlay. Mesh removed from scene; texture +
   *  canvas kept for the next beginRevealOverlay (cheaper than
   *  re-creating). The per-frame pump exits on its next tick. */
  endRevealOverlay(): void {
    if (this.revealOverlayMesh) {
      this.scene.remove(this.revealOverlayMesh);
      (this.revealOverlayMesh.material as THREE.Material).dispose();
      this.revealOverlayMesh.geometry.dispose();
      this.revealOverlayMesh = null;
    }
    if (this.revealPumpId !== null) {
      cancelAnimationFrame(this.revealPumpId);
      this.revealPumpId = null;
    }
    this.needsRender = true;
  }

  dispose(): void {
    this.stop();
    this.fogCompositor.dispose();
    this.mapFXCompositor.dispose();
    this.mapTexture?.dispose();
    this.markerTex?.dispose();
    this.mapBorderLine?.geometry.dispose();
    this.mapBorderMat?.dispose();
    this.outputPass.dispose();
    this.clipPass.dispose?.();
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
    if (this.mapMesh)    { this.scene.remove(this.mapMesh);    this.mapMesh = null; }
    if (this.mapFXMesh)  { this.scene.remove(this.mapFXMesh);  this.mapFXMesh = null; }
    if (this.fogMesh)    { this.scene.remove(this.fogMesh);    this.fogMesh = null; }

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

    // v2.12/M4 — MapFX layer. Sits between map and fog so painted effects
    // tint the map but fog can still hide them.
    const mapFXMat = new THREE.MeshBasicMaterial({
      map: this.mapFXCompositor.texture,
      transparent: true,
      depthWrite: false,
    });
    this.mapFXMesh = new THREE.Mesh(geo, mapFXMat);
    this.mapFXMesh.position.z = 0.005;
    this.scene.add(this.mapFXMesh);

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

    // Marker layer (Plane 2) — CanvasTexture if a canvas has been provided
    this._rebuildMarkerMesh();
  }

  private _rebuildMarkerMesh(): void {
    if (this.markerMesh) { this.scene.remove(this.markerMesh); this.markerMesh = null; }
    if (this.markerTex)  { this.markerTex.dispose(); this.markerTex = null; }
    if (!this.markerCanvas) return;

    this.markerTex = new THREE.CanvasTexture(this.markerCanvas as unknown as HTMLCanvasElement);
    this.markerTex.colorSpace = THREE.SRGBColorSpace;
    this.markerTex.minFilter  = THREE.LinearFilter;
    this.markerTex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(this.aspectRatio, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: this.markerTex,
      transparent: true,
      depthWrite: false,
    });
    this.markerMesh = new THREE.Mesh(geo, mat);
    // Motion overlay sits BELOW marker sprites so a marker token visually
    // lands on top of its own return blob (matches the GM canvas ordering
    // where blobs are drawn before icons).
    this.markerMesh.position.z = 0.015;
    this.scene.add(this.markerMesh);
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

    // Skip if the canvas has no layout dimensions yet (happens on mobile when
    // the initial ResizeObserver fires before the first layout pass, or when
    // the canvas is detached).  We'll be called again once it gets real size.
    if (w === 0 || h === 0) return;

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

    this.refreshCamera();
    this.needsRender = true;
  }

  /**
   * Re-applies the current ViewState if one has been set (player mode),
   * or falls back to updateCameraFrustum() for the default full-map view (GM mode).
   * Called after resize and after a new map texture loads.
   */
  private refreshCamera(): void {
    if (this.currentView) {
      this.setView(this.currentView);
    } else {
      this.updateCameraFrustum();
    }
  }

  private updateCameraFrustum(): void {
    const canvas = this.renderer.domElement;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw === 0 || ch === 0) return;
    const screenAspect = cw / ch;

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
