import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'rain',
  name:        'Rain',
  description: 'Top-down rain — expanding ring-ripples where drops strike + wet-surface tint. For battlemaps. Side-view variant: "Rain (Side-View)".',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'intensity', label: 'Intensity',    min: 0,    max: 1,    step: 0.01, default: 0.75 },
    { type: 'slider', id: 'density',   label: 'Splash Density', min: 0.01, max: 0.40, step: 0.01, default: 0.15 },
    { type: 'slider', id: 'speed',     label: 'Splash Speed', min: 0.2,  max: 4,    step: 0.05, default: 1.5  },
    { type: 'slider', id: 'darken',    label: 'Wet Surface',  min: 0,    max: 1,    step: 0.01, default: 0.45 },
  ],
};

export default definition;
