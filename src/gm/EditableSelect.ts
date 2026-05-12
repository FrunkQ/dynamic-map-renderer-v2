/**
 * Custom combobox that wraps a native <select> and lets the user rename the
 * currently selected option in place. Native <select> stays in the DOM as
 * the source of truth — its `.value`, `.options`, and `change` events keep
 * their semantics so existing call sites don't need rewriting.
 *
 * Layout:
 *   ┌────────────────────────────────┬───┐
 *   │ <input>  selected name         │ ▼ │
 *   └────────────────────────────────┴───┘
 *     ┌──────────────────────────────┐
 *     │ • option 1                   │
 *     │ • option 2 (selected)        │   ← popover when chevron clicked
 *     │ + Add New …                  │
 *     └──────────────────────────────┘
 *
 * Click the input to rename. Click the chevron to open the menu. Pick an
 * option to switch selection (fires native change event). Placeholder
 * options (empty value) and sentinel options (.select-option--add class)
 * are non-renamable — the input goes read-only when one of them is
 * selected.
 */

export interface EditableSelectHandlers {
  /** Called when the user commits a rename of the currently selected
   *  option. Host should persist the new label and call refresh() so
   *  the option's text in the native <select> is updated and the menu
   *  rebuilds. The value is the option's `value` attribute. */
  onRename?: (value: string, newLabel: string) => void;
}

export class EditableSelect {
  private root:    HTMLDivElement;
  private input:   HTMLInputElement;
  private chevron: HTMLButtonElement;
  private menu:    HTMLUListElement;

  private native:    HTMLSelectElement;
  private handlers:  EditableSelectHandlers;
  private menuOpen = false;
  /** Captured on focus so Esc / blur-with-empty can revert. */
  private renameOriginal: string | null = null;

  constructor(native: HTMLSelectElement, handlers: EditableSelectHandlers = {}) {
    this.native   = native;
    this.handlers = handlers;

    native.classList.add('editable-select__native');

    this.root = document.createElement('div');
    this.root.className = 'editable-select';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'editable-select__value';
    this.input.spellcheck = false;

    this.chevron = document.createElement('button');
    this.chevron.type = 'button';
    this.chevron.className = 'editable-select__chevron';
    this.chevron.setAttribute('aria-label', 'Open list');
    this.chevron.innerHTML =
      '<svg viewBox="0 0 12 12" width="10" height="10" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
      'stroke-linejoin="round"><polyline points="3,5 6,8 9,5"/></svg>';

    this.menu = document.createElement('ul');
    this.menu.className = 'editable-select__menu';
    this.menu.setAttribute('role', 'listbox');
    this.menu.hidden = true;

    this.root.append(this.input, this.chevron, this.menu);
    native.insertAdjacentElement('afterend', this.root);

    this._bind();
    this.refresh();
  }

  /** Rebuild the menu items from the native <select>'s current options and
   *  sync the input's displayed text. Call after the host mutates the
   *  option list (add / remove / rename) or changes selection
   *  programmatically. Safe to call repeatedly; skips overwriting the
   *  input while the user is editing it. */
  refresh(): void {
    const sel = this.native.options[this.native.selectedIndex];
    if (!this.input.matches(':focus')) {
      this.input.value = sel?.text ?? '';
    }
    const ro = this._isCurrentReadOnly();
    this.input.readOnly = ro;
    this.input.title    = ro ? '' : 'Click to rename';

    this.menu.innerHTML = '';
    for (const opt of Array.from(this.native.options)) {
      const li = document.createElement('li');
      li.className = 'editable-select__opt';
      li.setAttribute('role', 'option');
      li.dataset.value = opt.value;
      li.textContent   = opt.text;
      if (opt.classList.contains('select-option--add')) {
        li.classList.add('editable-select__opt--sentinel');
      }
      if (!opt.value) {
        li.classList.add('editable-select__opt--placeholder');
      }
      if (opt.selected) {
        li.classList.add('editable-select__opt--selected');
      }
      // mousedown not click — fires before the document-level outside-click
      // listener that would otherwise close the menu before pick lands.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._pick(opt.value);
      });
      this.menu.appendChild(li);
    }
  }

  setValue(value: string): void {
    this.native.value = value;
    this.refresh();
  }

  getValue(): string { return this.native.value; }

  private _bind(): void {
    this.chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleMenu();
    });

    this.input.addEventListener('focus', () => {
      this.renameOriginal = this.input.value;
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.input.blur();
      } else if (e.key === 'Escape') {
        if (this.renameOriginal !== null) this.input.value = this.renameOriginal;
        this.renameOriginal = null;
        this.input.blur();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._openMenu();
      }
    });
    this.input.addEventListener('blur', () => this._commitRename());

    // Outside click closes menu. Capture phase so we run before any
    // bubbling listeners that might rebuild the menu mid-click.
    document.addEventListener('click', (e) => {
      if (!this.menuOpen) return;
      if (!this.root.contains(e.target as Node)) this._closeMenu();
    }, true);

    // Programmatic native-select changes (host code setting .value) push
    // through to our display so the two stay in sync.
    this.native.addEventListener('change', () => {
      if (!this.input.matches(':focus')) this.refresh();
    });
  }

  private _isCurrentReadOnly(): boolean {
    const sel = this.native.options[this.native.selectedIndex];
    if (!sel) return true;
    if (!sel.value) return true;
    if (sel.classList.contains('select-option--add')) return true;
    return false;
  }

  private _toggleMenu(): void {
    if (this.menuOpen) this._closeMenu();
    else this._openMenu();
  }

  private _openMenu(): void {
    this.refresh();
    this.menu.hidden = false;
    this.menuOpen = true;
    this.root.classList.add('editable-select--open');
  }

  private _closeMenu(): void {
    this.menu.hidden = true;
    this.menuOpen = false;
    this.root.classList.remove('editable-select--open');
  }

  private _pick(value: string): void {
    this._closeMenu();
    if (value === this.native.value) {
      this.refresh();
      return;
    }
    this.native.value = value;
    this.native.dispatchEvent(new Event('change', { bubbles: true }));
    this.refresh();
  }

  private _commitRename(): void {
    const orig = this.renameOriginal;
    this.renameOriginal = null;
    if (orig === null) return;
    if (this._isCurrentReadOnly()) {
      this.input.value = orig;
      return;
    }
    const next = this.input.value.trim();
    if (next === '' || next === orig) {
      this.input.value = orig;
      return;
    }
    this.handlers.onRename?.(this.native.value, next);
  }
}
