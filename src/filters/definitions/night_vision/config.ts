import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'night_vision',
  name:        'Night Vision',
  description: 'Green-channel image-intensifier scope look with scanlines, grain, and a tight edge vignette.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'greenStrength', label: 'Green Strength', min: 0, max: 1, step: 0.01, default: 0.95 },
    { type: 'slider', id: 'scanlines',     label: 'Scanlines',      min: 0, max: 1, step: 0.01, default: 0.45 },
    { type: 'slider', id: 'grain',         label: 'Grain',          min: 0, max: 1, step: 0.01, default: 0.4  },
    { type: 'slider', id: 'vignetteAmt',   label: 'Scope Vignette', min: 0, max: 1, step: 0.01, default: 0.7  },
  ],
};

export default definition;
