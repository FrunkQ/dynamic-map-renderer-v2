import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'underwater',
  name:        'Underwater Shimmer',
  description: 'Refraction wobble + caustic shimmer + blue-green depth tint. For submerged scenes and watery weirdness.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'distortion', label: 'Refraction',     min: 0, max: 2, step: 0.05, default: 1.0  },
    { type: 'slider', id: 'speed',      label: 'Ripple Speed',   min: 0, max: 3, step: 0.05, default: 1.0  },
    { type: 'slider', id: 'caustics',   label: 'Caustic Bands',  min: 0, max: 1, step: 0.01, default: 0.55 },
    { type: 'slider', id: 'tint',       label: 'Aquatic Tint',   min: 0, max: 1, step: 0.01, default: 0.7  },
  ],
};

export default definition;
