import {
  type ProjectorSetup,
  type ProjectorSetupType,
  saveSetup,
  setActiveSetupId,
  pixelsPerInchFromLfd,
} from '../projector/calibrationStorage.ts';
import { generateId } from '../utils/id.ts';
import { bindFullscreenButton } from '../utils/fullscreen.ts';

const LFD_DIAGONAL_OPTIONS = [27, 32, 40, 43, 48, 50, 55, 60, 65, 70, 75, 85, 98];
const LFD_RESOLUTION_OPTIONS: Array<{ label: string; w: number; h: number }> = [
  { label: '1280 × 720 (HD)',          w: 1280, h: 720  },
  { label: '1920 × 1080 (FHD/1080p)',  w: 1920, h: 1080 },
  { label: '2560 × 1440 (QHD/1440p)',  w: 2560, h: 1440 },
  { label: '3440 × 1440 (Ultrawide)',  w: 3440, h: 1440 },
  { label: '3840 × 2160 (4K UHD)',     w: 3840, h: 2160 },
  { label: '5120 × 2880 (5K)',         w: 5120, h: 2880 },
];

type Step = 'intro' | 'inputs' | 'name';

/**
 * Projector calibration as a guided 3-step flow:
 *   1. intro  — welcome blurb, pick method (LFD vs projector)
 *   2. inputs — LFD diagonal/res OR projector live grid + sliders
 *   3. name   — final review + name + save
 *
 * The modal always builds a fresh draft. Existing setups are managed from the
 * GM Projection View dropdown — the modal itself doesn't need a saved-setups
 * picker, "+ new", or delete affordance.
 */
export class ProjectorCalibrationModal {
  private overlay: HTMLElement | null = null;
  private resolver: (() => void) | null = null;

  private draft: ProjectorSetup = this._blankDraft();
  private step: Step = 'intro';
  /** True when the modal is the only thing on the page (own window, launched
   *  by the GM with the recommendation to drag onto the projector display). */
  private standalone = false;

  private _resizeHandler = () => this._renderAll();
  private _fullscreenUnsub: (() => void) | null = null;

  open(opts?: { standalone?: boolean }): Promise<void> {
    this.standalone = !!opts?.standalone;
    this.overlay = this._buildUI();
    document.body.appendChild(this.overlay);
    window.addEventListener('resize', this._resizeHandler);
    this._renderAll();
    return new Promise<void>((resolve) => { this.resolver = resolve; });
  }

  private close(): void {
    window.removeEventListener('resize', this._resizeHandler);
    this._fullscreenUnsub?.();
    this._fullscreenUnsub = null;
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    if (this.resolver) { this.resolver(); this.resolver = null; }
  }

  private _blankDraft(): ProjectorSetup {
    return {
      id:               generateId(),
      name:             '',
      pixelsPerSquare:  96,
      setupType:        'projector',
      diagonalInches:   55,
      resolutionWidth:  1920,
      resolutionHeight: 1080,
      createdAt:        Date.now(),
    };
  }

