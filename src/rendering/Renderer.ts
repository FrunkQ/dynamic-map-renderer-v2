import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FogCompositor } from './FogCompositor.ts';
import { KindMaskCompositor } from './KindMaskCompositor.ts';
import { buildShaderObject, updateUniforms } from './ShaderMaterial.ts';
import { backdropById } from './backdrops/backdropRegistry.ts';
import { isVideoCap1080Enabled } from '../storage/localSettings.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { overlayKind } from '../mapfx/overlayKindRegistry.ts';
import { loadKindShader } from '../mapfx/shaders/shaderRegistry.ts';
import type { FilterDefinition } from '../filters/schema.ts';
import type { BackdropConfig, FilterParamValues, FilterState, FogState, ViewState, OverlayKind } from '../types.ts';

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
   * background colour (or an animated backdrop snippet from
   * `backdrops/backdropRegistry.ts`), so the player can never see map
   * content the GM hasn't revealed regardless of screen aspect ratio.
   * Defaults to full pass-through (uRect = 0,0,1,1) until setView() fires.
   * Rebuilt by `setBackdrop()` when the GM picks a different backdrop —
   * the snippet is inlined into the fragment shader.
   */
  private clipPass!: ShaderPass;
  /** Currently-applied backdrop config (drives clipPass rebuild + per-
   *  frame animation tick). Null = solid bg colour (default). */
  private backdropConfig: BackdropConfig | null = null;
  private resolution: THREE.Vector2;
  private startTime = performance.now();

  // Layer meshes
  private mapMesh:      THREE.Mesh | null = null;
  private fogMesh:      THREE.Mesh | null = null;
  private mapTexture:   THREE.Texture | null = null;
  /** v2.12 — set when the loaded map is a video. Held so the renderer
   *  can play / pause / dispose the underlying element separately
   *  from the THREE.VideoTexture, which only owns the GPU side. */
  private mapVideo:     HTMLVideoElement | null = null;
  /** v2.12.x — downscale canvas + 2D context for video maps whose
   *  natural resolution exceeds the GPU upload budget (4K video at
   *  60 Hz = ~2 GB/s of texImage2D). We blit the video into this
   *  canvas at a sensible max size, then upload the canvas. The
   *  CanvasTexture wrapping it sits on this.mapTexture. */
  private mapVideoScaleCanvas: HTMLCanvasElement | null = null;
  private mapVideoScaleCtx:    CanvasRenderingContext2D | null = null;
  /** v2.12 — true while a VideoTexture is the active map texture.
   *  Drives the renderFrame keep-alive (animated maps must redraw
   *  every frame so the texture's auto-update has a tick to land on). */
  private hasVideoMap = false;
  /** v2.12.x — handle for the active requestVideoFrameCallback so we
   *  can cancel on dispose. Tells the browser we're actively
   *  consuming every decoded frame, which prevents the decode
   *  throttling that surfaced when a player window wasn't full size
   *  (Chromium / Firefox throttle "less visible" videos otherwise). */
  private _videoFrameCbId: number | null = null;
  /** Timestamp of the last requestVideoFrameCallback fire, used by
   *  the stall watchdog. */
  private _videoLastFrameAt = 0;
  /** Watchdog interval that re-kicks play() if the rVFC pump has
   *  gone silent while the video is supposed to be playing. Cleared
   *  on dispose. */
  private _videoWatchdogId: ReturnType<typeof setInterval> | null = null;
  /** v2.12.x — count of consecutive watchdog fires with no progress.
   *  When this passes a threshold and the document isn't fullscreen,
   *  we conclude Chrome's decoder is throttled for this window and
   *  fall back to pause-until-fullscreen mode. */
  private _videoStallStrikes = 0;
  /** v2.12.x — pause-until-fullscreen overlay element when an
   *  animated map gets throttled by the browser. Null when not shown. */
  private _videoStallOverlay: HTMLElement | null = null;
  /** v2.12.x — bound fullscreenchange handler, kept so we can remove
   *  it cleanly on dispose. */
  private _onFullscreenChange: (() => void) | null = null;
  /** v2.12.x — when false, the renderer never pauses video maps on
   *  detected stall and never shows the "fullscreen for smooth
   *  playback" overlay. Projector mode sets this off: the projector
   *  is the table view; stutter is preferable to a frozen frame
   *  with a banner over it. Default true (Player + GM behaviour). */
  private _videoStallEscalationEnabled = true;
  /** v2.12.x — id of the timer that fades the stall overlay out
   *  after a short stay (we tell the user once, then trust them to
   *  fix it; spamming an immovable banner is worse than the bug). */
  private _videoStallOverlayFadeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Lazily-built ImageData cache for the loaded map's pixels. Used
   *  by the Magic Wand fill (src/mapfx/floodFill.ts) which needs to
   *  read the map's raw pixels to flood-fill from a click point.
   *  Invalidated on every loadMap() call. */
  private _mapImageDataCache: ImageData | null = null;
  private fogCompositor: FogCompositor;
  /** v2.12 — per-polygon alpha masks for shader-driven overlay kinds.
   *  One mask canvas per polygon, sized to the polygon's bbox; the
   *  matching shader plane samples its own mask directly. */
  private kindMaskCompositor: KindMaskCompositor;
  /** v2.12 — Three.js plane + ShaderMaterial per shader-driven polygon.
   *  Each plane sits at its polygon's bbox centre so the shader's
   *  procedural effect (curling flames, etc.) is centred on the polygon
   *  itself rather than on the map. Keyed by polygon id; the entry
   *  carries the kind so per-frame uniform updates can find the right
   *  shaderParams. Created lazily; disposed on map switch. */
  private shaderPlanes: Map<string, { mesh: THREE.Mesh; material: THREE.ShaderMaterial; kind: OverlayKind }> = new Map();
  /** v2.12 — when false (set by GMApp), shader planes are not created and
   *  shader-driven kinds render as flat fills via FogCompositor instead.
   *  Default true; player + projector keep the fancy effects. */
  private shaderPlanesEnabled = true;

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
  /** Magic Wand: return ImageData representing the map's current
   *  visual.  For still images this is cached after first build (the
   *  pixels never change).  For animated maps (v2.12 video sources) it
   *  re-samples the CURRENT video frame each call so the magic wand
   *  fills the contour the GM is actually looking at — the cache is
   *  bypassed to keep tooling honest. Returns null if no map is
   *  loaded yet or if the canvas2D context isn't available. */
  getMapImageData(): ImageData | null {
    if (this.hasVideoMap && this.mapVideo) {
      const v = this.mapVideo;
      const w = v.videoWidth, h = v.videoHeight;
      if (!w || !h || v.readyState < 2) return null;
      try {
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(v, 0, 0);
        return ctx.getImageData(0, 0, w, h);
      } catch {
        return null;
      }
    }

    if (this._mapImageDataCache) return this._mapImageDataCache;
    if (!this.mapTexture?.image) return null;
    const img = this.mapTexture.image as HTMLImageElement;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      this._mapImageDataCache = ctx.getImageData(0, 0, w, h);
      return this._mapImageDataCache;
    } catch {
      return null;
    }
  }

  /** Sniff the first bytes of a map blob to tell image apart from video.
   *  Used by loadMap to pick the right Three.js texture path. Returns
   *  'image' for the common still formats, 'video' for webm / mp4,
   *  'image' otherwise (TextureLoader's error path handles malformed
   *  inputs gracefully so the conservative default is safe). */
  private static _sniffMediaKind(buffer: ArrayBuffer): 'image' | 'video' {
    if (buffer.byteLength < 12) return 'image';
    const a = new Uint8Array(buffer, 0, 12);
    // WebM (EBML)
    if (a[0] === 0x1a && a[1] === 0x45 && a[2] === 0xdf && a[3] === 0xa3) return 'video';
    // MP4 / MOV — ftyp atom at offset 4
    if (a[4] === 0x66 && a[5] === 0x74 && a[6] === 0x79 && a[7] === 0x70) return 'video';
    return 'image';
  }

  /** v2.12.x — pick the right scale-canvas size for a video texture
   *  given the source's natural dimensions. Targets the WebGL canvas's
   *  physical-pixel size so the texture matches what's actually being
   *  rendered. Bounded above by the source's native resolution (no
   *  point upscaling a 720p video).
   *
   *  When the user has enabled the "Cap animated maps at 1080p"
   *  performance toggle (Settings → Performance), an additional 1920-
   *  max-side cap kicks in. Default is no cap — a fullscreen player
   *  on a 4K monitor with a 4K source gets a 4K texture, matching
   *  what works smoothly when fullscreened. */
  private _computeVideoTexSize(vw: number, vh: number): { w: number; h: number; scale: number } {
    const dpr = window.devicePixelRatio || 1;
    const canvas = this.renderer.domElement;
    const canvasW = (canvas.clientWidth  || canvas.width  || 1) * dpr;
    const canvasH = (canvas.clientHeight || canvas.height || 1) * dpr;
    let target = Math.max(canvasW, canvasH, 1);
    if (isVideoCap1080Enabled()) target = Math.min(target, 1920);
    const sourceMax = Math.max(vw, vh, 1);
    const scale = sourceMax > target ? target / sourceMax : 1;
    return {
      w: Math.max(1, Math.round(vw * scale)),
      h: Math.max(1, Math.round(vh * scale)),
      scale,
    };
  }

  /** v2.12.x — start a requestVideoFrameCallback pump. Re-arms itself
   *  on every callback so the browser sees a continuous active
   *  consumer of decoded frames, which prevents the throttling that
   *  surfaces when the player window isn't fully visible / not
   *  focused. Each callback also flags the renderer dirty so the
   *  next rAF tick uploads the freshly-decoded frame to the GPU
   *  texture. No-op on browsers that don't expose rVFC — animation
   *  still works via the existing renderFrame keep-alive there,
   *  just without the throttle resistance. */
  private _startVideoFramePump(video: HTMLVideoElement): void {
    type WithRvfc = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const vid = video as WithRvfc;
    this._videoLastFrameAt = performance.now();
    const verbose = (() => {
      try { return localStorage.getItem('mappadux_debug_video') === '1'; }
      catch { return false; }
    })();
    let frameCount = 0;
    let lastFrameCount = 0;
    let lastLogAt = performance.now();
    if (typeof vid.requestVideoFrameCallback !== 'function') {
      // eslint-disable-next-line no-console
      console.warn('[video-map] requestVideoFrameCallback unsupported — playback may stall when window is not focused');
      return;
    }
    const cb = () => {
      if (this.mapVideo !== video) return; // superseded by a newer load
      // Scale-canvas path (1080p cap toggle on): blit the latest video
      // frame into the scale canvas and mark the CanvasTexture dirty.
      // VideoTexture path (default): no drawImage — Three.js handles
      // the video → GPU upload directly via its zero-copy fast path.
      if (this.mapVideoScaleCtx && this.mapVideoScaleCanvas) {
        try {
          this.mapVideoScaleCtx.drawImage(
            video, 0, 0,
            this.mapVideoScaleCanvas.width,
            this.mapVideoScaleCanvas.height,
          );
        } catch { /* element may have torn down between callback dispatch and this line */ }
        if (this.mapTexture) this.mapTexture.needsUpdate = true;
      }
      this.needsRender = true;
      this._videoLastFrameAt = performance.now();
      // Frame fired = decoder isn't throttled right now. Reset the
      // stall strike count so a brief hiccup doesn't escalate to
      // "pause until fullscreen".
      this._videoStallStrikes = 0;
      frameCount++;
      // Heartbeat at 5 s intervals — always-on (not gated by the
      // verbose flag) so the GM can confirm playback is active just
      // by glancing at the console. Reports the per-second fps based
      // on frames delivered since the last heartbeat — a steady
      // 24-60 means healthy; near-zero means the decoder is throttled
      // or stalled. Verbose flag adds per-state breadcrumbs on top.
      const elapsedSec = (performance.now() - lastLogAt) / 1000;
      if (elapsedSec >= 5) {
        const fps = ((frameCount - lastFrameCount) / elapsedSec).toFixed(1);
        // eslint-disable-next-line no-console
        console.log(`[video-map] heartbeat — ${fps} fps over ${elapsedSec.toFixed(1)}s`,
          verbose ? { totalFrames: frameCount, currentTime: video.currentTime?.toFixed(2), readyState: video.readyState } : '',
        );
        lastFrameCount = frameCount;
        lastLogAt = performance.now();
      }
      this._videoFrameCbId = (this.mapVideo as WithRvfc).requestVideoFrameCallback!(cb);
    };
    this._videoFrameCbId = vid.requestVideoFrameCallback(cb);

    // Stall watchdog — if the rVFC pump goes silent for more than
    // 1.5 s while the video isn't paused / ended, the browser has
    // throttled or stalled the decoder. Re-kick play() to wake it
    // back up. Fires at 2 Hz; cheap. Cleared in _stopVideoFramePump.
    // Always logs the warning — silent watchdog firing is the kind
    // of thing the user needs to see to diagnose stalls.
    if (this._videoWatchdogId !== null) clearInterval(this._videoWatchdogId);
    this._videoWatchdogId = setInterval(() => {
      const v = this.mapVideo;
      if (!v || v !== video) return;
      if (v.paused || v.ended) return;
      const elapsed = performance.now() - this._videoLastFrameAt;
      if (elapsed > 1500) {
        // eslint-disable-next-line no-console
        console.warn(`[video-map] WATCHDOG: no frames for ${elapsed.toFixed(0)} ms — calling play()`, {
          currentTime: v.currentTime?.toFixed(2),
          paused: v.paused,
          readyState: v.readyState,
          networkState: v.networkState,
        });
        // Nudge — the browser sometimes wakes the decoder back up
        // when play() is called fresh. Don't fight it if play
        // returns a rejection (autoplay policy etc.).
        void v.play().catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[video-map] watchdog play() rejected', err);
        });
        this._videoLastFrameAt = performance.now();
        // v2.12.x — sustained-stall escalation. When the browser
        // refuses to decode regardless of how often we call play()
        // (Chrome's same-process secondary-window throttling on big
        // 4K+ videos), give up gracefully: pause the video, show an
        // overlay nudging the user to fullscreen the window, and
        // auto-resume on fullscreenchange. 4 strikes ≈ 6-8 s of
        // sustained no-progress before we declare it.
        this._videoStallStrikes++;
        if (
          this._videoStallEscalationEnabled &&
          this._videoStallStrikes >= 4 &&
          !this._isFullscreen()
        ) {
          // eslint-disable-next-line no-console
          console.warn('[video-map] sustained stall — pausing until fullscreen');
          v.pause();
          this._showVideoStallOverlay();
        }
      }
    }, 500);
  }

  /** Document.fullscreenElement check, normalised across the small
   *  amount of vendor-prefix legacy that still exists. */
  private _isFullscreen(): boolean {
    const d = document as Document & {
      webkitFullscreenElement?: Element;
      msFullscreenElement?:    Element;
    };
    return !!(d.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement);
  }

  /** v2.12.x — pause-until-fullscreen overlay. Shown when the
   *  decoder gives up under Chrome's secondary-window throttling.
   *  Hidden by _hideVideoStallOverlay on either fullscreen entry
   *  (via the listener installed in start()) or map switch
   *  (via _disposeMapTexture). */
  private _showVideoStallOverlay(): void {
    if (this._videoStallOverlay) return;
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.top      = '50%';
    div.style.left     = '50%';
    div.style.transform = 'translate(-50%, -50%)';
    div.style.padding  = '14px 20px';
    div.style.background = 'rgba(0, 0, 0, 0.82)';
    div.style.color    = '#fff';
    div.style.borderRadius = '8px';
    div.style.fontSize = '14px';
    div.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    div.style.zIndex   = '10000';
    div.style.pointerEvents = 'none';
    div.style.maxWidth = '90%';
    div.style.textAlign = 'center';
    div.style.lineHeight = '1.4';
    div.style.opacity   = '1';
    div.style.transition = 'opacity 700ms ease';
    div.textContent = '▶ Animated map paused. Fullscreen this window (F11) MAY help.';
    document.body.appendChild(div);
    this._videoStallOverlay = div;
    // Fade out + remove after 5 s — the user has seen the message
    // once, drilling them with an immovable banner is worse than the
    // stall it advertises. After the fade the renderer just accepts
    // whatever framerate the browser allows; the video element is
    // still paused so no extra GPU work either.
    if (this._videoStallOverlayFadeTimer !== null) clearTimeout(this._videoStallOverlayFadeTimer);
    this._videoStallOverlayFadeTimer = setTimeout(() => {
      const el = this._videoStallOverlay;
      if (!el) return;
      el.style.opacity = '0';
      setTimeout(() => this._hideVideoStallOverlay(), 800);
    }, 5000);
  }

  private _hideVideoStallOverlay(): void {
    if (this._videoStallOverlayFadeTimer !== null) {
      clearTimeout(this._videoStallOverlayFadeTimer);
      this._videoStallOverlayFadeTimer = null;
    }
    if (!this._videoStallOverlay) return;
    this._videoStallOverlay.remove();
    this._videoStallOverlay = null;
  }

  /** Public toggle for the stall-escalation path. Projector calls
   *  this with `false` so the table-view never pauses on stutter —
   *  drops in framerate are preferable to a still frame with a
   *  banner over it for the players sitting at the table. */
  setVideoStallEscalation(enabled: boolean): void {
    this._videoStallEscalationEnabled = enabled;
    if (!enabled) this._hideVideoStallOverlay();
  }

  // ─── Animated-map fallback sketch (future work) ────────────────────────
  //
  // The same-machine player popup + secondary-window decoder throttle on
  // Chrome is structurally hard to solve from JS. If we want to push past
  // the current "pause until fullscreen" patch-over, the cascade of
  // increasingly heavy fallbacks looks roughly like:
  //
  // Tier 1 (we're here): rVFC pump + watchdog + intersection-observer-
  //   visible video element + DOM-attached. Works fully when the window
  //   has resource priority (focused / fullscreen / sole window).
  //
  // Tier 2: Picture-in-Picture as the playback surface.
  //   Call video.requestPictureInPicture() — Chrome treats PiP as a
  //   foreground-priority surface and gives it full decode budget.
  //   Trade-off: PiP UI is visible, intrusive on the user's desktop.
  //   Maybe wired to a button: "Pop out for smooth playback".
  //
  // Tier 3: WebCodecs decode loop.
  //   Bypass HTMLVideoElement entirely. Use VideoDecoder + MP4Box.js /
  //   webm-muxer for demux + decode on a worker thread. Push frames as
  //   ImageBitmaps to the texture. Full control over scheduling, no
  //   browser-level throttling. Heavy implementation but the architectural
  //   "right answer" for in-app video that needs deterministic behaviour.
  //
  // Tier 4: Pre-process video on import.
  //   Transcode 4K → 1080p on upload using WebCodecs encode loop. Cap
  //   bitrate, cap resolution. The library record stores the transcoded
  //   version. Mappadux philosophy still works (no server) — encode
  //   happens in the GM's browser at import time. Adds a "preparing
  //   animated map…" step but pays off on every subsequent playback.
  //
  // Cascade order in a future release could be: try Tier 1, detect stall,
  // offer Tier 2 button to user; on opt-in once, remember the preference
  // per asset; Tier 3 / 4 only if we ever decide the feature really
  // needs to be window-size-independent without UI intervention.

  private _stopVideoFramePump(): void {
    if (this.mapVideo && this._videoFrameCbId !== null) {
      const vid = this.mapVideo as HTMLVideoElement & {
        cancelVideoFrameCallback?: (id: number) => void;
      };
      vid.cancelVideoFrameCallback?.(this._videoFrameCbId);
    }
    this._videoFrameCbId = null;
    if (this._videoWatchdogId !== null) {
      clearInterval(this._videoWatchdogId);
      this._videoWatchdogId = null;
    }
  }

  /** Tear down whichever map texture is live (image Texture or
   *  VideoTexture + underlying video element). Centralised so the
   *  loadMap branches can both dispose the previous map uniformly. */
  private _disposeMapTexture(): void {
    if (this.mapTexture) {
      this.mapTexture.dispose();
      this.mapTexture = null;
    }
    this._stopVideoFramePump();
    if (this.mapVideo) {
      this.mapVideo.pause();
      // Revoke the blob URL stashed on the element by _loadVideoMap.
      // Releasing it earlier (e.g. after loadedmetadata) breaks looped
      // playback: the video element re-fetches from the URL on every
      // loop seek, and a revoked URL surfaces as ERR_FILE_NOT_FOUND
      // spam in the console after the first cycle.
      const stashedUrl = (this.mapVideo as HTMLVideoElement & { _blobUrl?: string })._blobUrl;
      if (stashedUrl) URL.revokeObjectURL(stashedUrl);
      this.mapVideo.removeAttribute('src');
      try { this.mapVideo.load(); } catch { /* OK if it errors */ }
      // _loadVideoMap appends to document.body so detached-element
      // throttling doesn't stall playback; tear that link down too.
      if (this.mapVideo.parentElement) this.mapVideo.parentElement.removeChild(this.mapVideo);
      this.mapVideo = null;
    }
    // v2.12.x — release the scale canvas + context too; they belong to
    // the video pipeline and would just sit holding RAM on a map
    // switch to a still image otherwise.
    this.mapVideoScaleCanvas = null;
    this.mapVideoScaleCtx    = null;
    // Stall-escalation state belongs to the video that's going away.
    this._videoStallStrikes = 0;
    this._hideVideoStallOverlay();
    this.hasVideoMap = false;
  }

  /** v2.12 — Video-map load path. Mirrors the image branch in loadMap
   *  but builds a hidden <video> element, wires a VideoTexture
   *  around it, and starts looped muted playback. Browsers reliably
   *  autoplay muted videos without a user gesture, so this works
   *  even on initial app load. */
  private _loadVideoMap(url: string, gen: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const video = document.createElement('video');
      video.src = url;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;

      // v2.12.9 — diagnostic logging behind a localStorage flag so the
      // user can turn it on while debugging animated maps without
      // forcing it on everyone. Set `localStorage.mappadux_debug_video
      // = '1'` in DevTools to enable, reload.
      const debug = (() => {
        try { return localStorage.getItem('mappadux_debug_video') === '1'; }
        catch { return false; }
      })();
      const log = (label: string, extra?: Record<string, unknown>) => {
        if (!debug) return;
        const base: Record<string, unknown> = {
          t: performance.now().toFixed(0),
          ct: video.currentTime?.toFixed(2),
          rs: video.readyState,
          ns: video.networkState,
          paused: video.paused,
          ended: video.ended,
          dur: video.duration,
        };
        if (extra) Object.assign(base, extra);
        // eslint-disable-next-line no-console
        console.log(`[video-map] ${label}`, base);
      };
      log('created');
      ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing',
       'pause', 'waiting', 'stalled', 'suspend', 'ended', 'error', 'emptied'].forEach((ev) => {
        video.addEventListener(ev, () => log(ev));
      });
      // No crossOrigin attribute — blob URLs are same-origin to the
      // page that created them; setting it to 'anonymous' has been
      // known to confuse some browsers' resource fetch path for
      // blob:// schemes.
      video.preload = 'auto';
      // Belt-and-braces loop fallback. Some browsers (and some
      // codec / container combos) don't reliably honour
      // video.loop = true on blob URLs — the video plays once and
      // then sits at duration. Manually rewind + replay on ended
      // so playback is robust regardless.
      video.addEventListener('ended', () => {
        try { video.currentTime = 0; } catch { /* benign */ }
        void video.play().catch(() => {});
      });
      // v2.12.14 debug heartbeats revealed the real Chrome behaviour:
      // when a <video> element is styled "effectively invisible"
      // (visibility: hidden, tiny size, off-screen), Chrome's
      // intersection observer flags it as off-viewport and cuts the
      // decoder budget to near zero — readyState stays at 2 forever,
      // currentTime freezes, and play() does nothing. The phone
      // worked because mobile browsers don't apply the same throttle.
      //
      // The fix is to make the element "look on-screen to the
      // intersection observer" while staying visually invisible:
      // position: fixed, viewport-sized, opacity 0.001 (nominally
      // visible to the visibility heuristic, totally transparent to
      // the eye), pointer-events: none, z-index: -1 so it sits
      // behind any normal page content.
      video.style.position = 'fixed';
      video.style.top  = '0';
      video.style.left = '0';
      video.style.width  = '100%';
      video.style.height = '100%';
      video.style.opacity = '0.001';
      video.style.pointerEvents = 'none';
      video.style.zIndex = '-1';
      document.body.appendChild(video);
      // Stash the blob URL on the element so _disposeMapTexture can
      // revoke it at the right moment — i.e. when the video really is
      // done, NOT after the first metadata load (which would break
      // looped playback the moment the video tries to seek back to 0).
      (video as HTMLVideoElement & { _blobUrl?: string })._blobUrl = url;

      const finish = () => {
        if (gen !== this.loadGen) {
          // Superseded — discard.
          video.pause();
          video.removeAttribute('src');
          try { video.load(); } catch { /* OK */ }
          if (video.parentElement) video.parentElement.removeChild(video);
          URL.revokeObjectURL(url);
          resolve();
          return;
        }

        this._disposeMapTexture();

        const vw = video.videoWidth || 1;
        const vh = video.videoHeight || 1;
        // Two paths:
        //   • Default: THREE.VideoTexture(video) — direct video → GPU
        //     upload. Most browsers have a zero-copy fast path for
        //     texImage2D(HTMLVideoElement) (shared GPU memory between
        //     decoder and texture) that the CanvasTexture path loses.
        //     This is the only path that reliably keeps up with 4K
        //     sources on a fullscreen player.
        //   • "Cap at 1080p" toggle on: bounce through a downscale
        //     canvas first, upload the canvas via CanvasTexture. Trades
        //     the zero-copy advantage for a smaller texImage2D — only
        //     win on weak GPUs where the direct 4K upload stalls.
        const cap1080 = isVideoCap1080Enabled();
        let targetW = vw;
        let targetH = vh;
        let scale = 1;
        if (cap1080) {
          const t = this._computeVideoTexSize(vw, vh);
          targetW = t.w; targetH = t.h; scale = t.scale;
          const scaleCanvas = document.createElement('canvas');
          scaleCanvas.width  = targetW;
          scaleCanvas.height = targetH;
          const scaleCtx = scaleCanvas.getContext('2d');
          if (scaleCtx) {
            try { scaleCtx.drawImage(video, 0, 0, targetW, targetH); } catch { /* ignore */ }
            const tex = new THREE.CanvasTexture(scaleCanvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            this.mapTexture = tex;
            this.mapVideoScaleCanvas = scaleCanvas;
            this.mapVideoScaleCtx    = scaleCtx;
          } else {
            // 2D context refused — fall back to VideoTexture so the
            // load doesn't fail outright.
            const tex = new THREE.VideoTexture(video);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            this.mapTexture = tex;
          }
        } else {
          // Default path — VideoTexture direct upload, no canvas
          // intermediate. Keeps the browser's zero-copy fast path
          // available for the video → GPU transfer.
          const tex = new THREE.VideoTexture(video);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          this.mapTexture = tex;
        }
        this.mapVideo = video;
        this.hasVideoMap = true;
        this._mapImageDataCache = null;

        this.aspectRatio = vw / vh;

        // eslint-disable-next-line no-console
        console.info(
          `[video-map] loaded — source ${vw}×${vh}, ` +
          (cap1080
            ? `texture ${targetW}×${targetH}` + (scale < 1 ? ` (downscaled ${(scale * 100).toFixed(0)}%)` : ' (no downscale)')
            : 'VideoTexture direct upload') +
          '. Verbose per-frame logging: localStorage.mappadux_debug_video = "1"',
        );

        // Same fog / shader-plane reset path as the image branch.
        this.fogCompositor.dispose();
        this.fogCompositor = new FogCompositor(1024, 1024);
        this.fogCompositor.redraw(this.lastFogState, 0, !this.shaderPlanesEnabled);
        this._disposeShaderPlanes();
        this.kindMaskCompositor.dispose();
        this.kindMaskCompositor = new KindMaskCompositor();
        if (this.shaderPlanesEnabled) {
          this.kindMaskCompositor.redraw(this.lastFogState.polygons);
          this._syncShaderPlanes();
        }

        this.rebuildLayerMeshes();
        this.refreshCamera();
        this.needsRender = true;
        this.onMapLoaded?.(this.aspectRatio);

        // Kick playback. Muted autoplay works without a user gesture
        // in all current browsers — but we still .catch() so a
        // sandbox / policy block doesn't reject the whole load.
        void video.play().catch(() => { /* will show paused first frame */ });

        // Start the rVFC pump so the browser keeps decoding even
        // when the player window isn't full-display. Without this
        // hint the decode pipeline throttles whenever the video
        // element's intersection-observer visibility drops, which
        // surfaces as the animation stalling.
        this._startVideoFramePump(video);

        resolve();
      };

      // Wait for canplaythrough — the browser thinks it can play the
      // whole thing without rebuffering. The bytes are already 100%
      // local (blob URL), so this typically fires within a second or
      // two. Means we don't swap the player's static snapshot for
      // the video texture until the video is genuinely ready to
      // play smoothly — no stutter on swap.
      //
      // Fallback: some browsers fire canplaythrough inconsistently
      // for blob URLs. After 4 s, fall back to canplay (sufficient
      // data to start). After 8 s, force-fire on whatever state we
      // have so the GM isn't stuck on the snapshot indefinitely.
      let settled = false;
      const fire = () => { if (!settled) { settled = true; finish(); } };
      video.addEventListener('canplaythrough', fire, { once: true });
      setTimeout(() => { if (!settled && video.readyState >= 3) fire(); }, 4000);
      setTimeout(() => { fire(); }, 8000);
      video.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        if (video.parentElement) video.parentElement.removeChild(video);
        settled = true;
        resolve(); // failed — don't block any awaiting transition
      }, { once: true });
    });
  }
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
    this.kindMaskCompositor = new KindMaskCompositor();

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

    this._buildClipPass();

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

    const mediaKind = Renderer._sniffMediaKind(buffer);
    const mimeHint  = mediaKind === 'video' ? 'video/webm' : '';
    const blob = new Blob([buffer], mimeHint ? { type: mimeHint } : undefined);
    const url  = URL.createObjectURL(blob);

    if (mediaKind === 'video') {
      return this._loadVideoMap(url, gen);
    }

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

        this._disposeMapTexture();
        tex.colorSpace = THREE.SRGBColorSpace;
        this.mapTexture = tex;
        this.hasVideoMap = false;
        // Magic wand cache invalidates with every map switch — next
        // call to getMapImageData() will re-rasterise from the new
        // texture's HTMLImageElement.
        this._mapImageDataCache = null;

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
        this.fogCompositor.redraw(this.lastFogState, 0, !this.shaderPlanesEnabled);
        // Tear down per-kind shader planes + masks for the previous map.
        this._disposeShaderPlanes();
        this.kindMaskCompositor.dispose();
        this.kindMaskCompositor = new KindMaskCompositor();
        if (this.shaderPlanesEnabled) {
          this.kindMaskCompositor.redraw(this.lastFogState.polygons);
          this._syncShaderPlanes();
        }

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
    // GM view: render shader-driven kinds as flat fills too (perf + simplicity
    // while editing). Player/projector: skip them here, shader planes own them.
    this.fogCompositor.redraw(fog, 0, !this.shaderPlanesEnabled);
    if (this.shaderPlanesEnabled) {
      this.kindMaskCompositor.redraw(fog.polygons);
      this._syncShaderPlanes();
    }
    this.needsRender = true;
  }

  /** v2.12 — set whether this Renderer instance should spin up shader
   *  planes for shader-driven kinds. GMApp calls with false so the GM
   *  view stays simple (flat fills); player + projector keep the default
   *  true so they get the fancy effects. */
  setShaderPlanesEnabled(enabled: boolean): void {
    if (this.shaderPlanesEnabled === enabled) return;
    this.shaderPlanesEnabled = enabled;
    if (!enabled) this._disposeShaderPlanes();
    // Re-run the compositor so shader-driven kinds reappear as flat fills
    // (or disappear, when we re-enable).
    this.fogCompositor.redraw(this.lastFogState, 0, !enabled);
    if (enabled) {
      this.kindMaskCompositor.redraw(this.lastFogState.polygons);
      this._syncShaderPlanes();
    }
    this.needsRender = true;
  }

  /** Ensure there is exactly one shader plane per shader-driven polygon
   *  currently painted. Each plane sits at its polygon's bbox centre so
   *  the shader's procedural effect is centred on the polygon itself.
   *  Spins up new planes lazily; tears down planes for polygons that no
   *  longer exist. Re-positions / re-sizes existing planes when their
   *  polygon's bbox changes (vertex drag, etc.). */
  private _syncShaderPlanes(): void {
    const activePolys = this.kindMaskCompositor.activePolygons();
    const activeIds = new Set(activePolys.map((p) => p.id));

    // Drop planes for polygons that no longer exist.
    for (const [polyId, entry] of this.shaderPlanes) {
      if (activeIds.has(polyId)) continue;
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
      this.shaderPlanes.delete(polyId);
    }

    // Spin up planes for newly-active polygons; re-fit existing ones to
    // their current bbox (geometry rebuild is cheap relative to a
    // ShaderMaterial recompile, which we avoid by mutating the mesh
    // geometry in place).
    for (const poly of activePolys) {
      const maskEntry = this.kindMaskCompositor.entryFor(poly.id);
      if (!maskEntry) continue;
      const k = overlayKind(poly.kind);
      if (!k.shader) continue;
      const shader = loadKindShader(k.shader);
      if (!shader) continue;

      const planeW = maskEntry.bbox.w * this.aspectRatio;
      const planeH = maskEntry.bbox.h;
      // Plane centred at the polygon's bbox centre in world coords. World
      // y is map-norm y inverted: y=0 at top of map → world +0.5; y=1 at
      // bottom → world -0.5.
      const planeX = (maskEntry.bbox.x + maskEntry.bbox.w / 2 - 0.5) * this.aspectRatio;
      const planeY = 0.5 - (maskEntry.bbox.y + maskEntry.bbox.h / 2);
      // Z between map (0) and fog (0.01). Kind z-bias keeps fire below
      // electric below shadow etc.; per-poly createdAt mod gives a tiny
      // tie-break within a kind so overlapping polys of the same kind
      // don't z-fight.
      const slotZ = 0.002 + Math.min(0.006, k.z * 0.00005);

      // Map-UV bbox the plane covers (used by shaders that opt in to
      // sampling the underlying map). Y component is flipped because
      // texture sampling has flipY=true: vUv (0,0) on the plane is the
      // map's TOP-of-bbox row in canvas space.
      const mapUvX = maskEntry.bbox.x;
      const mapUvY = 1.0 - maskEntry.bbox.y - maskEntry.bbox.h;
      const mapUvW = maskEntry.bbox.w;
      const mapUvH = maskEntry.bbox.h;

      let entry = this.shaderPlanes.get(poly.id);
      if (entry && entry.kind !== poly.kind) {
        // The polygon's kind morphed (e.g. via the dropdown change
        // while a polygon is selected). The existing plane's material
        // was compiled for the OLD kind's shader — uniforms and the
        // fragment program don't match the new kind. Dispose and let
        // the create branch below build a fresh plane for the new
        // kind. Without this the polygon kept rendering with the old
        // shader after a morph; only the GM-side flat-fill colour
        // looked changed.
        this.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.material.dispose();
        this.shaderPlanes.delete(poly.id);
        entry = undefined;
      }
      if (!entry) {
        // First sighting of this polygon — build material + mesh.
        // Slider/toggle params land as float uniforms; color params
        // land as THREE.Color so the GLSL side reads `uniform vec3`.
        const paramUniforms: Record<string, { value: number | THREE.Color }> = {};
        for (const p of k.shaderParams ?? []) {
          const uName = `u${p.id.charAt(0).toUpperCase()}${p.id.slice(1)}`;
          if (p.type === 'color') {
            paramUniforms[uName] = { value: new THREE.Color(p.default) };
          } else {
            paramUniforms[uName] = { value: p.default };
          }
        }
        const baseUniforms: Record<string, { value: unknown }> = {
          uMask:    { value: maskEntry.texture },
          uNoise:   { value: shader.textures['uNoise'] ?? null },
          uBed:     { value: shader.textures['uBed']   ?? null },
          uColor:   { value: new THREE.Color(k.allowColor && poly.color ? poly.color : k.defaultColor) },
          uAspect:  { value: planeW / planeH },
          time:     { value: 0 },
          ...paramUniforms,
        };
        // Self-sample feature: shaders that declare `uniform sampler2D
        // uMap` get the map texture + their plane's bbox-in-map-UV
        // (offset.xy + scale.zw) so they can sample the GM's painted
        // art underneath the polygon. Used by the river shader for
        // refraction; available to any future shader.
        if (shader.wantsMap) {
          baseUniforms['uMap']   = { value: this.mapTexture };
          baseUniforms['uMapUv'] = { value: new THREE.Vector4(mapUvX, mapUvY, mapUvW, mapUvH) };
        }
        // Blend mode follows the kind. Fire ('screen') and similar
        // glow-y kinds use additive so radiance reads as light over
        // the map. River + opaque-surface kinds use normal alpha so
        // the shader output (which already samples the underlying
        // map for refraction) reads as a real surface that obscures
        // the bare map. Multiply for darkening kinds.
        const threeBlend =
          k.blend === 'multiply' ? THREE.MultiplyBlending :
          k.blend === 'normal'   ? THREE.NormalBlending   :
                                   THREE.AdditiveBlending;
        const material = new THREE.ShaderMaterial({
          vertexShader:   shader.vertex,
          fragmentShader: shader.fragment,
          transparent:    true,
          depthWrite:     false,
          blending:       threeBlend,
          uniforms:       baseUniforms,
        });
        const geo = new THREE.PlaneGeometry(planeW, planeH);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(planeX, planeY, slotZ);
        this.scene.add(mesh);
        entry = { mesh, material, kind: poly.kind };
        this.shaderPlanes.set(poly.id, entry);
      } else {
        // Existing plane — refresh geometry, position, mask, colour.
        // Re-build the PlaneGeometry only if size actually changed; mutating
        // the position is always cheap.
        const geo = entry.mesh.geometry as THREE.PlaneGeometry;
        const params = geo.parameters;
        if (params.width !== planeW || params.height !== planeH) {
          entry.mesh.geometry.dispose();
          entry.mesh.geometry = new THREE.PlaneGeometry(planeW, planeH);
        }
        entry.mesh.position.set(planeX, planeY, slotZ);
        if (entry.material.uniforms['uMask']) entry.material.uniforms['uMask']!.value = maskEntry.texture;
        if (entry.material.uniforms['uAspect']) entry.material.uniforms['uAspect']!.value = planeW / planeH;
        const colHex = k.allowColor && poly.color ? poly.color : k.defaultColor;
        const colU = entry.material.uniforms['uColor'];
        if (colU) (colU.value as THREE.Color).set(colHex);
        // Self-sample uniforms re-sync when bbox or map texture
        // changes (e.g. polygon edit, map switch).
        const mapU = entry.material.uniforms['uMap'];
        if (mapU) mapU.value = this.mapTexture;
        const mapUvU = entry.material.uniforms['uMapUv'];
        if (mapUvU) (mapUvU.value as THREE.Vector4).set(mapUvX, mapUvY, mapUvW, mapUvH);
      }
    }

    // Live shader-param values (intensity, scale, …) may have changed
    // alongside the polygon set (e.g. GM moved the slider) — push them
    // now so newly-spun planes pick up the GM's current tuning and
    // existing planes refresh.
    this._pushShaderParamsToPlanes();
  }

  /** Push shader-param values from the current fog state into each
   *  active shader plane's uniforms. Every param is per-polygon:
   *  read poly.shaderParams[id], fall back to the param's registry
   *  default. Kind-level FogState.shaderParams is the "draft" used by
   *  the GM panel for new polygons; it doesn't reach the renderer. */
  private _pushShaderParamsToPlanes(): void {
    const polyById = new Map<string, import('../types.ts').FogPolygon>();
    for (const p of this.lastFogState.polygons) polyById.set(p.id, p);
    for (const [polyId, entry] of this.shaderPlanes) {
      const k = overlayKind(entry.kind);
      const defs = k.shaderParams ?? [];
      const poly = polyById.get(polyId);
      const polyValues = poly?.shaderParams ?? {};
      for (const p of defs) {
        const uName = `u${p.id.charAt(0).toUpperCase()}${p.id.slice(1)}`;
        const u = entry.material.uniforms[uName];
        if (!u) continue;
        const raw = polyValues[p.id];
        if (p.type === 'color') {
          // Reuse the existing THREE.Color object so the uniform
          // binding stays valid (Color is a vec3-compatible source
          // for Three's uniform pipeline). Falls back to the param
          // default when the poly hasn't set this one yet.
          const hex = typeof raw === 'string' ? raw : p.default;
          (u.value as THREE.Color).set(hex);
        } else {
          u.value = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default;
        }
      }
    }
  }

  /** Tear down every shader plane (map switch / dispose). */
  private _disposeShaderPlanes(): void {
    for (const entry of this.shaderPlanes.values()) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
    }
    this.shaderPlanes.clear();
  }

  /**
   * Immediately clear the fog compositor.
   * Called at the start of a map switch so the old map's fog is never visible on the new map.
   * lastFogState is set to empty; loadMap() will override it once the correct state is known.
   */
  clearFog(): void {
    this.lastFogState = { polygons: [] };
    this.fogCompositor.redraw({ polygons: [] });
    this.kindMaskCompositor.redraw([]);
    this._syncShaderPlanes();
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
    // GM-mode renderers ask for filter to be skipped — apply that to the
    // freshly-built pass so toggling filter while GM is active doesn't
    // accidentally re-enable the post-process shader.
    this.shaderPass.enabled = this.filterEnabled;
    this.composer.addPass(this.clipPass);    // clip viewport → fill bars with bg
    this.composer.addPass(this.shaderPass); // filter sees full frame incl. bars
    this.composer.addPass(this.outputPass); // SRGB conversion last
  }

  updateFilterParams(filterId: string, values: FilterParamValues): void {
    if (!this.shaderPass || !this.activeFilter || this.activeFilter.id !== filterId) return;
    updateUniforms(this.shaderPass.uniforms, this.activeFilter, values);
    this.needsRender = true;
  }

  /**
   * Apply (or clear) the per-pack animated backdrop. Pass null / { kind:
   * 'none' } to revert to solid bg colour. Rebuilds the clip pass with
   * the registered backdrop's GLSL snippet inlined into the "outside
   * uRect" branch — inside the viewport the pass keeps showing the
   * composed map untouched, so the map itself is never overlaid.
   *
   * Idempotent — calling with the current config is a cheap no-op.
   * Cheap to call: the snippet's only cost is per-frame fragment work
   * over the bars, plus a one-time program compile.
   */
  setBackdrop(config: BackdropConfig | null): void {
    const next = config && config.kind !== 'none' ? config : null;
    const sameKind = (this.backdropConfig?.kind ?? 'none') === (next?.kind ?? 'none');
    // Same-kind updates skip the shader rebuild — speed and per-backdrop
    // params just hot-push their values into the existing uniforms.
    // Different-kind picks need the rebuild so the new GLSL snippet
    // (and its uniform declarations) lands.
    const needsRebuild = !sameKind;
    this.backdropConfig = next;
    if (needsRebuild) this._buildClipPass();
    if (this.clipPass.uniforms['uSpeed']) {
      this.clipPass.uniforms['uSpeed']!.value = next?.speed ?? 1.0;
    }
    this._pushBackdropParamsToUniforms();
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
   *
   * v2.12 — instead of bypassing the composer entirely (which used to
   * mean clipPass never ran on the GM), we now leave the composer
   * chain in place and just toggle the filter shaderPass's enabled
   * flag. The clipPass continues to run so per-pack animated
   * backdrops render in the GM's letterbox area too.
   */
  setFilterEnabled(enabled: boolean): void {
    this.filterEnabled = enabled;
    if (this.shaderPass) this.shaderPass.enabled = enabled;
    this.needsRender = true;
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
    // v2.12.x — fullscreenchange listener for the animated-map
    // pause-until-fullscreen escalation. When the user enters
    // fullscreen, hide the overlay and resume playback; the
    // decoder budget jumps in fullscreen, so the stall should
    // clear straight away. Leaving fullscreen just lets the
    // watchdog re-detect and re-pause if needed.
    if (!this._onFullscreenChange) {
      this._onFullscreenChange = () => {
        if (this._isFullscreen()) {
          this._hideVideoStallOverlay();
          this._videoStallStrikes = 0;
          if (this.mapVideo && this.mapVideo.paused) {
            void this.mapVideo.play().catch(() => { /* autoplay policy */ });
          }
        }
      };
      document.addEventListener('fullscreenchange', this._onFullscreenChange);
    }
  }

  stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this._onFullscreenChange) {
      document.removeEventListener('fullscreenchange', this._onFullscreenChange);
      this._onFullscreenChange = null;
    }
    this._hideVideoStallOverlay();
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
    // GM mode: keep clip rect tracking the map plane on screen so the
    // backdrop continues to fill bars correctly through pan/zoom.
    if (!this.currentView) this._refreshGmClipRect();
    this.needsRender = true;
  }

  /**
   * GM-mode clip rect — sets the clipPass's uRect to where the map plane
   * projects on the screen given the current camera (frustum + zoom +
   * position). Backdrop snippet draws everywhere outside this rect,
   * solid map content draws inside. No-op when a player ViewState is
   * active (setView() owns uRect in that mode).
   *
   * Math: map plane spans world [-mapAspect/2 .. +mapAspect/2] × [-0.5 ..
   * +0.5]. Three.js's orthographic camera maps a world coord W to NDC
   * via (W - camera.position) * zoom / (frustum-half-extent). Screen UV
   * is (NDC + 1) / 2.
   */
  private _refreshGmClipRect(): void {
    const cam = this.camera;
    const hw  = (cam.right - cam.left) / 2;
    const hh  = (cam.top   - cam.bottom) / 2;
    if (hw <= 0 || hh <= 0) return;
    const zoom = cam.zoom || 1;
    const mapL = -this.aspectRatio / 2;
    const mapR =  this.aspectRatio / 2;
    const mapB = -0.5;
    const mapT =  0.5;
    const ndcL = (mapL - cam.position.x) * zoom / hw;
    const ndcR = (mapR - cam.position.x) * zoom / hw;
    const ndcB = (mapB - cam.position.y) * zoom / hh;
    const ndcT = (mapT - cam.position.y) * zoom / hh;
    const uvL = (ndcL + 1) / 2;
    const uvR = (ndcR + 1) / 2;
    const uvB = (ndcB + 1) / 2;
    const uvT = (ndcT + 1) / 2;
    this.clipPass.uniforms['uRect']!.value.set(uvL, uvB, uvR, uvT);
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
    this._disposeShaderPlanes();
    this.kindMaskCompositor.dispose();
    this._disposeMapTexture();
    this.markerTex?.dispose();
    this.mapBorderLine?.geometry.dispose();
    this.mapBorderMat?.dispose();
    this.outputPass.dispose();
    this.clipPass.dispose?.();
    this.renderer.dispose();
    window.removeEventListener('resize', () => this.handleResize());
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Build the clip pass — pass-through inside the viewport rectangle,
   * solid bg / animated backdrop snippet outside. Called once from
   * the constructor and again whenever setBackdrop() picks a new kind.
   *
   * If the pass already exists in the composer chain it's swapped out
   * in place; otherwise the constructor will append it once setFilter()
   * runs (which is always called from the constructor and rebuilds the
   * pass order around clipPass / shaderPass / outputPass).
   */
  private _buildClipPass(): void {
    const oldPass = this.clipPass;
    const oldRect = (oldPass?.uniforms['uRect']?.value as THREE.Vector4 | undefined)?.clone();
    const oldBg   = (oldPass?.uniforms['uBgColor']?.value as THREE.Vector3 | undefined)?.clone();

    const entry = backdropById(this.backdropConfig?.kind ?? 'none');
    const speed = this.backdropConfig?.speed ?? 1.0;
    const cfgParams = this.backdropConfig?.params ?? {};

    // Per-backdrop params land here as additional uniforms (sliders/
    // toggles → float, colour → vec3 via THREE.Color). The GLSL
    // declarations for them are auto-injected ahead of the snippet so
    // the snippet author doesn't have to redeclare them.
    //
    // Collision rule: if a param's resolved uniform name matches a
    // built-in (uSpeed, uBgColor, uRect, uResolution), the built-in's
    // uniform OBJECT is replaced by the param's value (via the spread
    // at the bottom of the uniforms map) but the GLSL declaration is
    // skipped — GLSL forbids re-declaring the same uniform twice in
    // one shader. This is how 'speed' becomes a tunable slider while
    // keeping the legacy uSpeed built-in usable by snippets.
    const BUILT_IN_UNIFORMS = new Set(['uSpeed', 'uBgColor', 'uRect', 'uResolution', 'uAspect']);
    const paramUniforms: Record<string, { value: number | THREE.Color }> = {};
    const paramDeclarations: string[] = [];
    for (const p of entry.params ?? []) {
      const uName = `u${p.id.charAt(0).toUpperCase()}${p.id.slice(1)}`;
      const stored = cfgParams[p.id];
      if (p.type === 'color') {
        const hex = typeof stored === 'string' && /^#[0-9a-fA-F]{6}$/.test(stored) ? stored : p.default;
        paramUniforms[uName] = { value: new THREE.Color(hex) };
        if (!BUILT_IN_UNIFORMS.has(uName)) paramDeclarations.push(`uniform vec3 ${uName};`);
      } else {
        const n = typeof stored === 'number' && Number.isFinite(stored) ? stored : p.default;
        paramUniforms[uName] = { value: n };
        if (!BUILT_IN_UNIFORMS.has(uName)) paramDeclarations.push(`uniform float ${uName};`);
      }
    }

    const pass = new ShaderPass({
      uniforms: {
        tDiffuse:    { value: null },
        uRect:       { value: oldRect ?? new THREE.Vector4(0, 0, 1, 1) },
        uBgColor:    { value: oldBg   ?? new THREE.Vector3(0, 0, 0) },
        time:        { value: 0 },
        uSpeed:      { value: speed },
        uResolution: { value: new THREE.Vector2(this.resolution.x, this.resolution.y) },
        // uAspect: canvas aspect (x/y). Auto-updated on resize so any
        // backdrop-shareable MapFX shader code can reference it
        // identically to its MapFX-rendered counterpart.
        uAspect:     { value: this.resolution.x / Math.max(this.resolution.y, 1) },
        ...paramUniforms,
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec4  uRect;
        uniform vec3  uBgColor;
        uniform float time;
        uniform float uSpeed;
        uniform vec2  uResolution;
        uniform float uAspect;
        ${paramDeclarations.join('\n        ')}
        varying vec2  vUv;
        ${entry.helpers ?? ''}
        void main() {
          if (vUv.x < uRect.x || vUv.x > uRect.z ||
              vUv.y < uRect.y || vUv.y > uRect.w) {
            ${entry.fragment}
          } else {
            gl_FragColor = texture2D(tDiffuse, vUv);
          }
        }`,
    });

    // Swap in place if the old pass was already wired into the composer.
    if (oldPass && this.composer && this.composer.passes.includes(oldPass)) {
      const idx = this.composer.passes.indexOf(oldPass);
      this.composer.passes[idx] = pass;
      oldPass.dispose?.();
    }
    this.clipPass = pass;
  }

  /** Push the current `backdropConfig.params` values into the clipPass
   *  param uniforms. Called from setBackdrop when the kind is unchanged
   *  (so we don't need a shader rebuild). For colour params the existing
   *  THREE.Color object is reused via `.set()` so the uniform binding
   *  stays stable. */
  private _pushBackdropParamsToUniforms(): void {
    const entry = backdropById(this.backdropConfig?.kind ?? 'none');
    const cfgParams = this.backdropConfig?.params ?? {};
    for (const p of entry.params ?? []) {
      const uName = `u${p.id.charAt(0).toUpperCase()}${p.id.slice(1)}`;
      const u = this.clipPass.uniforms[uName];
      if (!u) continue;
      const stored = cfgParams[p.id];
      if (p.type === 'color') {
        const hex = typeof stored === 'string' && /^#[0-9a-fA-F]{6}$/.test(stored) ? stored : p.default;
        (u.value as THREE.Color).set(hex);
      } else {
        u.value = typeof stored === 'number' && Number.isFinite(stored) ? stored : p.default;
      }
    }
  }

  private renderFrame(): void {
    // Tick animated overlay polygons (fire flicker, electric crackle, etc.).
    // Cheap because the compositor just re-runs polygon path ops at a
    // modulated alpha; no PNG decoding involved.
    const animatedOverlay = this.fogCompositor.hasAnimatedPolygons();
    const hasShaderPlanes = this.shaderPlanes.size > 0;
    const animatedBackdrop = this.backdropConfig !== null;
    const animatedVideo = this.hasVideoMap;

    // Skip rendering if nothing has changed and there's no animation.
    if (!this.needsRender && !this.isAnimatedFilter && !animatedOverlay && !hasShaderPlanes && !animatedBackdrop && !animatedVideo) return;
    this.needsRender = false;

    const elapsed = (performance.now() - this.startTime) / 1000;

    if (animatedOverlay) {
      this.fogCompositor.tickAnimation(elapsed);
    }

    // Tick each shader plane's `time` uniform.
    for (const entry of this.shaderPlanes.values()) {
      if (entry.material.uniforms['time']) entry.material.uniforms['time']!.value = elapsed;
    }

    // Tick time uniform only for animated filters (no-op for static ones)
    if (this.shaderPass?.uniforms['time']) {
      this.shaderPass.uniforms['time']!.value = elapsed;
    }

    // Tick clip-pass time uniform — drives animated backdrop snippets.
    if (this.clipPass.uniforms['time']) {
      this.clipPass.uniforms['time']!.value = elapsed;
    }

    this.renderer.clear();

    // Both GM and Player render through the composer chain. In GM mode
    // the filter shaderPass is disabled (setFilterEnabled) so the
    // composed image goes scene → clipPass → outputPass with the
    // filter skipped — visually identical to a direct scene render
    // but keeps the clipPass active for the per-pack animated backdrop.
    this.composer.render();

    // GM overlay always renders on top of whichever mode, bypassing filter
    if (this.gmOverlayEnabled) {
      this.renderer.render(this.gmScene, this.camera);
    }
  }

  private rebuildLayerMeshes(): void {
    // Remove existing layers
    if (this.mapMesh)    { this.scene.remove(this.mapMesh);    this.mapMesh = null; }
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

    // Fog layer — transparent, composited on top. Hosts ALL overlay
    // polygons (fog + MapFX kinds) in the v2.12 unified system.
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
    // NOTE: the downscale canvas does NOT resize on window changes.
    // Resizing a CanvasTexture's source canvas confuses Three.js into
    // calling glCopySubTextureCHROMIUM against the old GPU texture
    // dimensions and flooding the console with GL_INVALID_VALUE
    // errors every frame. The 1080p-cap path computes its target
    // size once at load time and sticks with it.

    // resolution must be in *physical* pixels to match gl_FragCoord.xy.
    // clientWidth/clientHeight are CSS pixels; canvas.width/height are the
    // real framebuffer dimensions after setSize applies devicePixelRatio.
    const pw = canvas.width;
    const ph = canvas.height;
    this.resolution.set(pw, ph);
    if (this.shaderPass?.uniforms['resolution']) {
      this.shaderPass.uniforms['resolution']!.value.set(pw, ph);
    }
    if (this.clipPass.uniforms['uResolution']) {
      this.clipPass.uniforms['uResolution']!.value.set(pw, ph);
    }
    if (this.clipPass.uniforms['uAspect']) {
      this.clipPass.uniforms['uAspect']!.value = pw / Math.max(ph, 1);
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
    // Keep GM clip rect tracking the map plane (resize / map switch path).
    this._refreshGmClipRect();
  }
}
