import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'rain_side',
  name:        'Rain (Side-View)',
  description: 'Diagonal falling streaks + overcast — for cinematic / side-on scenes. The Rain filter is the top-down battlemap version.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'intensity', label: 'Intensity', min: 0,    max: 1,    step: 0.01, default: 0.7  },
    { type: 'slider', id: 'density',   label: 'Density',   min: 0.01, max: 0.25, step: 0.01, default: 0.08 },
    { type: 'slider', id: 'speed',     label: 'Fall Speed',min: 0.1,  max: 4,    step: 0.05, default: 1.5  },
    { type: 'slider', id: 'wind',      label: 'Wind',      min: -1,   max: 1,    step: 0.05, default: 0.25 },
    { type: 'slider', id: 'darken',    label: 'Overcast',  min: 0,    max: 1,    step: 0.01, default: 0.35 },
  ],
};

export default definition;
