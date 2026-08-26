# Dice — detailed design (v2.19)

Players roll; the table sees what it should; the GM watches it all as chat.
Sets belong to the game, not the person, so they travel in the pack.

## 1. What it is

A GM authors a small **dice set** for the game — a handful of named formulas
("Attack", "1d20+5"). Players get a **tray** of those as chips on their own
screen: one tap is one roll, no dialog, no modifier picker. Results are shown
where the table wants them: animated on the table screen, as a line in a feed
for other players, and always as a chat line for the GM.

The set and the house rules about it travel inside the `.mappadux` bundle, so
handing someone a pack hands them the dice too.

## 2. Data model

### 2.1 The set (travels with the pack)

```ts
interface DiceButton {
  id: string;
  label: string;      // "Attack"
  formula: string;    // "1d20+5"
  public?: boolean;   // GM entry that is loud even when GM rolls are private
}
```

Stored in `localSettings` (`mappadux:dice_set`), collected into
`BundledGmPreferences.diceSet` on export and applied on import — the same route
measurement units and initiative direction already take.

Three presets seed a set in one click so no GM starts from an empty list:
**d20** (d20, adv, dis, the polyhedral spread, 2d6), **d6 pool** (1d6..6d6),
**Fate / Blades** (4dF, 1d6..4d6).

### 2.2 The policy (travels with the pack)

`DicePolicy` in `src/dice/dicePolicy.ts`, defaults in brackets:

| Field | Meaning |
|---|---|
| `playerRollAudience` | who hears a player's roll: `table` [default] / `gm` / `roller` |
| `gmRollsPublic` | GM rolls reach the room [false — private] |
| `othersDetail` | how non-rollers see it: `full` / `line` [default] / `none` |
| `tableDetail` | how the table screen shows it: `full` [default] / `line` / `none` |
| `rollerDetail` | how the roller sees their own: `auto` [default] / `full` / `line` / `none` |

`auto` means: a line when the table screen is already showing it in full,
because everyone is looking up at the table instead of down at their phone.

### 2.3 The viewer's own choice (per device, never travels)

TWO axes, and they are not the same question:

- `mappadux:dice_detail` — `full` | `line` | `none`. How MUCH of a roll reaches
  you. A viewer may always turn spectacle DOWN, never up past the pack's
  ceiling.
- `mappadux:dice_render` — `auto` | `shaped` | `plain`. What dice LOOK like:
  shaped and shaded, or plain numbered tiles. `auto` picks plain when the person
  asked for reduced motion, or the device reports <= 2 GB / <= 2 cores; an
  explicit choice always wins, because this is taste as much as capability.

Both are device settings, so importing a pack never overwrites either.
`resolveDiceRender()` is read at every roll, so a change lands on the next one
rather than on the next reload.

Where they live: the GM's own screen in Settings > Performance ("Dice
appearance"); a player's in their right-click menu, next to "Dice show me".

### 2.4 Permission

`mappadux:player_dice_disabled`, surfaced in Settings > Player Permissions
beside pings and messaging, mirrored to viewers on `MsgPlayerFeatures.dice` and
carried in the bundle as `playerDiceEnabled`. Off means no tray, no menu entry,
and a roll from a stale client is dropped on arrival. The GM's own dice keep
working: rolling for the table is still useful when players may not.

## 3. Precedence

Effective detail for a recipient is the **least** of three layers:

```
pack policy (ceiling)  ->  viewer's own choice  ->  what the device can do
```

Two rules are fixed and not configurable:

- **The GM always gets a line, never an animation.** Rolls land in the chat
  feed. A GM asked not to have every roll thrown at their screen.
- **A whisper never reaches the table screen or another player**, whatever the
  policy says — and the roller sees it in full on their own device, since the
  table cannot show it for them. Whisper is the one case where the roller's own
  detail goes UP.

`detailFor(recipient, ctx)` is the single seam; every surface asks it.

## 4. Wire protocol

Two messages, mirroring the ping relay exactly (player -> GM -> everyone), so
the GM stays the hub and can mute the whole channel.

```ts
MsgDiceRoll  // player -> GM
  { type: 'dice_roll', playerId, clientId, rollId, label, roll: RollOutcome, whisper }

MsgDiceShow  // GM -> everyone
  { type: 'dice_show', rollId, label, roll, fromPlayerId | null, fromName, fromColor,
    whisper, detailOthers, detailTable, rollerClientId }
```

