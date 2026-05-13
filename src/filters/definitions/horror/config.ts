import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'horror',
  name:        'Horror Tint',
  description: 'Heartbeat-pulsing red vignette + breathing chromatic aberration. Sells "something is very wrong" before the players read the map.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'intensity',  label: 'Intensity',           min: 0,    max: 1,    step: 0.01, default: 0.85 },
    { type: 'slider', id: 'pulseSpeed', label: 'Heartbeat Speed',     min: 0.1,  max: 2,    step: 0.05, default: 0.45 },
    { type: 'slider', id: 'aberration', label: 'Chromatic Aberration',min: 0,    max: 0.04, step: 0.0005, default: 0.010 },
    { type: 'slider', id: 'redShift',   label: 'Red Shift',           min: 0,    max: 1,    step: 0.01, default: 0.7  },
  ],
};

export default definition;
