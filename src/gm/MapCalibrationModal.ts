import type { MapAsset } from '../types.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { attachGestures } from '../utils/Gestures.ts';

/**
 * Map calibration UI: shows the map image full-screen with two draggable
 * crosshair handles. Scroll-wheel zooms toward the cursor; click-drag on
 * empty space pans. The user places the crosses on two points whose distance
 * they know in 1"/25mm grid squares (the table-grid unit; the in-game
 * meaning of one square is up to the GM's system) and clicks Save.
 *
 * Stored as `pixelsPerSquare` on the MapAsset — map pixels per ONE 1"/25mm
 * square. The Projector view divides by its own pixels-per-square to get
 * the projector-rectangle size on the map.
 */
export class MapCalibrationModal {
  private overlay: HTMLElement | null = null;
  private blobUrl: string | null = null;
  private resolver: (() => void) | null = null;

  /** Endpoint positions in NATURAL image coordinates. */
  private a = { x: 0, y: 0 };
  private b = { x: 0, y: 0 };

  /** Cached image dims. */
  private imgW = 1;
  private imgH = 1;

  /** Current SVG viewBox: [x, y, w, h]. Zoom = imgW / vbW. */
  private vb: [number, number, number, number] = [0, 0, 1, 1];

  /** Open the calibration UI; resolves once the modal closes. */
  async open(asset: MapAsset): Promise<void> {
    const blob = await MapAssetStore.getBlob(asset);
    if (!blob) { alert('Cannot calibrate — map image is unavailable.'); return; }
    this.blobUrl = URL.createObjectURL(blob);

    const dims = asset.imageWidth && asset.imageHeight
      ? { width: asset.imageWidth, height: asset.imageHeight }
      : (await MapAssetStore.readDimensions(blob)) ?? { width: 1024, height: 768 };
    this.imgW = dims.width;
    this.imgH = dims.height;
    this.vb   = [0, 0, this.imgW, this.imgH];

    // Pick up where the last calibration left off if we have it; otherwise
    // a default horizontal line spanning ~50% of the image width.
    const saved = asset.calibrationLine;
    if (saved) {
      this.a = { x: saved.ax, y: saved.ay };
      this.b = { x: saved.bx, y: saved.by };
    } else {
      const cx = this.imgW / 2;
      const cy = this.imgH / 2;
      const dx = this.imgW * 0.25;
      this.a = { x: cx - dx, y: cy };
      this.b = { x: cx + dx, y: cy };
    }

    this.overlay = this._buildUI(asset);
    document.body.appendChild(this.overlay);
    return new Promise<void>((resolve) => { this.resolver = resolve; });
  }

