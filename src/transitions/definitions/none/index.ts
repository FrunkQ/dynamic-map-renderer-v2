import type { TransitionDefinition } from '../../schema.ts';

export default {
  id: 'none',
  label: 'None (instant)',
  params: [],
  play({ triggerChange }) {
    triggerChange();
    return Promise.resolve();
  },
} satisfies TransitionDefinition;
