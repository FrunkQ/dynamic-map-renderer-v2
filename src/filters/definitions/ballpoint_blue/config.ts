import type { FilterDefinition } from '../../schema.ts';
import vertexShader from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id: 'ballpoint_blue',
  name: 'Ballpoint Pen',
  description: 'Redraws the map as a ballpoint pen sketch. Stroke paths follow luminance gradients. Original algorithm by florian berger (flockaroo) — CC BY-NC-SA 3.0.',
  vertexShader,
  fragmentShader,
  groups: [
    { id: 'strokes', label: 'Strokes' },
    { id: 'colour',  label: 'Colour' },
  ],
  params: [
    { type: 'slider', id: 'lineScale',    label: 'Line Width',  min: 0.3,  max: 3.0,  step: 0.05, default: 1.0,  group: 'strokes' },
    { type: 'toggle', id: 'overlayMode',  label: 'Overlay on Image', default: false,              group: 'strokes' },
    { type: 'color',  id: 'inkColour',    label: 'Ink Colour',  default: '#1a2b8a',               group: 'colour' },
    { type: 'color',  id: 'paperColour',  label: 'Paper Colour', default: '#f5f0e8',              group: 'colour' },
  ],
};

export default definition;
