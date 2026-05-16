/**
 * Migration + helpers for the element-canvas text-map model.
 *
 * v2.11 Stream C M2 stored a single rich-text body as `TextMapConfig.bodyHtml`.
 * The element-canvas rewrite (M4) moves to a free-positioned array of
 * text + image boxes in `TextMapConfig.elements`. This helper bridges
 * the two so older saves keep working without a migration sweep on
 * load — the legacy bodyHtml becomes a single full-page text element
 * on first read.
 */

import type {
  TextMapConfig,
  TextMapElement,
  TextMapTextElement,
} from '../types.ts';
import { generateId } from '../utils/id.ts';

/** Resolve a TextMapConfig to its element list. Synthesises a single
 *  full-page text element from the legacy bodyHtml when the config
 *  predates the element-canvas model. Returns a fresh array — callers
 *  can mutate without leaking into the stored config. */
export function ensureTextMapElements(cfg: TextMapConfig): TextMapElement[] {
  if (cfg.elements && cfg.elements.length > 0) {
    return cfg.elements.map((e) => ({ ...e }));
  }
  if (cfg.bodyHtml && cfg.bodyHtml.trim().length > 0) {
    const legacy: TextMapTextElement = {
      id:   'text-legacy-' + generateId(),
      type: 'text',
      x: 6, y: 6, w: 88, h: 88, // near-full-page with breathing room
      html: cfg.bodyHtml,
    };
    return [legacy];
  }
  return [];
}

/** Default element factories used by the editor's "+ Text" / "+ Image"
 *  buttons. New elements land roughly centred at a reasonable size.
 *  Default html is empty so the editor's :empty::before placeholder
 *  (which pulls a random hint from the TEXTBOX_EMPTY_POOL) actually
 *  shows. A hardcoded "Click to edit…" body used to live here, which
 *  filled the element with real text and made it never match :empty —
 *  the GM never saw a joke even though the placeholder code was right. */
export function newTextElement(opts: { html?: string } = {}): TextMapTextElement {
  return {
    id:   'text-' + generateId(),
    type: 'text',
    x: 20, y: 30, w: 60, h: 40,
    html: opts.html ?? '',
  };
}

export function newImageElement(assetId: string): TextMapElement {
  return {
    id:   'img-' + generateId(),
    type: 'image',
    x: 35, y: 35, w: 30, h: 30,
    assetId,
  };
}

/** Clamp an element's geometry to the page bounds. Used during drag /
 *  resize so a box can't be dragged off-page or shrunk to nothing. */
export function clampElementGeometry(el: { x: number; y: number; w: number; h: number }): void {
  const MIN = 5; // % — minimum width / height so the box stays grabbable.
  el.w = Math.max(MIN, Math.min(100, el.w));
  el.h = Math.max(MIN, Math.min(100, el.h));
  el.x = Math.max(0, Math.min(100 - el.w, el.x));
  el.y = Math.max(0, Math.min(100 - el.h, el.y));
}
