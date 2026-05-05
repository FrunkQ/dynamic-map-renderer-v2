import type { TransitionDefinition } from '../../schema.ts';
import { animate, linear } from '../../easing.ts';

export default {
  id: 'scanline',
  label: 'Scanline (Teleprompter)',
  params: [
    {
      type: 'slider',
      id: 'duration',
      label: 'Duration',
      min: 300,
      max: 3000,
      step: 100,
      default: 900,
      unit: 'ms',
    },
    {
      type: 'slider',
      id: 'direction',
      label: 'Direction (0=top 1=bottom)',
      min: 0,
      max: 1,
      step: 1,
      default: 0,
    },
  ],

  async play({ overlay, snapshot, params }) {
    const duration  = (params['duration']  as number) ?? 900;
    const fromTop   = ((params['direction'] as number) ?? 0) === 0;
    const ctx = overlay.getContext('2d')!;
    const { width: w, height: h } = overlay;

    await animate(duration, (t) => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);

      // Punch hole — reveals new Three.js frame (already loaded) underneath
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      if (fromTop) {
        ctx.fillRect(0, 0, w, t * h);
      } else {
        ctx.fillRect(0, (1 - t) * h, w, t * h + 1);
      }
      ctx.restore();

      // Bright horizontal scan line at the boundary
      const lineY = fromTop ? t * h : (1 - t) * h;
      if (lineY > 0 && lineY < h) {
        const glow = ctx.createLinearGradient(0, lineY - 6, 0, lineY + 8);
        glow.addColorStop(0,   'transparent');
        glow.addColorStop(0.35, 'rgba(80,220,80,0.5)');
        glow.addColorStop(0.55, 'rgba(200,255,200,0.95)');
        glow.addColorStop(0.75, 'rgba(80,220,80,0.4)');
        glow.addColorStop(1,   'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(0, lineY - 6, w, 14);
      }
    }, linear);
  },
} satisfies TransitionDefinition;