  private _buildUI(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'pcal-overlay';
    overlay.innerHTML = `
      <div class="pcal-frame">
        <header class="pcal-topbar">
          <div class="pcal-titlewrap">
            <h3>Projector Calibration</h3>
            <p class="pcal-step-blurb"></p>
          </div>
          <div class="pcal-topbar-actions">
            <button class="btn btn--ghost btn--xs pcal-fullscreen" title="Toggle fullscreen — best for ruler-testing the projector">⛶ Fullscreen</button>
            <button class="btn btn--ghost btn--xs pcal-close" title="Close">&times;</button>
          </div>
        </header>

        <!-- Step 1 — Intro / pick method -->
        <section class="pcal-step pcal-step-intro" hidden>
          <div class="pcal-standalone-banner" hidden>
            <strong>Drag this window onto your projector or under-table screen</strong>, then toggle Fullscreen (top right). The grid you&rsquo;ll see in the next step needs to be physically projected at scale before you can ruler it.
          </div>
          <p class="pcal-intro-text">
            We need to know how many of this device&rsquo;s pixels equal one inch on the surface you&rsquo;re projecting onto. Pick the kind of display you&rsquo;re calibrating, then we&rsquo;ll walk through it. Calibration is saved on this device only.
          </p>
          <div class="pcal-method">
            <label class="pcal-radio"><input type="radio" name="pcal-type" value="lfd" /> <strong>Large Format Display</strong> &mdash; TV / monitor (uses diagonal + resolution)</label>
            <label class="pcal-radio"><input type="radio" name="pcal-type" value="projector" /> <strong>Projector</strong> &mdash; show a live grid and dial it in with a ruler</label>
          </div>
        </section>

        <!-- Step 2 — Inputs -->
        <section class="pcal-step pcal-step-inputs" hidden>
          <div class="pcal-lfd-pane" hidden>
            <p class="pcal-step-instruction">Tell us your display&rsquo;s diagonal size and resolution.</p>
            <div class="pcal-lfd-grid">
              <label>Diagonal</label>
              <select class="pcal-lfd-diag"></select>
              <label>Resolution</label>
              <select class="pcal-lfd-res"></select>
            </div>
            <p class="pcal-lfd-note">If the result drifts in real-world tests, you can always re-calibrate using the Projector path.</p>
          </div>

          <div class="pcal-proj-pane" hidden>
            <p class="pcal-step-instruction">Hold a ruler to the projection surface and adjust the sliders below until <strong>one grid square equals 1&Prime; / 25&nbsp;mm</strong>.</p>
            <canvas class="pcal-proj-grid"></canvas>
            <div class="pcal-sliders">
              <label>Coarse</label>
              <input type="range" class="pcal-proj-coarse" min="20" max="300" step="1" />
              <label>Fine</label>
              <input type="range" class="pcal-proj-fine"   min="-15" max="15" step="0.1" />
            </div>
          </div>
        </section>

        <!-- Step 3 — Name + save -->
        <section class="pcal-step pcal-step-name" hidden>
          <p class="pcal-step-instruction">Almost done. Give this calibration a name so you can pick it later.</p>
          <div class="pcal-result-row">
            <span class="pcal-result-label">Calibrated:</span>
            <span class="pcal-result-value">&mdash;</span>
          </div>
          <input type="text" class="pcal-name-input" placeholder="e.g. Game Room Projector" />
        </section>

        <footer class="pcal-bottombar">
          <button class="btn btn--ghost   pcal-cancel">Cancel</button>
          <button class="btn btn--ghost   pcal-back" hidden>&larr; Back</button>
          <button class="btn btn--primary pcal-next">Next &rarr;</button>
          <button class="btn btn--primary pcal-save" hidden>Save Setup</button>
        </footer>
      </div>
    `;

    // Wire fixed-content selects.
    const diagSel = overlay.querySelector<HTMLSelectElement>('.pcal-lfd-diag')!;
    diagSel.innerHTML = LFD_DIAGONAL_OPTIONS.map((d) => `<option value="${d}">${d}&Prime;</option>`).join('');
    const resSel  = overlay.querySelector<HTMLSelectElement>('.pcal-lfd-res')!;
    resSel.innerHTML  = LFD_RESOLUTION_OPTIONS.map((r) => `<option value="${r.w}x${r.h}">${r.label}</option>`).join('');

    // Close / cancel — same effect.
    overlay.querySelector<HTMLButtonElement>('.pcal-close')?.addEventListener('click',  () => this.close());
    overlay.querySelector<HTMLButtonElement>('.pcal-cancel')?.addEventListener('click', () => this.close());

    const fsBtn = overlay.querySelector<HTMLButtonElement>('.pcal-fullscreen');
    if (fsBtn) this._fullscreenUnsub = bindFullscreenButton(fsBtn);

    // Step navigation.
    overlay.querySelector<HTMLButtonElement>('.pcal-back')?.addEventListener('click', () => this._goBack());
    overlay.querySelector<HTMLButtonElement>('.pcal-next')?.addEventListener('click', () => this._goNext());
    overlay.querySelector<HTMLButtonElement>('.pcal-save')?.addEventListener('click', () => this._save());

    // Method radios.
    overlay.querySelectorAll<HTMLInputElement>('input[name="pcal-type"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) { this.draft.setupType = r.value as ProjectorSetupType; this._renderAll(); }
      });
    });

    // LFD inputs.
    diagSel.addEventListener('change', () => {
      this.draft.diagonalInches = parseFloat(diagSel.value);
      this._recomputeFromLfd();
      this._renderAll();
    });
    resSel.addEventListener('change', () => {
      const [w, h] = resSel.value.split('x').map(Number);
      this.draft.resolutionWidth  = w;
      this.draft.resolutionHeight = h;
      this._recomputeFromLfd();
      this._renderAll();
    });

    // Projector sliders.
    overlay.querySelector<HTMLInputElement>('.pcal-proj-coarse')?.addEventListener('input', () => this._recomputeFromProjector());
    overlay.querySelector<HTMLInputElement>('.pcal-proj-fine')?.addEventListener('input',   () => this._recomputeFromProjector());

    // Name input.
    overlay.querySelector<HTMLInputElement>('.pcal-name-input')?.addEventListener('input', (e) => {
      this.draft.name = (e.target as HTMLInputElement).value;
      this._refreshSaveEnabled();
    });

    return overlay;
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  private _goNext(): void {
    if (this.step === 'intro')  { this.step = 'inputs'; this._renderAll(); return; }
    if (this.step === 'inputs') { this.step = 'name';   this._renderAll(); return; }
  }

  private _goBack(): void {
    if (this.step === 'inputs') { this.step = 'intro';  this._renderAll(); return; }
    if (this.step === 'name')   { this.step = 'inputs'; this._renderAll(); return; }
  }

  private _save(): void {
    if (!this.draft.name.trim()) {
      const fallback = this.draft.setupType === 'lfd'
        ? `LFD ${this.draft.diagonalInches}" ${this.draft.resolutionWidth}×${this.draft.resolutionHeight}`
        : 'Unnamed Projector';
      this.draft.name = fallback;
    }
    saveSetup({ ...this.draft });
    setActiveSetupId(this.draft.id);
    this.close();
  }

  // ─── Recompute helpers ───────────────────────────────────────────────────

  private _recomputeFromLfd(): void {
    if (!this.draft.diagonalInches || !this.draft.resolutionWidth || !this.draft.resolutionHeight) return;
    this.draft.pixelsPerSquare = pixelsPerInchFromLfd(
      this.draft.diagonalInches,
      this.draft.resolutionWidth,
      this.draft.resolutionHeight,
    );
  }

  private _recomputeFromProjector(): void {
    if (!this.overlay) return;
    const coarse = parseFloat(this.overlay.querySelector<HTMLInputElement>('.pcal-proj-coarse')!.value);
    const fine   = parseFloat(this.overlay.querySelector<HTMLInputElement>('.pcal-proj-fine')!.value);
    this.draft.pixelsPerSquare = Math.max(4, coarse + fine);
    this._renderAll();
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  private _renderAll(): void {
    if (!this.overlay) return;
    const ov = this.overlay;

    // Step pane visibility.
    ov.querySelector<HTMLElement>('.pcal-step-intro')!.hidden  = this.step !== 'intro';
    ov.querySelector<HTMLElement>('.pcal-step-inputs')!.hidden = this.step !== 'inputs';
    ov.querySelector<HTMLElement>('.pcal-step-name')!.hidden   = this.step !== 'name';

    // Standalone banner — only when launched as own window from the GM.
    const banner = ov.querySelector<HTMLElement>('.pcal-standalone-banner');
    if (banner) banner.hidden = !this.standalone;

    // Per-step blurb at the top.
    const blurbEl = ov.querySelector<HTMLElement>('.pcal-step-blurb')!;
    blurbEl.textContent =
      this.step === 'intro'  ? 'Step 1 of 3 — Pick the kind of display.' :
      this.step === 'inputs' ? 'Step 2 of 3 — Dial in the calibration.'  :
                                'Step 3 of 3 — Name and save.';

    // Method radio reflect.
    ov.querySelectorAll<HTMLInputElement>('input[name="pcal-type"]').forEach((r) => {
      r.checked = r.value === this.draft.setupType;
    });

    // Step-2 panes by chosen method.
    ov.querySelector<HTMLElement>('.pcal-lfd-pane')!.hidden  = this.draft.setupType !== 'lfd';
    ov.querySelector<HTMLElement>('.pcal-proj-pane')!.hidden = this.draft.setupType !== 'projector';

    // LFD selects.
    if (this.draft.diagonalInches) {
      ov.querySelector<HTMLSelectElement>('.pcal-lfd-diag')!.value = String(this.draft.diagonalInches);
    }
    if (this.draft.resolutionWidth && this.draft.resolutionHeight) {
      ov.querySelector<HTMLSelectElement>('.pcal-lfd-res')!.value = `${this.draft.resolutionWidth}x${this.draft.resolutionHeight}`;
    }

    // Projector sliders + live grid.
    const coarse = ov.querySelector<HTMLInputElement>('.pcal-proj-coarse')!;
    const fine   = ov.querySelector<HTMLInputElement>('.pcal-proj-fine')!;
    if (document.activeElement !== coarse && document.activeElement !== fine) {
      coarse.value = String(Math.round(this.draft.pixelsPerSquare));
      fine.value   = (this.draft.pixelsPerSquare - Math.round(this.draft.pixelsPerSquare)).toFixed(1);
    }
    if (this.step === 'inputs' && this.draft.setupType === 'projector') {
      this._drawGrid(ov.querySelector<HTMLCanvasElement>('.pcal-proj-grid'));
    }

    // Step-3 result + name.
    ov.querySelector<HTMLElement>('.pcal-result-value')!.textContent =
      `${this.draft.pixelsPerSquare.toFixed(1)} px per 1"/25 mm square`;
    const nameInput = ov.querySelector<HTMLInputElement>('.pcal-name-input')!;
    if (document.activeElement !== nameInput) nameInput.value = this.draft.name;

    // Footer button visibility.
    const back = ov.querySelector<HTMLButtonElement>('.pcal-back')!;
    const next = ov.querySelector<HTMLButtonElement>('.pcal-next')!;
    const save = ov.querySelector<HTMLButtonElement>('.pcal-save')!;
    back.hidden = this.step === 'intro';
    next.hidden = this.step === 'name';
    save.hidden = this.step !== 'name';
    this._refreshSaveEnabled();
  }

  /** Save button stays enabled — empty name auto-falls back to a generated label. */
  private _refreshSaveEnabled(): void {
    if (!this.overlay) return;
    const save = this.overlay.querySelector<HTMLButtonElement>('.pcal-save');
    if (save) save.disabled = false;
  }

  private _drawGrid(canvas: HTMLCanvasElement | null, sizeOverride?: { w: number; h: number }): void {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w   = sizeOverride?.w ?? canvas.clientWidth;
    const h   = sizeOverride?.h ?? canvas.clientHeight;
    canvas.width  = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    if (!sizeOverride) {
      canvas.style.width  = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    const step = this.draft.pixelsPerSquare;
    if (step < 4) return;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = 0; y <= h; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }
}
