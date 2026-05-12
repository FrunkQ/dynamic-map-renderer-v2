import type { Marker, ViewState } from '../types.ts';

const BADGE_R   = 9;   // badge circle radius in canvas px
const BADGE_HIT = 15;  // hit-test radius for badge clicks

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

// ── Badge background circle ───────────────────────────────────────────────────

function _badge(ctx: Ctx2D, bx: number, by: number, bg: string, drawIcon: (ctx: Ctx2D, cx: number, cy: number, r: number) => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, by, BADGE_R, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth   = 1;
  ctx.stroke();
  drawIcon(ctx, bx, by, BADGE_R);
  ctx.restore();
}

// ── Icon drawing functions (white paths on coloured badge circle) ─────────────

function _iconEye(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = 'white';
  ctx.fillStyle   = 'white';
  ctx.lineWidth   = r * 0.19;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, cy);
  ctx.quadraticCurveTo(cx, cy - r * 0.55, cx + r * 0.7, cy);
  ctx.quadraticCurveTo(cx, cy + r * 0.55, cx - r * 0.7, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
  ctx.fill();
}

function _iconEyeCrossed(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.globalAlpha *= 0.5;
  _iconEye(ctx, cx, cy, r);
  ctx.restore();
  ctx.strokeStyle = 'white';
  ctx.lineWidth   = r * 0.26;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.62, cy - r * 0.62);
  ctx.lineTo(cx + r * 0.62, cy + r * 0.62);
  ctx.stroke();
}

function _iconSpeaker(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle   = 'white';
  ctx.strokeStyle = 'white';
  ctx.lineWidth   = r * 0.18;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.58, cy - r * 0.3);
  ctx.lineTo(cx - r * 0.18, cy - r * 0.3);
  ctx.lineTo(cx + r * 0.42, cy - r * 0.62);
  ctx.lineTo(cx + r * 0.42, cy + r * 0.62);
  ctx.lineTo(cx - r * 0.18, cy + r * 0.3);
  ctx.lineTo(cx - r * 0.58, cy + r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + r * 0.25, cy, r * 0.42, -Math.PI * 0.42, Math.PI * 0.42);
  ctx.stroke();
}

function _iconSpeakerMuted(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.globalAlpha *= 0.5;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.58, cy - r * 0.3);
  ctx.lineTo(cx - r * 0.18, cy - r * 0.3);
  ctx.lineTo(cx + r * 0.42, cy - r * 0.62);
  ctx.lineTo(cx + r * 0.42, cy + r * 0.62);
  ctx.lineTo(cx - r * 0.18, cy + r * 0.3);
  ctx.lineTo(cx - r * 0.58, cy + r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'white';
  ctx.lineWidth   = r * 0.24;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.1,  cy - r * 0.5);
  ctx.lineTo(cx + r * 0.65, cy + r * 0.5);
  ctx.moveTo(cx + r * 0.65, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.1,  cy + r * 0.5);
  ctx.stroke();
}

function _iconEar(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = 'white';
  ctx.lineWidth   = r * 0.22;
  ctx.lineCap     = 'round';
  // Outer C arc — draws the left half of a circle (bottom → left → top), opening right
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.68, Math.PI * 0.55, Math.PI * 1.45);
  ctx.stroke();
  // Inner canal
  ctx.beginPath();
  ctx.arc(cx + r * 0.05, cy + r * 0.1, r * 0.3, Math.PI * 0.4, Math.PI * 1.3);
  ctx.stroke();
}

function _iconEarMuted(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.globalAlpha *= 0.5;
  _iconEar(ctx, cx, cy, r);
  ctx.restore();
  ctx.strokeStyle = 'white';
  ctx.lineWidth   = r * 0.26;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.62, cy - r * 0.62);
  ctx.lineTo(cx + r * 0.62, cy + r * 0.62);
  ctx.stroke();
}

function _iconMotion(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle   = 'white';
  ctx.strokeStyle = 'white';
  ctx.lineWidth   = r * 0.2;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  // Shaft
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.6, cy);
  ctx.lineTo(cx + r * 0.1, cy);
  ctx.stroke();
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.62, cy);
  ctx.lineTo(cx + r * 0.08, cy - r * 0.44);
  ctx.lineTo(cx + r * 0.08, cy + r * 0.44);
  ctx.closePath();
  ctx.fill();
}

