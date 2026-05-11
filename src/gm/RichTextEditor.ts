import { sanitizeSplashHtml } from '../utils/sanitizeHtml.ts';

/**
 * RichTextEditor — shared toolbar + contentEditable used by the About
 * dialog (splash body) and the Text Map editor (handout body).
 *
 * Uses `document.execCommand` (deprecated-but-supported) for bold /
 * italic / alignment / lists / colour / fontName. Output is sanitised on
 * save by the consumer via sanitizeSplashHtml; this module never trusts
 * raw input either — pastes are converted to plain text.
 *
 * Options control which toolbar groups appear and which custom hooks
 * fire (e.g. inline-icon insertion is wired up via `onInsertIcon`).
 */

export interface RichTextEditorOptions {
  /** Initial body HTML. Sanitised before insertion. */
  initialHtml?:   string;
  /** Placeholder text shown when the editor is empty. */
  placeholder?:   string;
  /** Fires whenever the editor content changes. Receives the live HTML. */
  onChange:       (html: string) => void;
  /** Show the [Font] dropdown in the toolbar. Default: true. About uses it
   *  for system / serif / mono / display. Text Maps disable it because the
   *  page font is governed at the page level. */
  showFontPicker?: boolean;
  /** When set, replaces the default font list. */
  fontOptions?:   ReadonlyArray<{ label: string; value: string }>;
  /** Show the colour picker. Default: true. */
  showColourPicker?: boolean;
  /** Default colour for the picker. */
  defaultColour?: string;
  /** Show the [Insert icon] button. When the user clicks it, this callback
   *  is invoked — it should resolve with an `<img src="asset:<uuid>">` HTML
   *  string (or null if the user cancels). Implementations typically open
   *  the Image Library in pick mode. */
  onInsertIcon?:  () => Promise<string | null>;
}

const DEFAULT_FONTS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'System',  value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Serif',   value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono',    value: '"JetBrains Mono", "Fira Code", monospace' },
  { label: 'Display', value: '"Trebuchet MS", "Lucida Sans", sans-serif' },
];

export function createRichTextEditor(opts: RichTextEditorOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rte';

  const tb = document.createElement('div');
  tb.className = 'rte-toolbar';
  // Buttons must NOT steal focus from the editable region — clicking them
  // while text is selected has to keep the selection alive for execCommand.
  tb.addEventListener('mousedown', (e) => e.preventDefault());

  const editor = document.createElement('div');
  editor.className = 'rte-editor select-full';
  editor.contentEditable = 'true';
  editor.spellcheck = true;

  if ((opts.initialHtml ?? '').trim().length > 0) {
    editor.innerHTML = sanitizeSplashHtml(opts.initialHtml!);
  }
  editor.dataset.placeholder = opts.placeholder ?? 'Type here…';

  const exec = (cmd: string, value?: string): void => {
    editor.focus();
    document.execCommand(cmd, false, value);
    opts.onChange(editor.innerHTML);
  };

  const mkBtn = (
    label: string,
    title: string,
    onClick: () => void,
    style?: { bold?: boolean; italic?: boolean },
  ): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rte-btn';
    b.title = title;
    b.textContent = label;
    if (style?.bold)   b.style.fontWeight = '700';
    if (style?.italic) b.style.fontStyle  = 'italic';
    b.addEventListener('click', onClick);
    return b;
  };

  const sep = (): HTMLElement => {
    const s = document.createElement('span');
    s.className = 'rte-sep';
    return s;
  };

  tb.appendChild(mkBtn('B', 'Bold (Ctrl+B)',     () => exec('bold'),     { bold: true }));
  tb.appendChild(mkBtn('I', 'Italic (Ctrl+I)',   () => exec('italic'),   { italic: true }));
  tb.appendChild(mkBtn('U', 'Underline (Ctrl+U)', () => exec('underline')));

  tb.appendChild(sep());

  tb.appendChild(mkBtn('⯇', 'Align left',   () => exec('justifyLeft')));
  tb.appendChild(mkBtn('═', 'Align centre', () => exec('justifyCenter')));
  tb.appendChild(mkBtn('⯈', 'Align right',  () => exec('justifyRight')));

  tb.appendChild(sep());

  tb.appendChild(mkBtn('• List',  'Bulleted list', () => exec('insertUnorderedList')));
  tb.appendChild(mkBtn('1. List', 'Numbered list', () => exec('insertOrderedList')));

  if (opts.showFontPicker !== false) {
    tb.appendChild(sep());
    const fontSel = document.createElement('select');
    fontSel.className = 'rte-select';
    fontSel.title = 'Font';
    for (const f of opts.fontOptions ?? DEFAULT_FONTS) {
      const o = document.createElement('option');
      o.value = f.value;
      o.textContent = f.label;
      fontSel.appendChild(o);
    }
    fontSel.addEventListener('change', () => exec('fontName', fontSel.value));
    fontSel.addEventListener('mousedown', (e) => e.stopPropagation());
    tb.appendChild(fontSel);
  }

  if (opts.showColourPicker !== false) {
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.title = 'Text colour';
    colour.className = 'rte-color';
    colour.value = opts.defaultColour ?? '#c8d8e8';
    colour.addEventListener('input', () => exec('foreColor', colour.value));
    colour.addEventListener('mousedown', (e) => e.stopPropagation());
    tb.appendChild(colour);
  }

  if (opts.onInsertIcon) {
    tb.appendChild(sep());
    const iconBtn = mkBtn('🖼', 'Insert icon from Small Assets Library', async () => {
      // Save the caret position BEFORE opening the picker — the modal
      // steals focus and wipes the editor's selection, so we can't rely
      // on it surviving the round trip. If there was no selection yet,
      // fall back to a Range at the end of the editor so the icon still
      // lands somewhere visible.
      const saved = _saveEditorRange(editor);
      const html = await opts.onInsertIcon!();
      if (!html) return;
      editor.focus();
      _restoreRange(saved, editor);
      // execCommand insertHTML lays the HTML at the current selection.
      document.execCommand('insertHTML', false, html);
      opts.onChange(editor.innerHTML);
    });
    iconBtn.style.fontSize = '0.95em';
    tb.appendChild(iconBtn);
  }

  wrap.append(tb, editor);

  editor.addEventListener('input', () => {
    opts.onChange(editor.innerHTML);
  });
  // Strip rich formatting from paste — keeps the editor predictable and
  // avoids hauling in random remote styles.
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  });

  return wrap;
}

/** Capture the current selection range IF it lives inside the editor. */
function _saveEditorRange(editor: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

/** Restore a previously saved Range, or fall back to a collapsed Range
 *  at the end of the editor so insertHTML still has somewhere to land. */
function _restoreRange(saved: Range | null, editor: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  if (saved && editor.contains(saved.commonAncestorContainer)) {
    sel.addRange(saved);
    return;
  }
  const tail = document.createRange();
  tail.selectNodeContents(editor);
  tail.collapse(false);
  sel.addRange(tail);
}
