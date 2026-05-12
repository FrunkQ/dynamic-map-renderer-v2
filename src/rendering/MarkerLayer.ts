import type { Marker, ViewState } from '../types.ts';
import type { MarkerOverlay, OverlayItem, OverlayBadge } from './MarkerOverlay.ts';

interface Frustum { left: number; right: number; top: number; bottom: number; }

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ── Motion-tracker overlay state ─────────────────────────────────────────────

export interface MotionOverlayScan {
  startTime: number;
  centre:    { x: number; y: number };
  range:     number;
  speedSecs: number;
  colour:    string;
}
export interface MotionOverlayBlob {
  startTime: number;
  sourceId:  string;
  position:  { x: number; y: number };
  fadeMs:    number;
  mode:      'single' | 'multi-few' | 'multi-many';
  colour:    string;
}
export interface MotionOverlay {
  /** performance.now() at the time of this draw call. */
  now:   number;
  /** All currently-expanding rings — multiple coexist when rate < speed. */
  scans: MotionOverlayScan[];
  blobs: MotionOverlayBlob[];
  /** Static preview circle drawn around the currently-selected tracker marker
   *  so the GM can see the configured range while sliding the Range slider. */
  trackerPreview?: {
    centre: { x: number; y: number };
    range:  number;
    colour: string;
  } | null;
}

/** Tiny seeded PRNG (mulberry32) — deterministic positions per blob so the
 *  cluster shape doesn't dance while it fades, but each blob looks different. */
function _seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix the source id into the time-based seed so two simultaneous hits look different. */
function _blobSeed(startTime: number, sourceId: string): number {
  let h = 0;
  for (let i = 0; i < sourceId.length; i++) h = (h * 31 + sourceId.charCodeAt(i)) | 0;
  return (Math.floor(startTime) ^ h) >>> 0;
}

/** '#rrggbb' + alpha 0–1 → 'rgba(...)'. */
function _hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(248, 158, 11, ${alpha})`;
  const r = parseInt(m[1]!, 16);
  const g = parseInt(m[2]!, 16);
  const b = parseInt(m[3]!, 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Canvas badge drawing functions removed in v2.11/A3b2 — badges now live
// in the HTML screen-space overlay (MarkerOverlay). Click handling +
// visual state are managed there; what's left on the canvas is the icon
// body plus motion-overlay scan rings.

/**
 * Build the 1–3 action badges that should appear above an unlocked GM
 * marker. Visibility is always present; audio + motion only appear when
 * their roles are set. Order is fixed (visibility, audio, motion) so the
 * row reads consistently across markers.
 */
function buildBadges(m: Marker): OverlayBadge[] {
  const out: OverlayBadge[] = [];
  out.push({
    kind:  'visibility',
    on:    !m.hidden,
    title: m.hidden ? 'Hidden — click to show' : 'Visible — click to hide',
  });
  if (m.roles.audio === 'source') {
    out.push({
      kind:  'audio-source',
      on:    !m.audioMuted,
      title: m.audioMuted ? 'Sound source muted — click to unmute' : 'Sound source — click to mute',
    });
  } else if (m.roles.audio === 'listener') {
    out.push({
      kind:  'audio-listener',
      on:    !m.audioMuted,
      title: m.audioMuted ? 'Deaf listener — click to enable' : 'Listener — click to mute',
    });
  }
  if (m.roles.motion === 'source') {
    out.push({
      kind:  'motion-source',
      on:    !m.motionMuted,
      title: m.motionMuted ? 'Motion source muted — click to enable' : 'Motion source — click to mute',
    });
  } else if (m.roles.motion === 'tracker') {
    out.push({
      kind:  'motion-tracker',
      on:    !m.motionMuted,
      title: m.motionMuted ? 'Tracker off — click to enable' : 'Tracker scanning — click to disable',
    });
  }
  return out;
}

/**
 * Look up an image-icon bitmap from the cache, honouring the compound
 * '<icon>#<color>' key used for tintable libAsset bitmaps. Returns null
 * for non-image markers or cache misses.
 */
export function getMarkerBitmap(
  m: Marker,
  iconCache?: Map<string, ImageBitmap>,
): ImageBitmap | null {
  const isImage = m.icon.startsWith('data:') || m.icon.startsWith('asset:') || m.icon.startsWith('libAsset:');
  if (!isImage || !iconCache) return null;
  if (m.icon.startsWith('libAsset:')) {
    return iconCache.get(`${m.icon}#${m.color}`) ?? iconCache.get(m.icon) ?? null;
  }
  return iconCache.get(m.icon) ?? null;
}

