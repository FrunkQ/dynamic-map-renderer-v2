import type { FilterDefinition } from '../../schema.ts';
import vertexShader from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id: 'oil_painting',
  name: 'Oil Painting',
  description: 'Painterly strokes with impasto relief lighting. Single-pass adaptation of Buffer A + Image from flockaroo (Mlcczf) — CC BY-NC-SA 3.0.',
  vertexShader,
  fragmentShader,
  textures: [
    { uniformName: 'uNoise', file: 'noise.png', wrapS: 'repeat', wrapT: 'repeat' },
  ],
  groups: [
    { id: 'strokes',  label: 'Strokes' },
    { id: 'lighting', label: 'Lighting' },
  ],
  params: [
    { type: 'slider', id: 'strokeSize',     label: 'Stroke Size',     min: 0.25, max: 3.0,  step: 0.05,  default: 1.0,  group: 'strokes' },
    { type: 'slider', id: 'saturation',     label: 'Saturation',      min: 0.0,  max: 2.0,  step: 0.05,  default: 1.2,  group: 'strokes' },
    { type: 'slider', id: 'reliefStrength', label: 'Impasto Relief',  min: 50.0, max: 300.0, step: 5.0,  default: 150.0, group: 'lighting' },
    { type: 'slider', id: 'lightAngle',     label: 'Light Angle °',   min: 0.0,  max: 360.0, step: 5.0,  default: 45.0, group: 'lighting' },
    { type: 'slider', id: 'vignette',       label: 'Vignette',        min: 0.0,  max: 1.0,  step: 0.05,  default: 1.0,  group: 'lighting' },
  ],
};

export default definition;
