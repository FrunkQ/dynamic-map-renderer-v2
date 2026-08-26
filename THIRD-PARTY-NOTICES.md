# Third-party notices

Mappadux distributes the code and fonts below. Their licences ask for the
copyright notice to travel with any distribution, which is what this file is
for. Mappadux itself is MIT © FrunkQ — see [LICENSE](LICENSE).

Only RUNTIME dependencies are listed (`npm ls --omit=dev --depth=0`); build
tooling is not distributed. The fonts are here because Mappadux **bundles the
font files themselves** (28 `.woff2` in a build) rather than fetching them from
a CDN — deliberate, so a table can play offline, and it is what makes the notice
required.

---

## Code

### Pixels dice — Systemic Games (MIT)

Physical dice support (`src/dice/pixelsLink.ts`), loaded only when someone
actually pairs a die. <https://gamewithpixels.com/> — packages
`@systemic-games/pixels-web-connect`, `pixels-core-connect`,
`pixels-core-animation`, `pixels-core-utils`.

> Copyright (c) 2023 Systemic Games

### three.js (MIT)

The map renderer. <https://threejs.org/>

> Copyright © 2010-2026 three.js authors

### PeerJS (MIT)

Player and projector connections. <https://peerjs.com/>

> Copyright (c) 2015 Michelle Bu and Eric Zhang

### polygon-clipping (MIT)

Fog of war and MapFX shapes.

> Copyright (c) 2018 Mike Fogel

### node-qrcode (MIT)

The join QR code. <https://github.com/soldair/node-qrcode>

> Copyright (c) Ryan Day

### idb (ISC)

The workspace database. <https://github.com/jakearchibald/idb>

> Copyright (c) 2016, Jake Archibald

### @vercel/analytics (MPL-2.0)

**Only in builds produced by Vercel's CI** — that is mappadux.com and
beta.mappadux.com. The import is gated behind `__VERCEL_DEPLOY__`, so a
self-hosted or local build tree-shakes it out entirely and ships no analytics
code at all. Used unmodified; source at
<https://github.com/vercel/analytics>, and the MPL-2.0 text travels with the
package.

---

## Fonts

The twelve catalogue families, bundled as woff2 subsets. Ten are SIL Open Font
License 1.1; **two are Apache-2.0** — they are not interchangeable, so they are
listed separately.

### SIL Open Font License 1.1

Full licence: <https://openfontlicense.org/> (also shipped in each package).

| Family | Copyright |
|---|---|
| Caveat | Copyright 2014 The Caveat Project Authors |
| Cinzel | Copyright 2020 The Cinzel Project Authors |
| IM Fell DW Pica | Copyright Google Inc. |
| MedievalSharp | Copyright (c) 2011, Wojciech 'wmk69' Kalinowski |
| Playwrite GB J | Copyright Google Inc. |
| Press Start 2P | Copyright 2012 The Press Start 2P Project Authors — Reserved Font Name "Press Start 2P" |
| Seaweed Script | Copyright (c) 2012 Font Diner, Inc DBA Neapolitan — Reserved Font Name "Seaweed Script" |
| Uncial Antiqua | Copyright (c) 2011 Brian J. Bonislawsky DBA Astigmatic (AOETI) — Reserved Font Name "Uncial Antiqua" |
| VT323 | Copyright 2011, The VT323 Project Authors |
| Whisper | Copyright 1993-2022 The Whisper Project Authors |

Reserved Font Names may not be used by a modified version of the font. Mappadux
ships them unmodified.

### Apache License 2.0

Full licence: <https://www.apache.org/licenses/LICENSE-2.0>

| Family | Copyright |
|---|---|
| Permanent Marker | Copyright (c) 2010 Font Diner, Inc. |
| Special Elite | Copyright (c) 2010 Brian J. Bonislawsky DBA Astigmatic (AOETI) |

---

## Keeping this current

Anything added from here on goes in this file WHEN it is added, rather than
being audited back in later. `npm ls --omit=dev --depth=0` shows what actually
ships; a dependency that is only imported behind a build flag (as
`@vercel/analytics` is) should say so rather than implying every build carries
it.
