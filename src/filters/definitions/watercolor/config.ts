import type { FilterDefinition } from '../../schema.ts';
import vertexShader from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id: 'watercolor',
  name: 'Watercolour',
  description: 'Ink outline + watercolour wash. Suits hand-painted fantasy or nautical maps. Original algorithm by florian berger (flockaroo) — CC BY-NC-SA 3.0.',
  vertexShader,
  fragmentShader,
  textures: [
    { uniformName: 'uNoise', file: 'noise.png', wrapS: 'repeat', wrapT: 'repeat' },
    { uniformName: 'uPaper', file: 'paper.jpg', wrapS: 'repeat', wrapT: 'repeat' },
  ],
  groups: [
    { id: 'paint',  label: 'Paint' },
    { id: 'paper',  label: 'Paper' },
  ],
  params: [
    { type: 'slider', id: 'outlineStrength', label: 'Outline Strength', min: 0.3, max: 2.0, step: 0.05, default: 0.9,  group: 'paint' },
    { type: 'slider', id: 'washStrength',    label: 'Wash Strength',    min: 0.3, max: 2.0, step: 0.05, default: 1.2,  group: 'paint' },
    { type: 'slider', id: 'vignette',        label: 'Vignette',         min: 0,   max: 8.0, step: 0.2,  default: 2.0,  group: 'paint' },
    { type: 'slider', id: 'warmth',          label: 'Paper Warmth',     min: 0.7, max: 1.2, step: 0.01, default: 1.0,  group: 'paper' },
    { type: 'slider', id: 'paperGrain',      label: 'Paper Grain',      min: 0,   max: 2.0, step: 0.05, default: 0.8,  group: 'paper' },
  ],
};

export default definition;
