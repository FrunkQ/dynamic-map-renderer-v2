import type { TransitionDefinition } from '../../schema.ts';
import { animate, easeInOut } from '../../easing.ts';

/** Draw a bright edge line along the wipe boundary. */
function drawEdge(
  ctx: CanvasRenderingContext2D,
  direction: string,
  progress: number,
  w: number,
  h: number,
): void {
  const glow = 'rgba(255,255,220,0.8)';
  const fade = 'transparent';

  switch (direction) {
    case 'left': {
      const x = progress * w;
      const g = ctx.createLinearGradient(x - 28, 0, x + 3, 0);
      g.addColorStop(0, fade); g.addColorStop(0.6, 'rgba(255,255,200,0.3)'); g.addColorStop(1, glow);
      ctx.fillStyle = g;
      ctx.fillRect(x - 28, 0, 31, h);
      break;
    }
    case 'right': {
      const x = (1 - progress) * w;
      const g = ctx.createLinearGradient(x - 3, 0, x + 28, 0);
      g.addColorStop(0, glow); g.addColorStop(0.4, 'rgba(255,255,200,0.3)'); g.addColorStop(1, fade);
      ctx.fillStyle = g;
      ctx.fillRect(x - 3, 0, 31, h);
      break;
    }
    case 'up': {
      const y = progress * h;
      const g = ctx.createLinearGradient(0, y - 28, 0, y + 3);
      g.addColorStop(0, fade); g.addColorStop(0.6, 'rgba(255,255,200,0.3)'); g.addColorStop(1, glow);
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 28, w, 31);
      break;
    }
    case 'down': {
      const y = (1 - progress) * h;
      const g = ctx.createLinearGradient(0, y - 3, 0, y + 28);
      g.addColorStop(0, glow); g.addColorStop(0.4, 'rgba(255,255,200,0.3)'); g.addColorStop(1, fade);
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 3, w, 31);
      break;
    }
    default:
      break;
  }
}

export default {
  id: 'wipe',
  label: 'Wipe',
  params: [
    {
      type: 'select',
      id: 'direction',
      label: 'Direction',
      options: [
        { value: 'left',     label: '← Enter from left'   },
        { value: 'right',    label: '→ Enter from right'  },
        { value: 'up',       label: '↑ Enter from top'    },
        { value: 'down',     label: '↓ Enter from bottom' },
        { value: 'diag_tl',  label: '↘ Diagonal TL → BR'  },
        { value: 'diag_tr',  label: '↙ Diagonal TR → BL'  },
      ],
      default: 'left',
    },
    {
      type: 'slider',
      id: 'duration',
      label: 'Duration',
      min: 200,
      max: 2000,
      step: 100,
      default: 600,
      unit: 'ms',
    },
  ],

  async play({ overlay, snapshot, params }) {
    const direction = (params['direction'] as string) ?? 'left';
    const duration  = (params['duration']  as number) ?? 600;
    const ctx = overlay.getContext('2d')!;
    const { width: w, height: h } = overlay;

    await animate(duration, (t) => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);

      // Punch hole in overlay to reveal new Three.js frame underneath
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      switch (direction) {
        case 'left':
          ctx.fillRect(0, 0, t * w, h);
          break;
        case 'right':
          ctx.fillRect((1 - t) * w, 0, t * w + 1, h);
          break;
        case 'up':
          ctx.fillRect(0, 0, w, t * h);
          break;
        case 'down':
          ctx.fillRect(0, (1 - t) * h, w, t * h + 1);
          break;
        case 'diag_tl': {
          const reach = t * (w + h);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.min(reach, w), 0);
          ctx.lineTo(0, Math.min(reach, h));
          if (reach > w) ctx.lineTo(0, reach - w);
          if (reach > h) ctx.lineTo(reach - h, 0);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'diag_tr': {
          const reach = t * (w + h);
          ctx.beginPath();
          ctx.moveTo(w, 0);
          ctx.lineTo(Math.max(w - reach, 0), 0);
          ctx.lineTo(w, Math.min(reach, h));
          if (reach > w) ctx.lineTo(w, reach - w);
          if (reach > h) ctx.lineTo(w - (reach - h), 0);
          ctx.closePath();
          ctx.fill();
          break;
        }
      }
      ctx.restore();

      // Bright edge line — only for cardinal directions
      if (['left', 'right', 'up', 'down'].includes(direction)) {
        drawEdge(ctx, direction, t, w, h);
      }
    }, easeInOut);
  },
} satisfies TransitionDefinition;
