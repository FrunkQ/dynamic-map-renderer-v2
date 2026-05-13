import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'heat_haze',
  name:        'Heat Haze',
  description: 'Desert / asphalt shimmer — vertical wobble weighted toward the bottom of the frame + warm wash on highlights.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'shimmer', label: 'Shimmer',  min: 0,    max: 2,    step: 0.05, default: 1.0 },
    { type: 'slider', id: 'speed',   label: 'Speed',    min: 0.1,  max: 3,    step: 0.05, default: 1.0 },
    { type: 'slider', id: 'height',  label: 'Heat Height', min: 0.1, max: 1.0, step: 0.01, default: 0.55 },
    { type: 'slider', id: 'warmth',  label: 'Warmth',   min: 0,    max: 1,    step: 0.01, default: 0.5 },
  ],
};

export default definition;
