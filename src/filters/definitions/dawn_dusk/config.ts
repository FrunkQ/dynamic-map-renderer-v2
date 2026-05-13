import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id:          'dawn_dusk',
  name:        'Dawn / Dusk',
  description: 'Warm-cool colour grading + soft vignette. Slide between pre-dawn blue-pink and rich dusk orange.',
  animated:    false,
  vertexShader,
  fragmentShader,
  params: [
    { type: 'slider', id: 'intensity',  label: 'Intensity',  min: 0, max: 1,   step: 0.01, default: 0.7  },
    { type: 'slider', id: 'warmth',     label: 'Warmth',     min: 0, max: 1,   step: 0.01, default: 0.8  },
    { type: 'slider', id: 'saturation', label: 'Saturation', min: 0, max: 1.5, step: 0.01, default: 1.1  },
    { type: 'slider', id: 'vignette',   label: 'Vignette',   min: 0, max: 1,   step: 0.01, default: 0.55 },
  ],
};

export default definition;