/** Radar-screen style: concentric arcs in the upper-right quadrant + centre dot. */
function _iconRadar(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = 'white';
  ctx.fillStyle   = 'white';
  ctx.lineWidth   = r * 0.18;
  ctx.lineCap     = 'round';
  // Centre dot
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  // Two outward arcs (upper-right quadrant ≈ 45°-arc swept from -PI/4 to 0)
  for (const radius of [r * 0.45, r * 0.7]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI * 0.4, -Math.PI * 0.05);
    ctx.stroke();
  }
}

/** Diagonal slash overlay used to mark a muted icon. */
function _slash(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = 'white';
  ctx.lineWidth   = r * 0.22;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.62, cy + r * 0.62);
  ctx.lineTo(cx + r * 0.62, cy - r * 0.62);
  ctx.stroke();
}

// ── Composite badge renderers ─────────────────────────────────────────────────

function _visibilityBadge(ctx: Ctx2D, m: Marker, bx: number, by: number): void {
  if (m.hidden) {
    _badge(ctx, bx, by, '#dc2626', _iconEyeCrossed);
  } else {
    _badge(ctx, bx, by, '#22c55e', _iconEye);
  }
}

// Badge colour scheme:
//   source (emitter)     unmuted = blue,  muted = purple
//   listener/tracker     unmuted = green, muted = red
const BADGE_SOURCE_ON    = '#3b82f6'; // blue
const BADGE_SOURCE_MUTED = '#a855f7'; // purple
const BADGE_RECV_ON      = '#22c55e'; // green
const BADGE_RECV_MUTED   = '#dc2626'; // red

function _audioBadge(ctx: Ctx2D, m: Marker, bx: number, by: number): void {
  if (m.roles.audio === 'source') {
    _badge(ctx, bx, by, m.audioMuted ? BADGE_SOURCE_MUTED : BADGE_SOURCE_ON,
      m.audioMuted ? _iconSpeakerMuted : _iconSpeaker);
  } else if (m.roles.audio === 'listener') {
    _badge(ctx, bx, by, m.audioMuted ? BADGE_RECV_MUTED : BADGE_RECV_ON,
      m.audioMuted ? _iconEarMuted : _iconEar);
  }
  // no audio role: no audio badge
}

function _motionBadge(ctx: Ctx2D, m: Marker, bx: number, by: number): void {
  const muted = m.motionMuted;
  if (m.roles.motion === 'source') {
    const colour = muted ? BADGE_SOURCE_MUTED : BADGE_SOURCE_ON;
    _badge(ctx, bx, by, colour, (c, x, y, r) => {
      _iconMotion(c, x, y, r);
      if (muted) _slash(c, x, y, r);
    });
  } else if (m.roles.motion === 'tracker') {
    const colour = muted ? BADGE_RECV_MUTED : BADGE_RECV_ON;
    _badge(ctx, bx, by, colour, (c, x, y, r) => {
      _iconRadar(c, x, y, r);
      if (muted) _slash(c, x, y, r);
    });
  }
  // no motion role: no badge
}

