/**
 * Cheerful one-liners shown when the GM has paused the player or
 * projector view ("Hold on while the GM faffs..."). One is picked at
 * random each time the bypass toggle flips on, so repeated short
 * pauses don't read the same line twice in a row.
 */
export const FAFF_MESSAGES: readonly string[] = [
  'Hold on… I dropped the dice. Again.',
  'Help… I don’t know how this software works!',
  'Please enjoy our free advert for Mappadux.',
  'No image? A goblin did it and ran away!',
  'And the GM said, "And let there be darkness…"',
  'Just consulting the rulebook. It’s a thick one.',
  'Negotiating with the cat to get off the map.',
  'Refilling the GM’s tea / coffee / whisky.',
  'Briefly questioning every life choice.',
  'The dragon needed a bathroom break.',
  'Stat blocks don’t read themselves.',
  'Quickly retconning what just happened…',
  'Plotting your characters’ inevitable demise.',
  'Pretending I prepared for this.',
  'Inventing a new NPC on the fly.',
  'Yes, you can roll for that. Hold on…',
  'Loading more dramatic music.',
  'A wild Rules Lawyer appears!',
  'Looking up that obscure spell you cast.',
  'Adjusting the encounter difficulty. Quietly.',
  // ── Sci-fi ────────────────────────────────────────────────────────────────
  'Recalibrating the warp coil. Standard procedure.',
  'Hold on — sensors detect something off-screen.',
  'Just venting plasma. Everything’s fine.',
  'Reticulating splines.',
  'Hailing frequencies open. No one’s answering.',
  'Reactor at 102 %. Probably fine.',
  // ── Cthulhu ───────────────────────────────────────────────────────────────
  'SAN check pending. Please hold.',
  'The stars are nearly right.',
  'Something stirs in the basement…',
  // ── v2.12 release batch ──────────────────────────────────────────────────
  'Tuning the river. Apparently every river bends differently.',
  'Painting fire that is somehow blue. Don’t ask.',
  'Picking the perfect shade of haunted mist.',
  'Just feeding the starfield. It’s peckish.',
  'Lining up a magic portal. The receiver said "two minutes".',
  'Calibrating thundercloud lightning. Currently set to "yes".',
  'Counting wave crests. There are many.',
  'Softening edges so the polygons don’t look so… polygonal.',
  'Choosing between "ocean" and "very rough ocean".',
  'Auditioning shaders for the next encounter.',
  // ── v2.12.x release batch (unified shaders + popover UI) ─────────────────
  'Persuading the Aurora that violet really is its colour.',
  'Convincing the embers to rise slightly more dramatically.',
  'Aligning the firestorm. Mostly aligned. Mostly.',
  'The static is having an existential moment. One sec.',
  'Tuning the sun glints on the ocean to "Saturday brochure".',
  'Just letting the dramatic music swell. You’ll thank me.',
  'Re-reading the part of the rulebook nobody else has.',
  'Quickly drawing a corridor I forgot to prep.',
  'Sketching a tavern menu. Mostly mutton.',
  'Picking a voice for the suspicious shopkeeper.',
  // ── v2.14.2 release batch ────────────────────────────────────────────────
  'Calibrating the calibrator.',
  'Counting squares. Some of them are squarer than others.',
  'Sticky button engaged. Painting fog like I mean it.',
  'Lining up the projector against a ruler. The ruler is winning.',
  'Hiding a token name on the player map so they don\'t see the boss.',
  'Locking the brazier into place. It is a very good brazier.',
  'Checking whether 75 DPI counts as "lo-fi".',
  'Asking the windows nicely to close themselves later.',
  'Welcoming a new beta tester. Hi! Maps may behave oddly.',
  'Re-naming everything to "Scaled" because it sounded clever.',
];

let _lastIndex = -1;
export function randomFaffMessage(): string {
  if (FAFF_MESSAGES.length === 0) return '';
  let i = Math.floor(Math.random() * FAFF_MESSAGES.length);
  // Avoid immediate repeats so back-to-back pauses feel varied.
  if (i === _lastIndex) i = (i + 1) % FAFF_MESSAGES.length;
  _lastIndex = i;
  return FAFF_MESSAGES[i]!;
}
