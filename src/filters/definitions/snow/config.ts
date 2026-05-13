import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'snow',
  name:        'Snow',
  description: 'Slow-drifting flakes with parallax depth + optional cool tint.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'intensity', label: 'Intensity', min: 0,    max: 1,    step: 0.01, default: 0.75 },
    { type: 'slider', id: 'density',   label: 'Density',   min: 0.01, max: 0.40, step: 0.01, default: 0.18 },
    { type: 'slider', id: 'speed',     label: 'Fall Speed',min: 0.05, max: 2,    step: 0.05, default: 0.5  },
    { type: 'slider', id: 'sway',      label: 'Drift',     min: 0,    max: 2,    step: 0.05, default: 1.0  },
    { type: 'slider', id: 'coolTint',  label: 'Cool Tint', min: 0,    max: 1,    step: 0.01, default: 0.35 },
  ],
};

export default definition;