/**
 * Standalone marker drawing function used by both the DOM overlay (GM)
 * and the WebGL CanvasTexture (player via MarkerTexture).
 *
 * No circle background — icon is drawn in the marker's own color.
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

  // 2. Dashed selection ring
  if (selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 3. Icon rendering
  const isImage = m.icon.startsWith('data:') || m.icon.startsWith('asset:') || m.icon.startsWith('libAsset:');
  if (isImage) {
    // libAsset bitmaps are cached under the compound key '<icon>#<color>'
    // when the underlying asset is tintable (the bitmap bakes the colour
    // in), and under the bare icon when raster. Try compound first so a
    // colour-aware lookup wins; fall back to bare for non-tintable.
    const bmp = m.icon.startsWith('libAsset:')
      ? (iconCache?.get(`${m.icon}#${m.color}`) ?? iconCache?.get(m.icon))
      : iconCache?.get(m.icon);
    if (bmp) {
      ctx.drawImage(bmp, cx - r, cy - r, r * 2, r * 2);
    } else {
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

  // 4. Label below icon — GM always sees it; players only if showLabel is set
  if (m.label && (isGM || m.showLabel)) {
    const lPx = Math.max(9, r * 0.55);
    ctx.font         = `bold ${lPx}px system-ui,sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth    = 2.5;
    ctx.strokeStyle  = 'rgba(0,0,0,0.85)';
    ctx.strokeText(m.label, cx, cy + r + 3);
    ctx.fillStyle    = 'white';
    ctx.fillText(m.label, cx, cy + r + 3);
  }

  // 5. Status badges — GM only
  //    top-left:    visibility (eye) — always shown
  //    top-right:   audio (speaker / ear) — only when roles.audio is set
  //    bottom-right: motion (arrow) — only when roles.motion is set
  if (isGM) {
    const bOff = Math.max(BADGE_R + 2, r * 0.78);
    _visibilityBadge(ctx, m, cx - bOff, cy - bOff);
    _audioBadge(ctx, m, cx + bOff, cy - bOff);
    _motionBadge(ctx, m, cx + bOff, cy + bOff);
  }

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
      const baseR = Math.min(W, H) * 0.025 * m.size;
      this._drawMarker(ctx, m, pos.x, pos.y, baseR, m.id === sel, isGM, iconCache);
    }

    // Scan rings + the static range preview live ABOVE markers — they're
    // transparent strokes so they don't obscure tokens.
    if (this._motion) this._drawMotionOverlay(ctx, this._motion, W, H);
  }

  private _drawMotionBlobs(ctx: CanvasRenderingContext2D, m: MotionOverlay, W: number, H: number): void {
    void W;
    const view = this._view;
    for (const b of m.blobs) {
      const elapsed = m.now - b.startTime;
      const alpha   = Math.max(0, 1 - elapsed / b.fadeMs) * 0.85;
      if (alpha <= 0) continue;
      const pos = this.project(b.position.x, b.position.y, view);
      if (!pos) continue;
      const marker = this._markers.find((mm) => mm.id === b.sourceId);
      const r = Math.min(W, H) * 0.025 * (marker?.size ?? 1);
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

  /** Returns the topmost marker under canvas pixel (px, py), or null. */
  hitTestMarker(px: number, py: number, markers: Marker[], view: ViewState | null): Marker | null {
    for (let i = markers.length - 1; i >= 0; i--) {
      const m   = markers[i]!;
      const pos = this.project(m.position.x, m.position.y, view);
      if (!pos) continue;
      const r = Math.min(this.canvas.width, this.canvas.height) * 0.025 * m.size;
      if (Math.hypot(px - pos.x, py - pos.y) <= r + 6) return m;
    }
    return null;
  }

  /** Returns the topmost badge under (px, py) across all markers, or null. */
  hitTestBadgeAny(
    px: number, py: number,
    markers: Marker[],
    view: ViewState | null,
  ): { marker: Marker; badge: 'hidden' | 'audio' | 'motion' } | null {
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i]!;
      if (m.locked) continue;
      const badge = this.hitTestBadge(px, py, m, view);
      if (badge) return { marker: m, badge };
    }
    return null;
  }

  /** Returns which GM badge is under canvas pixel (px, py) for the given marker. */
  hitTestBadge(
    px: number, py: number,
    marker: Marker,
    view: ViewState | null,
  ): 'hidden' | 'audio' | 'motion' | null {
    const pos = this.project(marker.position.x, marker.position.y, view);
    if (!pos) return null;
    const r    = Math.min(this.canvas.width, this.canvas.height) * 0.025 * marker.size;
    const bOff = Math.max(BADGE_R + 2, r * 0.78);

    // Top-left: visibility
    if (Math.hypot(px - (pos.x - bOff), py - (pos.y - bOff)) <= BADGE_HIT) return 'hidden';

    // Top-right: audio (only when a marker has an audio role)
    if (marker.roles.audio) {
      if (Math.hypot(px - (pos.x + bOff), py - (pos.y - bOff)) <= BADGE_HIT) return 'audio';
    }

    // Bottom-right: motion (only when a marker has a motion role)
    if (marker.roles.motion) {
      if (Math.hypot(px - (pos.x + bOff), py - (pos.y + bOff)) <= BADGE_HIT) return 'motion';
    }

    return null;
  }

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