`RollOutcome` carries the individual faces. **The roller decides the faces and
every other device replays them.** Nothing re-rolls a roll it was told about —
otherwise the table screen lands on 17 while the chat says 12, and that is an
evening lost to arguing with the software.

The GM computes `detailOthers` / `detailTable` from the policy before relaying,
so viewers need no copy of the policy: they reduce what they are told against
their own preference and their device. `rollerClientId` lets the roller's own
window recognise its roll and apply `rollerDetail` instead.

## 5. Surfaces

### 5.1 Player — the tray

A rail of chips along the bottom edge, idle-fading like the fullscreen button.
One tap rolls. Adv/dis/damage are not options inside a chip; they are their own
chips, because the GM authored the vocabulary.

**Whisper** is a mode toggle on the tray, not a per-chip flag:

- It applies to whatever is rolled next.
- **Ten-minute auto-reset**, the timer restarting on each whispered roll. When
  it lapses the player is told ("Whisper off"). It must never change silently,
  or the first they will know is a secret roll on the table screen.
- While armed, the whole tray takes an indigo glow and the chips desaturate —
  free colours, since green and orange are reserved for view identity and
  red/yellow already mean danger and caution. The toggle also reads "Whisper" in
  words, because a glow alone fails anyone colour-blind or on a washed-out
  projector.

Mirrored in the player action menu (the established second route), which also
carries the viewer's own **Dice display** cycle: full -> lines -> off.

### 5.1b GM — an overlay, not a panel

The GM rolls from the SAME rail the players get, along the bottom of their
canvas, and their own Pixels dice pair there too. Everything else about dice is
SETUP and lives in Settings > Dice: the set, the systems, who sees what, the
colours, the celebration direction. That is the split — once a game is running
you need the dice, not the rules that made them, and the sidebar got its space
back. The rail can be switched off per screen ("Show my dice on the map").

The GM's OWN roll lands on their canvas like anyone's; everyone else's stays in
the feed. Those are different things: a GM asked not to have the table's dice
thrown at their screen, not to be denied their own.

### 5.2 GM — rolls are chat

A roll becomes a `ThreadMessage` with `kind: 'roll'` in the existing
`MessageThreads` store, rendering as a roll chip rather than a sentence. No
toast on the GM screen at all. Three consequences that had to be handled:

- Rolls bump a **quiet** counter, not the red unread badge — otherwise the
  Players panel screams all evening.
- The LLM reply assistant prefetches on the last inbound *message*; rolls are
  excluded, or it drafts a reply to "1d20+5 -> 17".
- Threads are per-player, so a roll needs an identified player — the same
  identity gate pings already have.

**All Players** panel: the same SidePanel, every thread merged
chronologically, each row labelled in the roller's colour, with All / Rolls /
Chat filters. No composer (replying means picking someone): each row offers a
reply that opens that player's own thread. This is the GM's "watch the table"
panel and is meant to be left open.

### 5.3 The table screen is a dice target

When the table screen is showing rolls in full, it is the **stage**: dice land
there, not on five phones.

- A `DiceLayer` mounted beside `PingLayer` in `ProjectorApp`.
- **Screen space, not map space.** PingLayer is map-anchored; dice must not be,
  or they swim when the GM pans and can land in the letterbox or outside the
  calibrated crop. Dice belong to the surface: a tray zone along the bottom.
- Dice are THROWN across the surface: in from an edge, two or three bounces off
  the sides, slowing to a stop where they fall (`dicePath.ts`). It is pure
  theatre — the result was decided before anything moved, and the path is
  generated from a seed, so all the animation does is look like a roll. Web
  Animations, transforms only, and a browser without them simply shows the dice
  where they landed.
- The total catches up with them: a caption parked under wherever the handful
  came to rest, rather than a fixed corner. One throw per roller, in their
  colour, so two people rolling at once keep their own dice and their own total.
- Nothing lands under the tray or off the edge, on any surface: the path takes
  insets and clamps, which is the part `dicePath.test.ts` pins down (including a
  phone in portrait with dice too big for it).
- Landed dice FADE after a few seconds (7s on a player's screen, 12s on the
  table, which people look up at a beat later). Dice are a moment; the record
  is the sentence in the GM's feed. Rolling again catches a fading hand and
  brings it back.

### 5.4 What a roll leaves behind

The dice go; the sentence stays:

