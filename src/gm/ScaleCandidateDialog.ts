import type { ScaleCandidate, ScaleDetection } from '../utils/detectMapScale.ts';

/**
 * Confirm dialog for ambiguous map-scale detection results. Shows the top
 * candidates (up to 3) plus a "No grid" opt-out and a Skip option that
 * leaves the map uncalibrated for manual calibration later.
 */
export type ScaleDialogResult =
  | { kind: 'candidate'; candidate: ScaleCandidate }
  | { kind: 'no-grid' }
  | { kind: 'cancel' };

export interface ScaleDialogInputs {
  detection: ScaleDetection;
  /** Human-friendly map name shown in the header. */
  mapName?:  string;
}

export class ScaleCandidateDialog {
  private overlay:  HTMLElement | null = null;
  private resolver: ((value: ScaleDialogResult) => void) | null = null;
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this._resolve({ kind: 'cancel' });
  };

  open(input: ScaleDialogInputs): Promise<ScaleDialogResult> {
    this.overlay = this._build(input);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(value: ScaleDialogResult): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(value);
    this.resolver = null;
  }

  private _build({ detection, mapName }: ScaleDialogInputs): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // Click-outside-to-dismiss intentionally disabled — use Skip / × / Escape.

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = mapName ? `Map scale — ${mapName}` : 'Map scale';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve({ kind: 'cancel' }));
    header.appendChild(closeX);
    dialog.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.style.padding = 'var(--space-md)';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = 'var(--space-sm)';
    dialog.appendChild(body);

    const intro = document.createElement('p');
    intro.style.margin = '0 0 var(--space-sm) 0';
    intro.style.color = 'var(--text-dim)';
    intro.style.fontSize = '0.9em';
    intro.textContent = detection.alternates.length > 1
      ? 'Multiple grid sizes fit this image. Pick the one that matches the map\'s actual cells, or opt out if it has no grid.'
      : 'One candidate found — confirm or opt out.';
    body.appendChild(intro);

    const radioGroup = 'scale-candidate-' + Math.random().toString(36).slice(2, 8);
    const rows: { radio: HTMLInputElement; candidate: ScaleCandidate | null }[] = [];

    detection.alternates.forEach((candidate, idx) => {
      const { wrap, radio } = this._buildCandidateRow(radioGroup, candidate, idx === 0);
      rows.push({ radio, candidate });
      body.appendChild(wrap);
    });

    const noGrid = this._buildNoGridRow(radioGroup);
    rows.push({ radio: noGrid.radio, candidate: null });
    body.appendChild(noGrid.wrap);

    // Footer
    const footer = document.createElement('div');
    footer.style.padding = 'var(--space-md)';
    footer.style.borderTop = '1px solid var(--border)';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = 'var(--space-sm)';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = 'Skip — calibrate later';
    cancelBtn.addEventListener('click', () => this._resolve({ kind: 'cancel' }));

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn btn--primary';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => {
      const picked = rows.find((r) => r.radio.checked);
      if (!picked) return;
      if (picked.candidate === null) this._resolve({ kind: 'no-grid' });
      else this._resolve({ kind: 'candidate', candidate: picked.candidate });
    });

    footer.append(cancelBtn, applyBtn);
    dialog.appendChild(footer);

    return overlay;
  }

  private _buildCandidateRow(name: string, candidate: ScaleCandidate, isDefault: boolean):
    { wrap: HTMLLabelElement; radio: HTMLInputElement }
  {
    const wrap = document.createElement('label');
    wrap.style.display       = 'flex';
    wrap.style.alignItems    = 'flex-start';
    wrap.style.gap           = 'var(--space-sm)';
    wrap.style.padding       = 'var(--space-sm)';
    wrap.style.border        = '1px solid var(--border)';
    wrap.style.borderRadius  = '4px';
    wrap.style.cursor        = 'pointer';

    const radio = document.createElement('input');
    radio.type     = 'radio';
    radio.name     = name;
    radio.checked  = isDefault;
    radio.style.marginTop = '3px';

    const text = document.createElement('div');
    text.style.flex     = '1';
    text.style.fontSize = '0.95em';

    const main = document.createElement('div');
    main.innerHTML =
      `<strong>${candidate.gridWidth} × ${candidate.gridHeight}</strong> grid · ` +
      `${candidate.pixelsPerSquare} px / square`;
    text.appendChild(main);

    if (candidate.reasons.length > 0) {
      const reasons = document.createElement('div');
      reasons.style.color      = 'var(--text-dim)';
      reasons.style.fontSize   = '0.85em';
      reasons.style.marginTop  = '2px';
      reasons.textContent      = candidate.reasons.join(' · ');
      text.appendChild(reasons);
    }

    wrap.append(radio, text);
    return { wrap, radio };
  }

  private _buildNoGridRow(name: string):
    { wrap: HTMLLabelElement; radio: HTMLInputElement }
  {
    const wrap = document.createElement('label');
    wrap.style.display       = 'flex';
    wrap.style.alignItems    = 'flex-start';
    wrap.style.gap           = 'var(--space-sm)';
    wrap.style.padding       = 'var(--space-sm)';
    wrap.style.border        = '1px dashed var(--border)';
    wrap.style.borderRadius  = '4px';
    wrap.style.cursor        = 'pointer';
    wrap.style.marginTop     = 'var(--space-xs)';

    const radio = document.createElement('input');
    radio.type     = 'radio';
    radio.name     = name;
    radio.style.marginTop = '3px';

    const text = document.createElement('div');
    text.style.flex     = '1';
    text.style.fontSize = '0.95em';

    const main = document.createElement('div');
    main.innerHTML = '<strong>None of these — this map has no grid</strong>';
    text.appendChild(main);

    const hint = document.createElement('div');
    hint.style.color      = 'var(--text-dim)';
    hint.style.fontSize   = '0.85em';
    hint.style.marginTop  = '2px';
    hint.textContent      = 'For handouts, world maps, stat blocks — anything without a 1″ grid';
    text.appendChild(hint);

    wrap.append(radio, text);
    return { wrap, radio };
  }
}
