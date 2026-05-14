import type { FilterDefinition } from '../../schema.ts';
import vertexShader from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

const definition: FilterDefinition = {
  id: 'parchment_fantasy',
  name: 'Parchment Fantasy',
  description: 'Aged parchment and candlelight. Ideal for fantasy, historical, and gothic settings.',
  vertexShader,
  fragmentShader,
  /**
   * Declares a paper grain texture uniform.
   * FilterRegistry loads paper_grain.webp and passes it as a sampler2D.
   * If the file is absent, FilterRegistry provides a procedural fallback.
   * Replace paper_grain.webp with a photographed paper scan for higher fidelity.
   */
  animated: true,   // candlelight flicker uses time
  textures: [
    {
      uniformName: 'uPaperTexture',
      file: 'paper_grain.png',
      wrapS: 'repeat',
      wrapT: 'repeat',
    },
  ],
  groups: [
    { id: 'color',    label: 'Colour & Age' },
    { id: 'texture',  label: 'Paper Texture' },
    { id: 'effects',  label: 'Effects' },
  ],
  params: [
    // Color & Age
    { type: 'slider', id: 'sepiaStrength',    label: 'Sepia Strength',     min: 0,    max: 1,    step: 0.01,  default: 0.85, group: 'color' },
    { type: 'slider', id: 'warmth',           label: 'Warmth',             min: 0,    max: 1,    step: 0.01,  default: 0.3,  group: 'color' },
    { type: 'slider', id: 'brightness',       label: 'Brightness',         min: 0.5,  max: 1.5,  step: 0.05,  default: 0.95, group: 'color' },
    { type: 'slider', id: 'contrast',         label: 'Contrast',           min: 0.5,  max: 2.0,  step: 0.05,  default: 1.1,  group: 'color' },
    { type: 'slider', id: 'ageSpots',         label: 'Age Spots / Foxing', min: 0,    max: 1,    step: 0.01,  default: 0.55, group: 'color' },
    // Paper Texture
    { type: 'slider', id: 'paperGrain',       label: 'Grain Intensity',    min: 0,    max: 1,    step: 0.01,  default: 0.4,  group: 'texture' },
    { type: 'slider', id: 'paperScale',       label: 'Grain Scale',        min: 0.5,  max: 8.0,  step: 0.5,   default: 2.0,  group: 'texture' },
    { type: 'slider', id: 'paperContrast',    label: 'Grain Contrast',     min: 0,    max: 1,    step: 0.01,  default: 0.5,  group: 'texture' },
    // Effects
    { type: 'slider', id: 'edgeBurn',         label: 'Edge Burn',          min: 0,    max: 1.5,  step: 0.05,  default: 0.6,  group: 'effects' },
    // Ragged Border: torn-paper / burned edge framing. Independent of
    // Edge Burn (which is a soft vignette). 0 = no border, 1 = heavy
    // black tatters eating into the image at the edges.
    { type: 'slider', id: 'raggedBorder',     label: 'Ragged Border',      min: 0,    max: 1,    step: 0.05,  default: 0.5,  group: 'effects' },
    { type: 'slider', id: 'inkSoftening',     label: 'Ink Softening',      min: 0,    max: 1,    step: 0.01,  default: 0.2,  group: 'effects' },
    { type: 'slider', id: 'flicker',          label: 'Candlelight Flicker',min: 0,    max: 0.15, step: 0.005, default: 0.04, group: 'effects' },
  ],
};

export default definition;
