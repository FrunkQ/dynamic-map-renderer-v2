import type { FilterDefinition, FilterParam } from './schema.ts';
import type { FilterParamValues } from '../types.ts';

/**
 * FilterPanel
 *
 * Auto-generates a DOM control panel from a FilterDefinition.
 * Caller provides a container element and a change callback.
 * No framework dependencies — pure DOM manipulation.
 */
export class FilterPanel {
  private container: HTMLElement;
  private onChangeCallback: (values: FilterParamValues) => void;
  private currentValues: FilterParamValues = {};

  constructor(
    container: HTMLElement,
    onChange: (values: FilterParamValues) => void
  ) {
    this.container = container;
    this.onChangeCallback = onChange;
  }

  /** Renders controls for the given filter, pre-populated with saved values */
  render(filter: FilterDefinition, savedValues: FilterParamValues): void {
    this.container.innerHTML = '';
    this.currentValues = { ...savedValues };

    if (filter.params.length === 0) {
      this.container.innerHTML = '<p class="filter-empty">No parameters for this filter.</p>';
      return;
    }

    const groups = this.buildGroups(filter);

    for (const [groupId, params] of groups) {
      const groupDef = filter.groups?.find((g) => g.id === groupId);
      const wrapper = this.buildGroupWrapper(groupId, groupDef?.label ?? groupId, groupDef?.collapsed ?? false);
      const body = wrapper.querySelector('.filter-group-body') as HTMLElement;

      for (const param of params) {
        body.appendChild(this.buildControl(param));
      }

      this.container.appendChild(wrapper);
    }
  }

  /** Updates control values without re-rendering (e.g. on remote state sync) */
  setValues(values: FilterParamValues): void {
    this.currentValues = { ...values };
    for (const [id, value] of Object.entries(values)) {
      const el = this.container.querySelector(`[data-param-id="${id}"]`) as HTMLInputElement | null;
      if (!el) continue;
      if (el.type === 'checkbox') {
        el.checked = Boolean(value);
      } else {
        el.value = String(value);
        this.syncValueDisplay(el);
      }
    }
  }

  getCurrentValues(): FilterParamValues {
    return { ...this.currentValues };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private buildGroups(filter: FilterDefinition): Map<string, FilterParam[]> {
    const groups = new Map<string, FilterParam[]>();
    const ungroupedKey = '__ungrouped__';

    for (const param of filter.params) {
      const key = param.group ?? ungroupedKey;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(param);
    }

    // Move ungrouped to front
    if (groups.has(ungroupedKey)) {
      const ungrouped = groups.get(ungroupedKey)!;
      groups.delete(ungroupedKey);
      const ordered = new Map([[ungroupedKey, ungrouped], ...groups]);
      return ordered;
    }

    return groups;
  }

  private buildGroupWrapper(id: string, label: string, collapsed: boolean): HTMLElement {
    const section = document.createElement('section');
    section.className = 'filter-group';

    if (id === '__ungrouped__') {
      const body = document.createElement('div');
      body.className = 'filter-group-body';
      section.appendChild(body);
      return section;
    }

    const header = document.createElement('button');
    header.className = 'filter-group-header';
    header.setAttribute('aria-expanded', String(!collapsed));
    header.textContent = label;
    header.addEventListener('click', () => {
      const expanded = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
    });

    const body = document.createElement('div');
    body.className = 'filter-group-body';
    body.hidden = collapsed;

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  private buildControl(param: FilterParam): HTMLElement {
    switch (param.type) {
      case 'slider': return this.buildSlider(param);
      case 'toggle': return this.buildToggle(param);
      case 'color':  return this.buildColor(param);
      case 'select': return this.buildSelect(param);
    }
  }

  private buildSlider(param: Extract<FilterParam, { type: 'slider' }>): HTMLElement {
    const row = this.createRow(param.id, param.label);
    const value = (this.currentValues[param.id] as number) ?? param.default;

    const display = document.createElement('span');
    display.className = 'param-value';
    display.textContent = String(value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(param.min);
    input.max = String(param.max);
    input.step = String(param.step);
    input.value = String(value);
    input.dataset['paramId'] = param.id;

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      display.textContent = String(v);
      this.currentValues[param.id] = v;
      this.onChangeCallback({ ...this.currentValues });
    });

    row.appendChild(input);
    row.appendChild(display);
    return row;
  }

  private buildToggle(param: Extract<FilterParam, { type: 'toggle' }>): HTMLElement {
    const row = this.createRow(param.id, param.label, 'param-row--toggle');
    const value = (this.currentValues[param.id] as boolean) ?? param.default;

    const label = document.createElement('label');
    label.className = 'toggle-switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.dataset['paramId'] = param.id;

    input.addEventListener('change', () => {
      this.currentValues[param.id] = input.checked;
      this.onChangeCallback({ ...this.currentValues });
    });

    const slider = document.createElement('span');
    slider.className = 'toggle-slider';

    label.appendChild(input);
    label.appendChild(slider);
    row.appendChild(label);
    return row;
  }

  private buildColor(param: Extract<FilterParam, { type: 'color' }>): HTMLElement {
    const row = this.createRow(param.id, param.label);
    const value = (this.currentValues[param.id] as string) ?? param.default;

    const input = document.createElement('input');
    input.type = 'color';
    input.value = value;
    input.dataset['paramId'] = param.id;

    input.addEventListener('input', () => {
      this.currentValues[param.id] = input.value;
      this.onChangeCallback({ ...this.currentValues });
    });

    row.appendChild(input);
    return row;
  }

  private buildSelect(param: Extract<FilterParam, { type: 'select' }>): HTMLElement {
    const row = this.createRow(param.id, param.label);
    const value = this.currentValues[param.id] ?? param.default;

    const select = document.createElement('select');
    select.dataset['paramId'] = param.id;

    for (const opt of param.options) {
      const option = document.createElement('option');
      option.value = String(opt.value);
      option.textContent = opt.label;
      if (opt.value === value) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      const raw = select.value;
      const numeric = parseFloat(raw);
      this.currentValues[param.id] = isNaN(numeric) ? raw : numeric;
      this.onChangeCallback({ ...this.currentValues });
    });

    row.appendChild(select);
    return row;
  }

  private createRow(id: string, label: string, extra = ''): HTMLElement {
    const row = document.createElement('div');
    row.className = `param-row ${extra}`.trim();

    const lbl = document.createElement('label');
    lbl.htmlFor = `param-${id}`;
    lbl.textContent = label;

    row.appendChild(lbl);
    return row;
  }

  private syncValueDisplay(input: HTMLInputElement): void {
    const display = input.nextElementSibling;
    if (display?.classList.contains('param-value')) {
      display.textContent = input.value;
    }
  }
}
