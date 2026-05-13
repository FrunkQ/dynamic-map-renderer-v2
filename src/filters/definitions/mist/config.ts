import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'mist',
  name:        'Mist',
  description: 'Slow-drifting low-frequency noise blanket — painterly fog overlay with optional ground-pool bias.',
  animated:    true,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'intensity',  label: 'Intensity',  min: 0,    max: 1,  step: 0.01, default: 0.55                  },
    { type: 'slider', id: 'scale',      label: 'Scale',      min: 0.5,  max: 8,  step: 0.1,  default: 2.5                   },
    { type: 'slider', id: 'speed',      label: 'Drift Speed',min: 0,    max: 3,  step: 0.05, default: 0.8                   },
    { type: 'slider', id: 'groundPool', label: 'Ground Pool',min: 0,    max: 1,  step: 0.01, default: 0.4                   },
    { type: 'color',  id: 'mistColor',  label: 'Mist Colour',                                default: '#d8dde2'              },
  ],
};

export default definition;