```
Alex rolled 1+2+2=5 (on 3d6 [3-18])
```

The range is the point of it. A 5 means nothing on its own — it is a triumph on
3d6 with a penalty and a disaster on 3d6+10 — so every roll records what it
COULD have come to. Dice advantage threw away appear in brackets before the sum
they did not join: `(3) 19=19`.

### 5.5 Best and worst faces

A die landing on its own maximum takes a gold rim and a gold glow; one landing
on its minimum takes a cold slate rim. Red is deliberately not used: it means
destructive in this codebase, and a bad roll is not a mistake anyone made.

Marked per DIE, and only once it has LANDED — a flare during the tumble would
fire on every face flickering past. When EVERY counted die is at its best the
lane itself lights and the total pulses, because that is a different event from
one die being lucky.

### 5.6 Mechanics, in words

The grammar grew past `NdM` because tables do not all roll the same way, but it
grew in WORDS rather than symbols — `adv` and `dis` set the pattern, so:
`burst` (exploding), `keep 3` / `keep low 3`, `target 5` (a success pool). They
combine: `5d10 burst keep 3` is L5R, `8d10 burst target 8` is World of Darkness.
A GM has to be able to read their own set back a month later, which `5d10!k3`
does not allow.

Ready-made systems in Settings > Dice: d20, d6 pool, Fate/Blades, Shadowrun,
L5R, World of Darkness, Savage Worlds, and roll-under (which also flips the
celebration, because that is the whole point of the system).

## 6. Rendering fidelity

`full` is animated: the dice tumble, catch the light, and land.

**Faked, not simulated** — and that is the point. There is no geometry, no
physics and no dependency. Each die is one `<span>` clipped to its silhouette
with a handful of flat SVG polygons inside it, shaded in three tones from one
tint with the light coming from the top left. The shine is a static rim
highlight plus one gradient sweep that runs while the die is in the air. The
result is known before anything moves, so all the animation has to do is look
like a roll.

`src/rendering/dieShapes.ts` holds one table of shapes: d4 triangle, d6
bevelled cube face, d8 diamond, d10 kite, d12 pentagon, d20 hexagon-with-a-
triangle, Fate as a cube, anything else as a cube. The outline drives BOTH the
SVG facets and the CSS clip-path, so silhouette and shading cannot drift apart.

Rules that keep it cheap enough for the weakest screen in the house — usually
the table's stick PC, with a player's phone second:

- Only `transform` and `opacity` animate. No SVG filters anywhere.
- The drop shadow appears only once a die has LANDED, so no filter is being
  recomputed while anything moves.
- `prefers-reduced-motion` skips straight to the faces, and `auto` picks plain
  tiles for that person as well.
- Plain is genuinely plain: no facets, no clip-path, no shine, no wobble, no
  bounce, no shadow — a tile and a numeral.
- The tumble is timed by the CLOCK, not by counting ticks: a browser throttles
  timers in a hidden tab to about one a second, and a player who looks away
  must come back to dice that landed, not to a roll still tumbling.
- Nothing filters dice from outside either: the visual filter is applied to the
  map shader and the marker/video layers, never to `#dice-layer`.

Whatever draws it, the faces come down the wire. See section 4.

## 7. Physical dice (Pixels) — BUILT, UNVERIFIED against hardware

Pixels are Bluetooth dice with an accelerometer and LEDs. They fit this design
almost for free, because the wire already carries FACES rather than a request to
roll: a physical die is just another source of them.

**A MIRROR, not a controller.** Nothing is armed and nothing is asked for. The
dice REPLACE the tray for whoever owns them: the chips step aside, the dice get
thrown, and the roll appears on screen exactly as a tapped one would. Every rule
and every part of the look is unchanged — same lanes, same colours, same crit
flares, same fade, same sentence in the GM's feed.

- `physicalRoll.ts` is pure and holds the rules: the collection window and how a
  handful becomes a roll. `pixelsLink.ts` holds the Bluetooth and is imported
  LAZILY, so nobody without dice downloads the library (its own ~120 kB chunk).
- A thrown SET arrives one die at a time, so the first die opens a window, each
  further die extends it, and when the table goes quiet (1.8s, capped at 6s) the
  handful is reported as ONE roll: `1d20+2d6`, biggest first, total summed. A
  die nudged twice in one window keeps its LAST face - picking one up and
  dropping it corrects the roll rather than adding to it.
