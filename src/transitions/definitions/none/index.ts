import type { TransitionDefinition } from '../../schema.ts';

export default {
  id: 'none',
  label: 'None (instant)',
  params: [],
  play() {
    return Promise.resolve();
  },
} satisfies TransitionDefinition;
