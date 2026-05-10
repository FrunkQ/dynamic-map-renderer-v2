import {
  type ProjectorSetup,
  type ProjectorSetupType,
  getAllSetups,
  saveSetup,
  deleteSetup,
  getActiveSetupId,
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

/**
 * Manage projector calibration setups. Two paths to set pixelsPerSquare:
 *  - LFD path: pick diagonal inches + resolution → auto-compute
 *  - Projector path: show a 1"-grid overlay; coarse + fine sliders adjust
 *    the grid size; user holds a ruler to the projected surface and dials
 *    in 1 grid square = 1 inch
 *
 * Setups persist in localStorage on this device only. The Projector view
 * picks one as "active" and uses its pixelsPerSquare for the viewport math.
 */
export class ProjectorCalibrationModal {
  private overlay: HTMLElement | null = null;
  private resolver: (() => void) | null = null;

  /** Currently-being-edited setup. Either an existing one or a fresh draft. */
  private draft: ProjectorSetup = this._blankDraft();

  private _resizeHandler = () => this._renderAll();
  private _fullscreenUnsub: (() => void) | null = null;

  open(): Promise<void> {
    this.overlay = this._buildUI();
    document.body.appendChild(this.overlay);
    this._loadActiveOrFirst();
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
      pixelsPerSquare:  96, // sensible default to start
      setupType:        'projector',
      diagonalInches:   55,
      resolutionWidth:  1920,
      resolutionHeight: 1080,
      createdAt:        Date.now(),
    };
  }

  private _loadActiveOrFirst(): void {
    const all       = getAllSetups();
    const activeId  = getActiveSetupId();
    const existing  = activeId ? all.find((s) => s.id === activeId) : all[0];
    if (existing) this.draft = { ...existing };
  }

  private _buildUI(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'pcal-overlay';
    overlay.innerHTML = `
      <div class="pcal-frame">
        <header class="pcal-topbar">
          <div class="pcal-titlewrap">
            <h3>Projector Calibration</h3>
            <p>Tell this device how many of its pixels equal 1&Prime;/25 mm on the surface you&rsquo;re projecting onto. Saved per device.</p>
          </div>
          <div class="pcal-topbar-actions">
            <label class="pcal-saved-label">Saved:</label>
            <select class="pcal-saved-select"></select>
            <button class="btn btn--ghost btn--xs pcal-new" title="Start a new setup">+ New</button>
            <button class="btn btn--danger btn--xs pcal-delete" title="Delete this setup">Delete</button>
            <button class="btn btn--ghost btn--xs pcal-fullscreen" title="Toggle fullscreen — best for ruler-testing the projector">⛶ Fullscreen</button>
            <button class="btn btn--ghost btn--xs pcal-close" title="Close">&times;</button>
          </div>
        </header>

        <section class="pcal-method">
          <label class="pcal-radio"><input type="radio" name="pcal-type" value="lfd" /> Large Format Display (TV / monitor)</label>
          <label class="pcal-radio"><input type="radio" name="pcal-type" value="projector" /> Projector (live grid + ruler)</label>
        </section>

        <div class="pcal-stage">
          <!-- LFD path -->
          <div class="pcal-lfd-pane" hidden>
            <div class="pcal-lfd-grid">
              <label>Diagonal</label>
              <select class="pcal-lfd-diag"></select>
              <label>Resolution</label>
              <select class="pcal-lfd-res"></select>
            </div>
            <p class="pcal-lfd-note">The Projector path lets you fine-tune by ruler if your real-world result drifts from this estimate.</p>
          </div>

          <!-- Projector path: live grid uses ALL the available stage real estate. -->
          <div class="pcal-proj-pane" hidden>
            <canvas class="pcal-proj-grid"></canvas>
            <div class="pcal-proj-ruler-hint">Hold a ruler to the surface — adjust sliders until <strong>one grid square equals 1&Prime; / 25 mm</strong> on the projection.</div>
          </div>
        </div>

        <footer class="pcal-bottombar">
          <div class="pcal-sliders" hidden>
            <label>Coarse</label>
            <input type="range" class="pcal-proj-coarse" min="20" max="300" step="1" />
            <label>Fine</label>
            <input type="range" class="pcal-proj-fine"   min="-15" max="15" step="0.1" />
          </div>
          <span class="pcal-result-value">&mdash;</span>
          <input type="text" class="pcal-name-input" placeholder="Setup name (e.g. Game Room Projector)" />
          <button class="btn btn--ghost   pcal-cancel">Close</button>
          <button class="btn btn--primary pcal-save">Save Setup</button>
        </footer>
      </div>
    `;

    // Wire fixed-content selects.
    const diagSel = overlay.querySelector<HTMLSelectElement>('.pcal-lfd-diag')!;
    diagSel.innerHTML = LFD_DIAGONAL_OPTIONS.map((d) => `<option value="${d}">${d}&Prime;</option>`).join('');
    const resSel  = overlay.querySelector<HTMLSelectElement>('.pcal-lfd-res')!;
    resSel.innerHTML  = LFD_RESOLUTION_OPTIONS.map((r) => `<option value="${r.w}x${r.h}">${r.label}</option>`).join('');

    // Bindings — all just mutate this.draft + re-render.
    overlay.querySelector<HTMLButtonElement>('.pcal-close')?.addEventListener('click', () => this.close());
    overlay.querySelector<HTMLButtonElement>('.pcal-cancel')?.addEventListener('click', () => this.close());
    const fsBtn = overlay.querySelector<HTMLButtonElement>('.pcal-fullscreen');
    if (fsBtn) this._fullscreenUnsub = bindFullscreenButton(fsBtn);
    overlay.querySelector<HTMLButtonElement>('.pcal-new')?.addEventListener('click', () => {
      this.draft = this._blankDraft();
      this._renderAll();
    });
    overlay.querySelector<HTMLButtonElement>('.pcal-delete')?.addEventListener('click', () => {
      const all = getAllSetups();
      if (!all.some((s) => s.id === this.draft.id)) return;
      if (!confirm(`Delete setup "${this.draft.name || '(unnamed)'}"?`)) return;
      deleteSetup(this.draft.id);
      this._loadActiveOrFirst();
      if (!getAllSetups().length) this.draft = this._blankDraft();
      this._renderAll();
    });
    overlay.querySelector<HTMLSelectElement>('.pcal-saved-select')?.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      const found = getAllSetups().find((s) => s.id === id);
      if (found) { this.draft = { ...found }; this._renderAll(); }
    });
    overlay.querySelectorAll<HTMLInputElement>('input[name="pcal-type"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) { this.draft.setupType = r.value as ProjectorSetupType; this._renderAll(); }
      });
    });
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
    overlay.querySelector<HTMLInputElement>('.pcal-proj-coarse')?.addEventListener('input', () => this._recomputeFromProjector());
    overlay.querySelector<HTMLInputElement>('.pcal-proj-fine')?.addEventListener('input',   () => this._recomputeFromProjector());
    overlay.querySelector<HTMLInputElement>('.pcal-name-input')?.addEventListener('input', (e) => {
      this.draft.name = (e.target as HTMLInputElement).value;
    });
    overlay.querySelector<HTMLButtonElement>('.pcal-save')?.addEventListener('click', () => {
      if (!this.draft.name.trim()) {
        const fallback = this.draft.setupType === 'lfd'
          ? `LFD ${this.draft.diagonalInches}" ${this.draft.resolutionWidth}×${this.draft.resolutionHeight}`
          : 'Unnamed Projector';
        this.draft.name = fallback;
      }
      saveSetup({ ...this.draft });
      setActiveSetupId(this.draft.id);
      this._renderAll();
    });

    return overlay;
  }

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

  private _renderAll(): void {
    if (!this.overlay) return;
    const ov = this.overlay;
    const all = getAllSetups();

    // Saved setups dropdown.
    const sel = ov.querySelector<HTMLSelectElement>('.pcal-saved-select')!;
    sel.innerHTML = all.length === 0
      ? '<option value="">(no setups yet)</option>'
      : all.map((s) => `<option value="${s.id}"${s.id === this.draft.id ? ' selected' : ''}>${this._esc(s.name)}</option>`).join('');

    // Setup-type radio.
    ov.querySelectorAll<HTMLInputElement>('input[name="pcal-type"]').forEach((r) => {
      r.checked = r.value === this.draft.setupType;
    });
    ov.querySelector<HTMLElement>('.pcal-lfd-pane')!.hidden  = this.draft.setupType !== 'lfd';
    ov.querySelector<HTMLElement>('.pcal-proj-pane')!.hidden = this.draft.setupType !== 'projector';
    ov.querySelector<HTMLElement>('.pcal-sliders')!.hidden   = this.draft.setupType !== 'projector';

    // LFD selects.
    if (this.draft.diagonalInches) {
      ov.querySelector<HTMLSelectElement>('.pcal-lfd-diag')!.value = String(this.draft.diagonalInches);
    }
    if (this.draft.resolutionWidth && this.draft.resolutionHeight) {
      ov.querySelector<HTMLSelectElement>('.pcal-lfd-res')!.value = `${this.draft.resolutionWidth}x${this.draft.resolutionHeight}`;
    }

    // Projector sliders — bias toward draft.pixelsPerSquare being the coarse value, fine = 0.
    const coarse = ov.querySelector<HTMLInputElement>('.pcal-proj-coarse')!;
    const fine   = ov.querySelector<HTMLInputElement>('.pcal-proj-fine')!;
    if (document.activeElement !== coarse && document.activeElement !== fine) {
      coarse.value = String(Math.round(this.draft.pixelsPerSquare));
      fine.value   = (this.draft.pixelsPerSquare - Math.round(this.draft.pixelsPerSquare)).toFixed(1);
    }

    // Live grid for projector path.
    if (this.draft.setupType === 'projector') {
      this._drawGrid(ov.querySelector<HTMLCanvasElement>('.pcal-proj-grid'));
    }

    // Result + name.
    ov.querySelector<HTMLElement>('.pcal-result-value')!.textContent = `${this.draft.pixelsPerSquare.toFixed(1)} px per 1"/25 mm square`;
    const nameInput = ov.querySelector<HTMLInputElement>('.pcal-name-input')!;
    if (document.activeElement !== nameInput) nameInput.value = this.draft.name;
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

  private _esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
  }
}