  private close(): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
    if (this.resolver) { this.resolver(); this.resolver = null; }
  }

  private _buildUI(asset: MapAsset): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'calibration-overlay';

    // Pre-fill the squares input. Prefer the exact value the user previously
    // typed (so re-opening shows e.g. "30" if they typed "30"), else infer
    // from the current pixelsPerSquare and endpoint distance, else default 10.
    const savedLine = asset.calibrationLine;
    const px0 = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
    const initialSquares = savedLine?.squares
      ?? (asset.pixelsPerSquare ? (px0 / asset.pixelsPerSquare) : 10);

    overlay.innerHTML = `
      <div class="calibration-frame">
        <header class="calibration-header">
          <div>
            <h3>Calibrate &ldquo;${this._esc(asset.filename)}&rdquo;</h3>
            <p>Drag the two crosses to two points whose grid distance you know. Scroll or pinch to zoom, drag empty space to pan. Then enter how many 1&Prime;/25 mm squares the line spans.</p>
          </div>
          <button class="btn btn--ghost btn--xs calibration-reset" title="Reset zoom and pan">Reset View</button>
        </header>
        <div class="calibration-canvas-wrap">
          <svg class="calibration-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
            <image class="calibration-image" href="${this.blobUrl ?? ''}" x="0" y="0" width="${this.imgW}" height="${this.imgH}" />
            <line class="calibration-line calibration-line-base" />
            <line class="calibration-line calibration-line-ants" />
            <g class="calibration-handle" data-handle="a"></g>
            <g class="calibration-handle" data-handle="b"></g>
          </svg>
        </div>
        <footer class="calibration-footer">
          <label class="calibration-distance">
            <span>This line is</span>
            <input type="number" class="calibration-distance-input" min="0.5" step="0.5" value="${initialSquares.toFixed(1)}" />
            <span>squares <small>(1&Prime;/25 mm)</small></span>
          </label>
          <span class="calibration-current">${asset.pixelsPerSquare
            ? `Current: ${asset.pixelsPerSquare.toFixed(1)} map-px per square`
            : 'Not yet calibrated'}</span>
          <div class="calibration-actions">
            <button class="btn btn--ghost calibration-cancel">Cancel</button>
            <button class="btn btn--primary calibration-save">Save</button>
          </div>
        </footer>
      </div>
    `;

    const svg     = overlay.querySelector<SVGSVGElement>('.calibration-svg')!;
    const line    = svg.querySelector<SVGLineElement>('.calibration-line')!;
    const handleA = svg.querySelector<SVGGElement>('[data-handle="a"]')!;
    const handleB = svg.querySelector<SVGGElement>('[data-handle="b"]')!;

    /**
     * Convert a pointer event's client position to SVG-internal natural coords
     * via the SVG's screen CTM. This automatically respects letterboxing from
     * preserveAspectRatio="xMidYMid meet" so the cursor maps to the exact
     * pixel under it, regardless of image aspect mismatch.
     */
    const svgPoint = svg.createSVGPoint();
    const clientToSvg = (cx: number, cy: number): { x: number; y: number } => {
      svgPoint.x = cx;
      svgPoint.y = cy;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const p = svgPoint.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    };
    const eventToSvg = (e: PointerEvent | WheelEvent) => clientToSvg(e.clientX, e.clientY);

    /**
     * Crosshair drawing — fixed 30-px on-screen size regardless of zoom.
     * Layered: yellow base arms + dark marching-ants overlay for visibility
     * over both light and dark map backgrounds.
     */
    const drawCrosshair = (g: SVGGElement, x: number, y: number) => {
      const rect = svg.getBoundingClientRect();
      const pxPerNatural = rect.width / this.vb[2];
      const arm = 15 / pxPerNatural; // 15 natural-unit half-arm = 30 on-screen px
      g.setAttribute('transform', `translate(${x} ${y})`);
      g.innerHTML = `
        <line class="cx-arm cx-base" x1="${-arm}" y1="0" x2="${arm}" y2="0" />
        <line class="cx-arm cx-base" x1="0" y1="${-arm}" x2="0" y2="${arm}" />
        <line class="cx-arm cx-ants" x1="${-arm}" y1="0" x2="${arm}" y2="0" />
        <line class="cx-arm cx-ants" x1="0" y1="${-arm}" x2="0" y2="${arm}" />
        <circle class="cx-dot" cx="0" cy="0" r="${arm * 0.16}" />
        <circle class="cx-hit" cx="0" cy="0" r="${arm * 1.4}" />
      `;
    };

    const redraw = () => {
      svg.setAttribute('viewBox', this.vb.join(' '));
      [line, ...svg.querySelectorAll<SVGLineElement>('.calibration-line')].forEach((l) => {
        l.setAttribute('x1', String(this.a.x));
        l.setAttribute('y1', String(this.a.y));
        l.setAttribute('x2', String(this.b.x));
        l.setAttribute('y2', String(this.b.y));
      });
      drawCrosshair(handleA, this.a.x, this.a.y);
      drawCrosshair(handleB, this.b.x, this.b.y);
    };

    // Initial draw — defer so getBoundingClientRect has stable layout.
    requestAnimationFrame(redraw);
    window.addEventListener('resize', redraw);

    /** Clamp viewBox dimension to the allowed zoom range. */
    const clampW = (w: number) => Math.max(this.imgW * 0.02, Math.min(this.imgW * 4, w));

    /** Apply a discrete zoom around a natural-coord anchor point. */
    const zoomAround = (anchor: { x: number; y: number }, factor: number) => {
      const [vx, vy, vw, vh] = this.vb;
      const newW = clampW(vw * factor);
      const newH = newW * (vh / vw);
      this.vb = [
        anchor.x - (anchor.x - vx) * (newW / vw),
        anchor.y - (anchor.y - vy) * (newH / vh),
        newW,
        newH,
      ];
    };

    // Wheel + pointer drag + pinch via the shared Gestures helper. The helper
    // also sets touch-action:none so two-finger pinches don't trigger native
    // browser zoom on touch screens.
    let panStartVb: [number, number, number, number] | null = null;
    let twoLast = { midX: 0, midY: 0, scale: 1 };

    attachGestures(svg, {
      // Skip if the press hit a crosshair handle — its own pointerdown
      // captures and stops propagation, but the gesture helper attaches to
      // the SVG so it still sees the event. Returning false leaves the
      // handle's behaviour intact.
      shouldStart: (e) => !(e.target as Element).closest('.calibration-handle'),

      onWheel: ({ clientX, clientY, factor }) => {
        zoomAround(clientToSvg(clientX, clientY), factor);
        redraw();
      },

      onDrag: (e) => {
        if (e.phase === 'start') {
          panStartVb = [...this.vb];
        } else if (e.phase === 'move' && panStartVb) {
          const ctm = svg.getScreenCTM();
          const ratioX = ctm ? 1 / ctm.a : 1;
          const ratioY = ctm ? 1 / ctm.d : 1;
          this.vb = [
            panStartVb[0] - e.dx * ratioX,
            panStartVb[1] - e.dy * ratioY,
            panStartVb[2],
            panStartVb[3],
          ];
          redraw();
        } else {
          panStartVb = null;
        }
      },

      onTwoFinger: (e) => {
        if (e.phase === 'start') {
          twoLast = { midX: e.midX, midY: e.midY, scale: 1 };
        } else if (e.phase === 'move') {
          // Incremental: per-frame zoom around the current midpoint, then pan
          // by the per-frame midpoint delta. Small per-frame deltas keep the
          // CTM-based ratio close enough to correct without a full re-solve.
          const stepScale = e.scale / twoLast.scale;
          const dxClient  = e.midX - twoLast.midX;
          const dyClient  = e.midY - twoLast.midY;
          twoLast = { midX: e.midX, midY: e.midY, scale: e.scale };

          zoomAround(clientToSvg(e.midX, e.midY), 1 / stepScale);
          const ctm = svg.getScreenCTM();
          const ratioX = ctm ? 1 / ctm.a : 1;
          const ratioY = ctm ? 1 / ctm.d : 1;
          this.vb[0] -= dxClient * ratioX;
          this.vb[1] -= dyClient * ratioY;
          redraw();
        }
      },
    });

    // Drag handles. Capture the offset between the cursor and the crosshair
    // centre at pointerdown so the cross stays under whatever point of itself
    // the user originally grabbed (rather than snapping its centre to the cursor).
    const startHandleDrag = (which: 'a' | 'b') => (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startPt    = eventToSvg(e);
      const handle     = which === 'a' ? this.a : this.b;
      const offX       = handle.x - startPt.x;
      const offY       = handle.y - startPt.y;
      const move = (ev: PointerEvent) => {
        const p  = eventToSvg(ev);
        const cx = Math.max(0, Math.min(this.imgW, p.x + offX));
        const cy = Math.max(0, Math.min(this.imgH, p.y + offY));
        if (which === 'a') this.a = { x: cx, y: cy };
        else                this.b = { x: cx, y: cy };
        redraw();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup',   up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup',   up);
    };
    handleA.addEventListener('pointerdown', startHandleDrag('a'));
    handleB.addEventListener('pointerdown', startHandleDrag('b'));

    // Reset zoom + pan.
    overlay.querySelector<HTMLButtonElement>('.calibration-reset')?.addEventListener('click', () => {
      this.vb = [0, 0, this.imgW, this.imgH];
      redraw();
    });

    overlay.querySelector<HTMLButtonElement>('.calibration-cancel')?.addEventListener('click', () => this.close());
    overlay.querySelector<HTMLButtonElement>('.calibration-save')?.addEventListener('click', async () => {
      const distInput = overlay.querySelector<HTMLInputElement>('.calibration-distance-input')!;
      const squares   = parseFloat(distInput.value);
      if (!isFinite(squares) || squares <= 0) { alert('Enter a positive number of squares.'); return; }
      const px = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
      if (px < 4) { alert('Drag the two crosses further apart before saving.'); return; }
      const pixelsPerSquare = px / squares;
      await MapAssetStore.update(asset.id, {
        pixelsPerSquare,
        calibrationLine: {
          ax: this.a.x, ay: this.a.y,
          bx: this.b.x, by: this.b.y,
          squares,
        },
        // User drew the line themselves — top-trust calibration; the auto-
        // detector will skip this asset on retrofit passes.
        scaleConfidence: 'manual',
        // Re-calibrating a map clears any prior "no grid" opt-out.
        noGrid: false,
      });
      this.close();
    });

    return overlay;
  }

  private _esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
  }
}
