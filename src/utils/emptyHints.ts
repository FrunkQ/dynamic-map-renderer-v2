/**
 * Rotating flavour copy for empty states. Markers panel uses it for
 * "no tokens placed yet"; Text Map editor uses it as a placeholder
 * for freshly-spawned, still-empty text elements. Goals:
 *   - Reads like a real placeholder, not a system message.
 *   - Doesn't repeat back-to-back (the _lastX trackers avoid this
 *     when the GM cycles through several empty states in a row).
 *   - Keeps the GM mildly amused while pointing at the obvious
 *     next action.
 */

const MARKER_EMPTY_POOL: readonly string[] = [
  'No tokens placed. The board is yours.',
  "Empty map. Right-click anywhere to drop a marker — or hit + Add Marker if you're being civilised.",
  'No one home. Roll an encounter or just place a token.',
  'The field is clear. For now.',
  "Nothing to track yet. The players don't know it's an ambush.",
];

const TEXTBOX_EMPTY_POOL: readonly string[] = [
  'Type something. Or roll for what to write.',
  'A dramatic flourish goes here.',
  'The party finds a sign. It is blank.',
  'Empty text box. Mysterious.',
  'Bold text? Italic? Underlined? CTRL-B, CTRL-I, CTRL-U.',
  'Backstory. Lore. A shopping list. Your call.',
  'Insert ominous prophecy here.',
  'The note reads: __________________.',
  'You. Yes you. Add some words.',
  'Translation: [pending].',
  'Forgotten lore. Or not yet written.',
  'A scribbled note, illegible until you start typing.',
  'What does this say? Even you don’t know yet.',
  'Roll for inspiration, then write it down.',
];

let _lastMarkerEmpty = -1;
export function pickMarkerEmptyHint(): string {
  return _pickFrom(MARKER_EMPTY_POOL, (i) => { _lastMarkerEmpty = i; }, _lastMarkerEmpty);
}

let _lastTextbox = -1;
export function pickTextboxEmptyHint(): string {
  return _pickFrom(TEXTBOX_EMPTY_POOL, (i) => { _lastTextbox = i; }, _lastTextbox);
}

function _pickFrom(pool: readonly string[], remember: (i: number) => void, last: number): string {
  if (pool.length === 0) return '';
  let i = Math.floor(Math.random() * pool.length);
  if (i === last && pool.length > 1) i = (i + 1) % pool.length;
  remember(i);
  return pool[i]!;
}
