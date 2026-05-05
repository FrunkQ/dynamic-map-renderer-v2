import type { FilterDefinition } from '../../schema.ts';
import vertexShader from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id: 'hand_drawing',
  name: 'Hand Drawing',
  description: 'Hatched ink-line sketch with halftone colour. Good for hand-drawn dungeon maps. Original algorithm by florian berger (flockaroo) — CC BY-NC-SA 3.0.',
  vertexShader,
  fragmentShader,
  textures: [
    { uniformName: 'uNoise', file: 'noise.png', wrapS: 'repeat', wrapT: 'repeat' },
  ],
  groups: [
    { id: 'strokes',  label: 'Strokes' },
    { id: 'colour',   label: 'Colour' },
    { id: 'effects',  label: 'Effects', collapsed: true },
  ],
  params: [
    // Strokes
    { type: 'slider', id: 'strokeIntensity', label: 'Stroke Intensity', min: 1.0, max: 6.0, step: 0.1,  default: 3.0,  group: 'strokes' },
    { type: 'slider', id: 'strokeSpread',    label: 'Stroke Width',     min: 0.2, max: 3.0, step: 0.05, default: 1.0,  group: 'strokes' },
    { type: 'slider', id: 'strokeCurl',      label: 'Stroke Curl',      min: 0.0, max: 3.0, step: 0.05, default: 1.0,  group: 'strokes' },
    // Colour
    { type: 'slider', id: 'colour',          label: 'Colour',           min: 0.0, max: 1.0, step: 0.05, default: 1.0,  group: 'colour' },
    { type: 'slider', id: 'vignette',        label: 'Vignette',         min: 0.0, max: 5.0, step: 0.1,  default: 1.5,  group: 'colour' },
    // Effects
    { type: 'slider', id: 'jitter',          label: 'Line Jitter',      min: 0.0, max: 3.0, step: 0.1,  default: 0.0,  group: 'effects' },
    { type: 'toggle', id: 'showKaro',        label: 'Graph-paper Grid', default: false,                 group: 'effects' },
  ],
};

export default definition;
