/**
 * HamburgerMenu — small dropdown anchored to the GM brand block.
 *
 * Lives at the top-right of the sidebar's brand block; opens a vertical list
 * of "rarely accessed" actions (About, theme, splash editor, etc.). Other
 * subsystems register items via `addItem()`; the order of registration is the
 * display order, with `footer: true` items pushed to the bottom (separated
 * by a divider) so things like About sit consistently at the foot.
 *
 * Closes on item select, click outside, or Escape.
 */
export interface HamburgerItem {
  label: string;
  onSelect: () => void;
  /** Render at the bottom of the menu, separated from top items by a divider. */
  footer?: boolean;
  disabled?: boolean;
  /** Render as a destructive / red item (red text, hover keeps the colour).
   *  Used for actions that wipe data — paired with a confirm in the handler. */
  danger?: boolean;
}

export class HamburgerMenu {
  private btn: HTMLButtonElement;
  private menu: HTMLElement;
  private items: HamburgerItem[] = [];
  private isOpen = false;

  constructor(btn: HTMLButtonElement, menu: HTMLElement) {
    this.btn = btn;
    this.menu = menu;
    this.menu.hidden = true;

    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    document.addEventListener('mousedown', this._onDocMouseDown, true);
    document.addEventListener('keydown', this._onKey);

    this._render();
  }

  addItem(item: HamburgerItem): void {
    this.items.push(item);
    this._render();
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.menu.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.menu.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private _render(): void {
    this.menu.replaceChildren();
    const top    = this.items.filter((i) => !i.footer);
    const bottom = this.items.filter((i) =>  i.footer);

    for (const item of top) this.menu.appendChild(this._renderItem(item));

    if (top.length > 0 && bottom.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'gm-menu-sep';
      this.menu.appendChild(sep);
    }

    for (const item of bottom) this.menu.appendChild(this._renderItem(item));
  }

  private _renderItem(item: HamburgerItem): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'gm-menu-item';
    el.textContent = item.label;
    el.setAttribute('role', 'menuitem');
    if (item.disabled) {
      el.disabled = true;
      el.classList.add('gm-menu-item--disabled');
    }
    if (item.danger) el.classList.add('gm-menu-item--danger');
    el.addEventListener('click', () => {
      this.close();
      item.onSelect();
    });
    return el;
  }

  private _onDocMouseDown = (e: MouseEvent) => {
    if (!this.isOpen) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (this.menu.contains(target) || this.btn.contains(target)) return;
    this.close();
  };

  private _onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      this.close();
    }
  };
}
