import type { TransitionDefinition } from '../../schema.ts';
import { animate, easeIn, easeOut } from '../../easing.ts';

export default {
  id: 'fade',
  label: 'Fade to Black',
  params: [
    {
      type: 'slider',
      id: 'duration',
      label: 'Duration',
      min: 200,
      max: 3000,
      step: 100,
      default: 800,
      unit: 'ms',
    },
  ],

  async play({ overlay, snapshot, params, triggerChange }) {
    const duration = (params['duration'] as number) ?? 800;
    const ctx = overlay.getContext('2d')!;
    const { width: w, height: h } = overlay;

    // Phase 1: snapshot fades to black
    await animate(duration / 2, (t) => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);
      ctx.fillStyle = `rgba(0,0,0,${t})`;
      ctx.fillRect(0, 0, w, h);
    }, easeIn);

    // Apply the map change — new map loads in Three.js underneath
    triggerChange();

    // Phase 2: black overlay fades out, revealing new frame
    await animate(duration / 2, (t) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = `rgba(0,0,0,${1 - t})`;
      ctx.fillRect(0, 0, w, h);
    }, easeOut);
  },
} satisfies TransitionDefinition;