- Whisper still governs what you throw next, which is why the toggle stays on
  the tray when the chips go.
- `physical: true` rides along so the feed can mark it as real dice.
- We do NOT drive the LEDs. A Pixels die runs its own on-die profile when it
  lands (`profileHash` is a property of the DIE), configured in the Pixels app.

Constraints, all failing closed and silently: Web Bluetooth is Chromium-only (no
iOS, no Firefox) and needs a SECURE CONTEXT. Players joining the https site are
fine; someone on a LAN address (`http://192.168.x.x`, which is what the GM hands
out when running from localhost in dev) is not, and is never shown the button.
The GM preview iframe would additionally need `allow="bluetooth"`.

### 7.1 What the vendor's guide changed (v2.19.8)

Systemic publish a Developer's Guide, and it is mostly a list of ways wireless
goes wrong. Reading it properly corrected several things this had wrong:

- **`repeatConnect`, never `connect`.** Windows reports a peripheral as
  disconnected about FOUR SECONDS before the die itself notices, so a prompt
  reconnect fails. repeatConnect backs off and retries. This was the single
  biggest fix; the first version called `connect()` directly.
- **Listen for `status`.** A disconnection is otherwise completely silent —
  roll events simply stop arriving and the player wonders why their dice broke.
  An unasked-for disconnection now triggers an automatic reconnect attempt.
- **Never pre-check `pixel.status`.** It is the LAST KNOWN status and the die
  may drop the instant after; wrap the call instead.
- **No dialogs on failure.** The tray says what happened, in place.
- **Always leave a way to roll.** When no die is actually connected the
  on-screen chips come back by themselves, so a wandering die never leaves a
  player with nothing.
- **A die talks to ONE device at a time**, so while Mappadux holds it the Pixels
  app cannot. We let go on `pagehide`, and the UI says so.
- **Surface re-rolls.** A bumped die that changes the result must be SEEN to do
  it, or the screen and the table disagree and the player trusts neither.
- **`getPixel(systemId)`** reconnects a die authorised earlier with no chooser —
  which is why the systemId is remembered per browser. Chrome only allows it
  across sessions with its new permissions backend
  (`getBluetoothCapabilities().persistentPermissions`).

Deliberately NOT applied: the guide suggests disconnecting when the app goes to
the background so other software can use the dice. For a VTT that is backwards —
a player puts their phone down and watches the table screen, and their dice must
keep working.

Physical rolls apply NO set mechanics: they report the faces and the sum, and
nothing else. "Just say what they roll."

NOT VERIFIED against real dice - there is no hardware on the machine that built
it. The rules, the collection window and the tray behaviour are covered by
tests; the Bluetooth handshake itself has never run.

## 8. Build order

1. `src/dice/roll.ts` + `src/dice/dicePolicy.ts` with tests — pure, no UI.
2. Types, storage, permission plumbing.
3. Rolls in threads + the All Players panel (useful on its own).
4. GM Dice panel: set editor, presets, policy.
5. Player tray + whisper; GM relay; lines and 2D animation on every surface.
6. Optional 3D as a lazy chunk.

## 9. Build status

Sections 1-6 shipped on beta (1-5 at v2.19.0, the faceted dice at v2.19.2).

Verified live (GM at localhost:5180, a real player window, and a projector
window over the local channel):

- the GM's set reaches a player's tray, and an edit reaches it without a reload
- a tap rolls, draws on the roller's own screen, and lands in the GM's feed as
  a chip with the same faces
- with a projector connected, `auto` hands the show to the TABLE (44px dice,
  40px total, staying put in the roller's lane) and drops the roller to a line
  - the "everyone is looking up at it" rule, working
- a whispered roll draws in full for the roller, is tagged `whisper` in the
  GM's feed, and goes nowhere else
- the device preference downgrades a roll to a line, over the pack's policy

Not verified by a human: a SECOND player seeing someone else's roll as a line
(same code path as the roller's line, fed `detailOthers`), and any of it over a
real remote connection rather than the local channel.

Section 6 settled as CSS/SVG with faked lighting rather than WebGL physics:
cheap everywhere, no dependency, and the result was never in doubt anyway. The
shapes, facet tones, clip-paths, the no-filter-while-moving rule and the
throttled-tab landing are covered by tests; how it LOOKS has not been seen by a
human - the preview pane cannot render (0x0 viewport, `visibilityState:
hidden`), so that is a thirty-second eyeball on a real screen.