/**
 * Aspect ratio (width / height) of a marker's rendered icon. For image
 * markers this comes from the cached bitmap's natural dimensions (preserved
 * by decodeImageBitmap from v2.10.27 onward). Non-image markers and cache
 * misses are treated as 1:1.
 */
export function getMarkerAspect(
  m: Marker,
  iconCache?: Map<string, ImageBitmap>,
): number {
  const bmp = getMarkerBitmap(m, iconCache);
  if (!bmp || !bmp.width || !bmp.height) return 1;
  return bmp.width / bmp.height;
}

/**
 * Standalone marker drawing function used by both the DOM overlay (GM)
 * and the WebGL CanvasTexture (player via MarkerTexture).
 *
 * Markers render as a rectangle sized r×2 vertically with width scaled by
 * the icon's natural aspect ratio. So a 2:1 wide dragon icon renders 2×
 * wider than tall at the same size value, and the selection ring / badges
 * / label all follow the rectangle's bounds. Non-image markers (emoji /
 * unicode glyphs) fall back to aspect=1.
 */
export function drawMarkerShape(
  ctx: Ctx2D,
  m: Marker,
  cx: number,
  cy: number,
  r: number,
  selected: boolean,
  isGM: boolean,
  iconCache?: Map<string, ImageBitmap>,
): void {
  // 1. Dim locked markers for GM (locked = non-interactive; hidden is now badge-only)
  if (isGM && m.locked) ctx.globalAlpha = 0.4;

  const isImage = m.icon.startsWith('data:') || m.icon.startsWith('asset:') || m.icon.startsWith('libAsset:');
  const bmp     = isImage ? getMarkerBitmap(m, iconCache) : null;
  const aspect  = (bmp && bmp.width && bmp.height) ? bmp.width / bmp.height : 1;
  const halfH   = r;
  const halfW   = r * aspect;

  // 2. Selection ring — moved to the HTML overlay in v2.11/A3b4
  //    (.marker-selection-ring) so it stays crisp / screen-fixed and the
  //    selection chrome (resize / rotate handles) can sit alongside it.
  void selected;

  // 3. Icon rendering — rect with the icon's natural aspect ratio
  if (isImage) {
    if (bmp) {
      ctx.drawImage(bmp, cx - halfW, cy - halfH, halfW * 2, halfH * 2);
    } else {
      // Cache miss — show a small dot so the marker is still locatable
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
    }
  } else {
    const iconPx = Math.max(12, r * 1.6);
    ctx.font         = `${iconPx}px system-ui,sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle  = 'rgba(0,0,0,0.75)';
    ctx.lineWidth    = Math.max(2, iconPx * 0.15);
    ctx.strokeText(m.icon || '?', cx, cy);
    ctx.fillStyle = m.color;
    ctx.fillText(m.icon || '?', cx, cy);
  }

  // 4. Label — moved to the HTML screen-space overlay layer in v2.11/A3a
  //    so it stays readable regardless of map zoom. drawMarkerShape no
  //    longer draws the label; MarkerOverlay does, positioned each frame
  //    by the caller (MarkerLayer.render for GM, MarkerSprites callers
  //    for the broadcast views).

  // 5. Status badges — moved to the HTML overlay layer in v2.11/A3b2.
  //    The overlay renders them in screen-space above the move handle
  //    where they're finger-friendly and never occlude the icon body.

  // 6. Reset alpha
  ctx.globalAlpha = 1;
}

/**
 * MarkerLayer — 2D canvas renderer for map markers.
 *
 * Used by both the GM (isGM=true, shows status badges + ghost opacity for
 * locked markers) and the player (isGM=false, skips hidden markers entirely).
 *
 * The canvas buffer is kept in sync with the element's CSS display size via
 * ResizeObserver; the last render params are re-applied automatically on resize.
 *
 * Position math mirrors Renderer.ts setView() / updateCameraFrustum() exactly
 * so markers are always pixel-aligned with the underlying Three.js scene.
 */
export class MarkerLayer {
  readonly canvas: HTMLCanvasElement;
  private ar = 1; // map aspect ratio

  private _markers:    Marker[]        = [];
  private _view:       ViewState | null = null;
  private _selectedId: string | null   = null;
  private _isGM:       boolean         = false;
  private _iconCache:  Map<string, ImageBitmap> | undefined;
  private _motion:     MotionOverlay | null = null;
  /** HTML overlay layer that renders marker labels in screen-space.
   *  Populated via setOverlay(). Updated at the end of every _draw(). */
  private _overlay:    MarkerOverlay | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const onResize = () => {
      const w = canvas.clientWidth  || 1;
      const h = canvas.clientHeight || 1;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
        this._draw();
      }
    };
    new ResizeObserver(onResize).observe(canvas);
    onResize();
  }

  setAspectRatio(ar: number): void { this.ar = ar; }
  setOverlay(overlay: MarkerOverlay | null): void { this._overlay = overlay; }

  // ── Rendering ──────────────────────────────────────────────────────────────

  render(
    markers:    Marker[],
    view:       ViewState | null,
    selectedId: string | null = null,
    isGM        = false,
    iconCache?: Map<string, ImageBitmap>,
    motion?:    MotionOverlay | null,
  ): void {
    const w = this.canvas.clientWidth  || 1;
    const h = this.canvas.clientHeight || 1;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width  = w;
      this.canvas.height = h;
    }
    this._markers    = markers;
    this._view       = view;
    this._selectedId = selectedId;
    this._isGM       = isGM;
    this._iconCache  = iconCache;
    this._motion     = motion ?? null;
    this._draw();
  }

  private _draw(): void {
    const { width: W, height: H } = this.canvas;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    const { _markers: markers, _view: view, _selectedId: sel, _isGM: isGM, _iconCache: iconCache } = this;
    // frustumH is the visible world height in this view; H / frustumH is
    // "canvas pixels per world Y unit", which is the same scale
    // MarkerSprites uses for the player/projector planes. Driving baseR
    // off this — instead of raw canvas H — keeps marker sizing identical
    // across all three views regardless of letterboxing.
    const fr = this._frustum(view);
    const frustumH = Math.max(0.0001, fr.top - fr.bottom);

    // dB range circle for the selected audio_source marker (GM only)
    if (isGM && sel) {
      const selM = markers.find((m) => m.id === sel);
      if (selM?.roles.audio === 'source' && selM.audioMaxDistance > 0) {
        const pos = this.project(selM.position.x, selM.position.y, view);
        if (pos) {
          const f       = this._frustum(view);
          const yScale  = H / (f.top - f.bottom);
          const radiusPx = selM.audioMaxDistance * yScale;
          ctx.save();
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
          ctx.setLineDash([6, 4]);
          ctx.lineWidth   = 1.5;
          ctx.strokeStyle = 'rgba(13, 154, 219, 0.6)';
          ctx.stroke();
          ctx.font         = '10px system-ui,sans-serif';
          ctx.fillStyle    = 'rgba(13, 154, 219, 0.85)';
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText('sound limit', pos.x, pos.y - radiusPx - 2);
          ctx.restore();
        }
      }
    }

    // Return blobs are drawn FIRST so the marker icons sit on top of them —
    // a contact splash beneath the token rather than a blob obscuring it.
    if (this._motion) this._drawMotionBlobs(ctx, this._motion, W, H);

    for (const m of markers) {
      if (!isGM && m.hidden) continue;
      const pos = this.project(m.position.x, m.position.y, view);
      if (!pos) continue;
      // baseR is computed in WORLD units (0.025 × m.size) then converted
      // to canvas pixels via the current frustum height — this matches
      // how MarkerSprites sizes the player/projector planes in world
      // coords, so a marker at the same `size` ends up the same fraction
      // of the rendered map height on every view (no letterbox drift).
      const baseR = (H / frustumH) * 0.025 * m.size;
      this._drawMarker(ctx, m, pos.x, pos.y, baseR, m.id === sel, isGM, iconCache);
    }

    // Scan rings + the static range preview live ABOVE markers — they're
    // transparent strokes so they don't obscure tokens.
    if (this._motion) this._drawMotionOverlay(ctx, this._motion, W, H);

    // Sync the HTML screen-space overlay (labels for v2.11/A3a; handles +
    // badges follow in A3b). Positions are in CSS px relative to the canvas
    // top-left, derived from the same frustum math we just used.
    this._updateOverlay(W, H, frustumH);
  }

  /** Build the screen-space overlay set (label + GM handles). */
  private _updateOverlay(W: number, H: number, frustumH: number): void {
    if (!this._overlay) return;
    void W;
    const { _markers: markers, _view: view, _isGM: isGM, _iconCache: iconCache } = this;
    const rect = this.canvas.getBoundingClientRect();
    const pxToCssX = rect.width  / Math.max(1, this.canvas.width);
    const pxToCssY = rect.height / Math.max(1, this.canvas.height);
    const items: OverlayItem[] = [];
    for (const m of markers) {
      const pos = this.project(m.position.x, m.position.y, view);
      if (!pos) continue; // off-screen markers are simply absent from the overlay
      const halfHBuf = (H / frustumH) * 0.025 * m.size;
      const aspect   = getMarkerAspect(m, iconCache);
      const halfWBuf = halfHBuf * aspect;
      // Locked GM markers keep their status badges (display-only via CSS)
      // but lose the move handle. Unlocked markers get both.
      const badges = isGM ? buildBadges(m) : undefined;
      const isSelected = isGM && m.id === this._selectedId && !m.locked;
      items.push({
        id:               m.id,
        anchorX:          pos.x    * pxToCssX,
        anchorY:          pos.y    * pxToCssY,
        iconHalfWidthPx:  halfWBuf * pxToCssX,
        iconHalfHeightPx: halfHBuf * pxToCssY,
        label: {
          text:    m.label ?? '',
          visible: !!m.label && (isGM || !!m.showLabel) && !m.hidden,
        },
        ...(isGM && !m.locked
          ? { moveHandle: { visible: true, interactive: true } }
          : {}),
        ...(badges && badges.length > 0 ? { badges } : {}),
        ...(m.locked ? { locked: true } : {}),
        ...(isSelected ? { selected: true } : {}),
      });
    }
    this._overlay.update(items);
  }

  private _drawMotionBlobs(ctx: CanvasRenderingContext2D, m: MotionOverlay, W: number, H: number): void {
    void W;
    const view = this._view;
    const fr   = this._frustum(view);
    const frustumH = Math.max(0.0001, fr.top - fr.bottom);
    for (const b of m.blobs) {
      const elapsed = m.now - b.startTime;
      const alpha   = Math.max(0, 1 - elapsed / b.fadeMs) * 0.85;
      if (alpha <= 0) continue;
      const pos = this.project(b.position.x, b.position.y, view);
      if (!pos) continue;
      const marker = this._markers.find((mm) => mm.id === b.sourceId);
      const r = (H / frustumH) * 0.025 * (marker?.size ?? 1);
      ctx.save();
      ctx.fillStyle = _hexWithAlpha(b.colour, alpha);
      if (b.mode === 'multi-few' || b.mode === 'multi-many') {
        const rng      = _seededRandom(_blobSeed(b.startTime, b.sourceId));
        const isMany   = b.mode === 'multi-many';
        const count    = isMany ? (7  + Math.floor(rng() * 7)) : (3 + Math.floor(rng() * 3));
        const sizeBase = isMany ? 0.16 : 0.28;
        const sizeVar  = isMany ? 0.10 : 0.18;
        for (let i = 0; i < count; i++) {
          const ang     = rng() * Math.PI * 2;
          const dist    = rng() * r * 0.85;
          const blobR   = r * (sizeBase + rng() * sizeVar);
          ctx.beginPath();
          ctx.arc(pos.x + Math.cos(ang) * dist, pos.y + Math.sin(ang) * dist, blobR, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private _drawMotionOverlay(ctx: CanvasRenderingContext2D, m: MotionOverlay, W: number, H: number): void {
    const view = this._view;
    const f       = this._frustum(view);
    const yScale  = H / (f.top - f.bottom);
    void W;

    // Static range preview around the selected tracker marker
    if (m.trackerPreview) {
      const tp = m.trackerPreview;
      const pos = this.project(tp.centre.x, tp.centre.y, view);
      if (pos && tp.range > 0) {
        const radiusPx = tp.range * yScale;
        ctx.save();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
        ctx.setLineDash([6, 4]);
        ctx.lineWidth   = 1.5;
        ctx.strokeStyle = _hexWithAlpha(tp.colour, 0.6);
        ctx.stroke();
        ctx.font         = '10px system-ui,sans-serif';
        ctx.fillStyle    = _hexWithAlpha(tp.colour, 0.85);
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('tracker range', pos.x, pos.y - radiusPx - 2);
        ctx.restore();
      }
    }

    // Active scan rings — each radius animates 0 → range over its own speedSecs, alpha fades out
    for (const scan of m.scans) {
      const elapsedSecs = (m.now - scan.startTime) / 1000;
      const t           = Math.min(1, Math.max(0, elapsedSecs / scan.speedSecs));
      const radiusPx    = t * scan.range * yScale;
      const pos         = this.project(scan.centre.x, scan.centre.y, view);
      if (!pos || radiusPx <= 1) continue;
      // Hold near-full alpha through most of the scan; the fade compresses into the last ~15%.
      const alpha = (1 - Math.pow(t, 4)) * 0.7;
      ctx.save();
      ctx.lineWidth   = 2;
      ctx.strokeStyle = _hexWithAlpha(scan.colour, alpha);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      // Soft inner glow
      ctx.lineWidth   = 6;
      ctx.strokeStyle = _hexWithAlpha(scan.colour, alpha * 0.25);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // (Return blobs are drawn separately in _drawMotionBlobs, beneath the markers.)
  }

  private _drawMarker(
    ctx: CanvasRenderingContext2D,
    m: Marker, cx: number, cy: number, r: number,
    selected: boolean, isGM: boolean,
    iconCache?: Map<string, ImageBitmap>,
  ): void {
    drawMarkerShape(ctx, m, cx, cy, r, selected, isGM, iconCache);
  }

  // ── Coordinate mapping ─────────────────────────────────────────────────────

  /** Normalised map coords → canvas pixel position. */
  project(mx: number, my: number, view: ViewState | null): { x: number; y: number } | null {
    const f = this._frustum(view);
    const wx =  (mx - 0.5) * this.ar;
    const wy = -(my - 0.5);
    return {
      x: (wx - f.left) / (f.right - f.left) * this.canvas.width,
      y: (f.top - wy)  / (f.top  - f.bottom) * this.canvas.height,
    };
  }

  /** Canvas pixel position → normalised map coords. */
  unproject(px: number, py: number, view: ViewState | null): { x: number; y: number } {
    const f  = this._frustum(view);
    const wx = f.left + (px / this.canvas.width)  * (f.right - f.left);
    const wy = f.top  - (py / this.canvas.height) * (f.top   - f.bottom);
    return { x: wx / this.ar + 0.5, y: -wy + 0.5 };
  }

  /**
   * Returns the topmost marker under canvas pixel (px, py), or null.
   * Hit area is the rectangle the marker actually renders into (aspect-aware
   * for non-square icons) plus a small forgiveness pad.
   */
  hitTestMarker(px: number, py: number, markers: Marker[], view: ViewState | null): Marker | null {
    const H = this.canvas.height;
    const fr = this._frustum(view);
    const frustumH = Math.max(0.0001, fr.top - fr.bottom);
    for (let i = markers.length - 1; i >= 0; i--) {
      const m   = markers[i]!;
      const pos = this.project(m.position.x, m.position.y, view);
      if (!pos) continue;
      const r      = (H / frustumH) * 0.025 * m.size;
      const aspect = getMarkerAspect(m, this._iconCache);
      const halfW  = r * aspect + 6;
      const halfH  = r + 6;
      if (Math.abs(px - pos.x) <= halfW && Math.abs(py - pos.y) <= halfH) return m;
    }
    return null;
  }

  // hitTestBadge / hitTestBadgeAny removed in v2.11/A3b2 — badges moved
  // to the HTML overlay layer and dispatch clicks directly via the
  // MarkerOverlay onBadgeClick handler, so the canvas no longer needs a
  // hit-test surface for them.

  private _frustum(view: ViewState | null): Frustum {
    const W  = this.canvas.width  || 1;
    const H  = this.canvas.height || 1;
    const sa = W / H;
    const ma = this.ar;

    if (view) {
      const hw_vp = (view.viewNW / 2) * ma;
      const hh_vp =  view.viewNH / 2;
      const va    = hw_vp / Math.max(hh_vp, 0.0001);
      let hw: number, hh: number;
      if (sa > va) { hh = hh_vp; hw = hh * sa; }
      else         { hw = hw_vp; hh = hw  / sa; }
      const cx = (view.centerX - 0.5) * ma;
      const cy = -(view.centerY - 0.5);
      return { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh };
    }

    let hw: number, hh: number;
    if (sa > ma) { hh = 0.5; hw = hh * sa; }
    else         { hw = ma * 0.5; hh = hw / sa; }
    return { left: -hw, right: hw, top: hh, bottom: -hh };
  }
}
