import type { TransitionDefinition, TransitionParam } from './schema.ts';

/**
 * TransitionPanel
 *
 * Renders parameter controls (sliders + selects) for the currently selected
 * transition definition.  Similar to FilterPanel but simpler — no param groups.
 */
export class TransitionPanel {
  private container: HTMLElement;
  private onChangeFn: (params: Record<string, number | string>) => void;
  private currentParams: Record<string, number | string> = {};

  constructor(
    container: HTMLElement,
    onChange: (params: Record<string, number | string>) => void,
  ) {
    this.container = container;
    this.onChangeFn = onChange;
  }

  /** Rebuild the controls for the given transition, pre-populated with saved values. */
  render(def: TransitionDefinition, savedParams: Record<string, number | string>): void {
    this.container.innerHTML = '';
    this.currentParams = { ...savedParams };

    if (def.id === 'none' || def.params.length === 0) {
      this.container.hidden = true;
      return;
    }

    this.container.hidden = false;
    for (const param of def.params) {
      this.container.appendChild(this.buildControl(param));
    }
  }

  getParams(): Record<string, number | string> {
    return { ...this.currentParams };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private buildControl(param: TransitionParam): HTMLElement {
    switch (param.type) {
      case 'slider': return this.buildSlider(param);
      case 'select': return this.buildSelect(param);
    }
  }

  private buildSlider(param: Extract<TransitionParam, { type: 'slider' }>): HTMLElement {
    const row = this.createRow(param.id, `${param.label}${param.unit ? ` (${param.unit})` : ''}`);
    const value = (this.currentParams[param.id] as number) ?? param.default;

    const input = document.createElement('input');
    input.type  = 'range';
    input.min   = String(param.min);
    input.max   = String(param.max);
    input.step  = String(param.step);
    input.value = String(value);
    input.className = 'transition-slider';

    const numInput = document.createElement('input');
    numInput.type  = 'number';
    numInput.min   = String(param.min);
    numInput.max   = String(param.max);
    numInput.step  = String(param.step);
    numInput.value = String(value);
    numInput.className = 'param-number';

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      numInput.value = String(v);
      this.currentParams[param.id] = v;
      this.onChangeFn({ ...this.currentParams });
    });

    numInput.addEventListener('input', () => {
      const v = Math.max(param.min, Math.min(param.max, parseFloat(numInput.value) || 0));
      input.value = String(v);
      this.currentParams[param.id] = v;
      this.onChangeFn({ ...this.currentParams });
    });

    numInput.addEventListener('blur', () => { numInput.value = input.value; });

    const controls = document.createElement('div');
    controls.className = 'param-controls';
    controls.appendChild(input);
    controls.appendChild(numInput);
    row.appendChild(controls);
    return row;
  }

  private buildSelect(param: Extract<TransitionParam, { type: 'select' }>): HTMLElement {
    const row = this.createRow(param.id, param.label);
    const value = (this.currentParams[param.id] as string) ?? param.default;

    const select = document.createElement('select');
    select.className = 'select-full';
    for (const opt of param.options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === value) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      this.currentParams[param.id] = select.value;
      this.onChangeFn({ ...this.currentParams });
    });

    row.appendChild(select);
    return row;
  }

  private createRow(id: string, label: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'param-row param-row--stacked';

    const lbl = document.createElement('label');
    lbl.htmlFor   = `transition-param-${id}`;
    lbl.textContent = label + ':';

    row.appendChild(lbl);
    return row;
  }
}
