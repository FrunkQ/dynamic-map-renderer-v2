import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'drunk',
  name:        'Drunk / Poisoned',
  description: 'Slow pendulum wobble + queasy chromatic split + tintable sickly wash. For status-effect reveals.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'wobble',     label: 'Wobble',              min: 0, max: 2,    step: 0.05,  default: 1.0  },
    { type: 'slider', id: 'aberration', label: 'Chromatic Split',     min: 0, max: 0.02, step: 0.0005, default: 0.004 },
    { type: 'slider', id: 'tint',       label: 'Sickly Tint Amount',  min: 0, max: 1,    step: 0.01,  default: 0.6  },
    { type: 'color',  id: 'tintColor',  label: 'Tint Colour',                                          default: '#a8d68a' },
  ],
};

export default definition;
