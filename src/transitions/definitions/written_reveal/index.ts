import type { TransitionDefinition } from '../../schema.ts';
import { animate, linear } from '../../easing.ts';

/**
 * "Written Reveal" — line-by-line handwriting-style reveal. The page
 * is divided into horizontal lines of `line_width` (% of page height
 * = line thickness). The reveal sweeps left-to-right across the first
 * line, jumps to the start of the next line, sweeps across, and so
 * on — like ink being written one stroke per line.
 *
 * Behind each completed line the new frame underneath shows through
 * (snapshot erased). The current line's leading edge gets a thin
 * cursor mark so the writing motion reads even on a slow sweep.
 *
 * Designed for handout reveals: the slow-pen pacing suits journal
 * entries, scrolls, proclamations. Default 30 s for an unhurried
 * showpiece; line_width controls how many lines the page is split
 * into (smaller % = more lines = more writing strokes).
 */
export default {
  id: 'written_reveal',
  label: 'Written Reveal',
  forHandout: true,
  params: [
    {
      type: 'slider',
      id: 'duration',
      label: 'Duration',
      min: 3000,
      max: 60000,
      step: 1000,
      default: 30000,
      unit: 'ms',
    },
    {
      type: 'slider',
      id: 'line_width',
      label: 'Line width',
      min: 2,
      max: 30,
      step: 1,
      default: 8,
      unit: '% of page',
    },
  ],

  async play({ overlay, snapshot, params, signal }) {
    const duration  = (params['duration']   as number) ?? 30000;
    const lineWidth = (params['line_width'] as number) ?? 8;
    const ctx = overlay.getContext('2d')!;
    const { width: w, height: h } = overlay;

    const lineH    = Math.max(2, (lineWidth / 100) * h);
    const numLines = Math.max(1, Math.ceil(h / lineH));

    await animate(duration, (t) => {
      // Re-paint snapshot fresh every frame so previously-cleared
      // regions stay cleared as we erase progressively.
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);

      // Walk the timeline: how many full lines done + progress through
      // the current line. clamp so a t of exactly 1.0 doesn't index off
      // the end.
      const linePos = t * numLines;
      const currentLine = Math.min(numLines - 1, Math.floor(linePos));
      const lineProgress = Math.min(1, linePos - currentLine);

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';

      // Every line above the current one is fully revealed.
      if (currentLine > 0) {
        ctx.fillRect(0, 0, w, currentLine * lineH);
      }
      // Current line: erase from the left to the cursor position.
      ctx.fillRect(0, currentLine * lineH, lineProgress * w, lineH);
      ctx.restore();

      // Cursor mark — a thin dark stripe at the writing head so the
      // motion is visible even when the underlying frame is mostly
      // empty (e.g. on a fresh proclamation with sparse text). Drops
      // out at t=1 so the final frame is clean.
      if (t < 0.999) {
        const cursorX = lineProgress * w;
        const cursorY = currentLine * lineH;
        ctx.fillStyle = 'rgba(20,20,20,0.55)';
        ctx.fillRect(Math.max(0, cursorX - 1), cursorY, 2, lineH);
      }
    }, linear, signal);
  },
} satisfies TransitionDefinition;
