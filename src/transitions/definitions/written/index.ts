import type { TransitionDefinition } from '../../schema.ts';
import { animate, linear } from '../../easing.ts';

/**
 * "Written" — slow top-to-bottom soft reveal, like ink appearing on a
 * page line by line. The snapshot of the OLD frame (background +
 * "Don't animate" elements, in a handout reveal) is wiped away from
 * the top down with a soft gradient band; the new frame underneath
 * (background + ALL elements) shows through behind the band.
 *
 * Visually: a horizontal "ink edge" descends down the page at constant
 * speed; above it the page reads as fully revealed, below it the
 * starting frame is still showing, with a soft fade in between
 * (controlled by Line Width).
 *
 * Designed for handout reveals — gentle, readable, evokes hand-
 * writing being inked across the page. Default 30s for a slow reveal
 * that feels deliberate; user can shorten or extend per handout.
 */
export default {
  id: 'written',
  label: 'Written',
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
    {
      type: 'select',
      id: 'direction',
      label: 'Direction',
      options: [
        { value: 'down',  label: '↓ Top to bottom' },
        { value: 'up',    label: '↑ Bottom to top' },
        { value: 'right', label: '→ Left to right' },
        { value: 'left',  label: '← Right to left' },
      ],
      default: 'down',
    },
  ],

  async play({ overlay, snapshot, params, signal }) {
    const duration  = (params['duration']   as number) ?? 30000;
    const lineWidth = (params['line_width'] as number) ?? 8;
    const direction = (params['direction']  as string) ?? 'down';
    const ctx = overlay.getContext('2d')!;
    const { width: w, height: h } = overlay;

    // Soft-band half-thickness in pixels, computed from "% of page" along
    // the sweep axis so the visual softness reads the same on different
    // aspect ratios.
    const isVertical = direction === 'down' || direction === 'up';
    const axisLen    = isVertical ? h : w;
    const bandHalf   = Math.max(2, Math.round((lineWidth / 100) * axisLen * 0.5));

    await animate(duration, (t) => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);

      // Erase the "already revealed" portion of the snapshot with a
      // gradient at the edge so the reveal feels soft, not sharp.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';

      switch (direction) {
        case 'down': {
          const edge = t * h;
          // Solid erase above the band.
          if (edge > bandHalf) {
            ctx.fillStyle = 'rgba(0,0,0,1)';
            ctx.fillRect(0, 0, w, edge - bandHalf);
          }
          // Gradient band straddling the edge.
          const top = Math.max(0, edge - bandHalf);
          const bot = Math.min(h, edge + bandHalf);
          if (bot > top) {
            const g = ctx.createLinearGradient(0, top, 0, bot);
            g.addColorStop(0, 'rgba(0,0,0,1)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, top, w, bot - top);
          }
          break;
        }
        case 'up': {
          const edge = (1 - t) * h;
          if (edge + bandHalf < h) {
            ctx.fillStyle = 'rgba(0,0,0,1)';
            ctx.fillRect(0, edge + bandHalf, w, h - (edge + bandHalf));
          }
          const top = Math.max(0, edge - bandHalf);
          const bot = Math.min(h, edge + bandHalf);
          if (bot > top) {
            const g = ctx.createLinearGradient(0, top, 0, bot);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = g;
            ctx.fillRect(0, top, w, bot - top);
          }
          break;
        }
        case 'right': {
          const edge = t * w;
          if (edge > bandHalf) {
            ctx.fillStyle = 'rgba(0,0,0,1)';
            ctx.fillRect(0, 0, edge - bandHalf, h);
          }
          const lft = Math.max(0, edge - bandHalf);
          const rgt = Math.min(w, edge + bandHalf);
          if (rgt > lft) {
            const g = ctx.createLinearGradient(lft, 0, rgt, 0);
            g.addColorStop(0, 'rgba(0,0,0,1)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(lft, 0, rgt - lft, h);
          }
          break;
        }
        case 'left': {
          const edge = (1 - t) * w;
          if (edge + bandHalf < w) {
            ctx.fillStyle = 'rgba(0,0,0,1)';
            ctx.fillRect(edge + bandHalf, 0, w - (edge + bandHalf), h);
          }
          const lft = Math.max(0, edge - bandHalf);
          const rgt = Math.min(w, edge + bandHalf);
          if (rgt > lft) {
            const g = ctx.createLinearGradient(lft, 0, rgt, 0);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = g;
            ctx.fillRect(lft, 0, rgt - lft, h);
          }
          break;
        }
      }

      ctx.restore();
    }, linear, signal);
  },
} satisfies TransitionDefinition;
