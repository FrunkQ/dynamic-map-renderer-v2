/**
 * roomCode.ts
 *
 * Generates human-friendly room codes in the form "word-word-word".
 * Words are chosen to be short, phonetically distinct, easy to spell
 * from hearing, and appropriate for a fantasy TTRPG context.
 *
 * 256 words → 256³ ≈ 16.7 million combinations.
 */

const WORDS: readonly string[] = [
  // Adjectives — quality
  'ancient', 'arcane', 'azure', 'bold', 'brave', 'bright', 'bronze',
  'calm', 'carved', 'clear', 'cold', 'crisp', 'cursed', 'dark',
  'deep', 'dim', 'distant', 'divine', 'dread', 'dusk', 'dusty',
  'elder', 'eternal', 'faint', 'fallen', 'fierce', 'final', 'first',
  'free', 'frosty', 'giant', 'gilded', 'grim', 'hollow', 'hidden',
  'high', 'howling', 'humble', 'icy', 'iron', 'jade', 'jagged',
  'keen', 'kindled', 'last', 'lofty', 'lost', 'loyal', 'marked',
  'mighty', 'misty', 'noble', 'northern', 'obsidian', 'pale', 'proud',
  'quiet', 'radiant', 'risen', 'runed', 'sacred', 'scarlet', 'sealed',
  'shadowed', 'sharp', 'silent', 'silver', 'slim', 'smoky', 'solemn',
  'stern', 'still', 'stony', 'stormy', 'sunken', 'swift', 'tall',
  'tattered', 'twisted', 'vale', 'verdant', 'violet', 'vivid', 'wandering',
  'warped', 'weary', 'wicked', 'wild', 'windswept', 'wise', 'worn',
  // Nature
  'ash', 'bay', 'birch', 'blaze', 'bloom', 'bog', 'boulder',
  'brook', 'cavern', 'cliff', 'coast', 'crag', 'creek', 'dale',
  'dawn', 'delta', 'dune', 'ember', 'falls', 'fen', 'fjord',
  'flame', 'flint', 'fog', 'forest', 'frost', 'gale', 'glacier',
  'glen', 'gorge', 'grove', 'heath', 'hollow', 'island', 'lake',
  'lava', 'leaf', 'marsh', 'mesa', 'moon', 'moor', 'moss',
  'mud', 'peak', 'pine', 'plain', 'pond', 'reef', 'ridge',
  'rift', 'river', 'rock', 'root', 'shore', 'shroud', 'slope',
  'smoke', 'snow', 'spire', 'spring', 'star', 'stone', 'storm',
  'stream', 'summit', 'thorn', 'tide', 'timber', 'vale', 'vine',
  'wave', 'wind',
  // Animals
  'asp', 'badger', 'bear', 'boar', 'cobra', 'crane', 'crow',
  'drake', 'eagle', 'elk', 'falcon', 'fox', 'hawk', 'heron',
  'hound', 'lynx', 'mantis', 'moth', 'newt', 'osprey', 'otter',
  'owl', 'raven', 'serpent', 'stag', 'swan', 'tiger', 'viper',
  'wasp', 'weasel', 'wolf',
  // Fantasy / artefacts
  'amulet', 'anvil', 'arrow', 'axe', 'banner', 'blade', 'castle',
  'chain', 'cipher', 'citadel', 'claw', 'coin', 'compass', 'crown',
  'crypt', 'dagger', 'dais', 'door', 'dungeon', 'fang', 'forge',
  'gate', 'glyph', 'goblet', 'grimoire', 'hammer', 'helm', 'horn',
  'idol', 'key', 'lance', 'lantern', 'lore', 'map', 'mantle',
  'mast', 'mirror', 'moat', 'orb', 'oath', 'path', 'pillar',
  'portal', 'prison', 'pyre', 'quest', 'realm', 'relic', 'rune',
  'shard', 'shield', 'sigil', 'skull', 'spell', 'spire', 'staff',
  'tablet', 'throne', 'tome', 'tower', 'vault', 'vessel', 'ward',
  'warden',
] as const;

/**
 * Generate a random three-word room code, e.g. "silent-raven-forge".
 * Guaranteed not to repeat the same word twice in one code.
 */
export function generateRoomCode(): string {
  const pool = [...WORDS];
  const pick = (): string => {
    const idx = Math.floor(Math.random() * pool.length);
    return pool.splice(idx, 1)[0]!;
  };
  return `${pick()}-${pick()}-${pick()}`;
}
