# Third-party notices

Mappadux ships code and fonts from the projects below. Their licences require
the copyright notice to travel with any distribution, which is what this file is
for. Mappadux itself is MIT © FrunkQ — see [LICENSE](LICENSE).

Everything here is a RUNTIME dependency (`npm ls --omit=dev --depth=0`); build
tooling is not distributed and is not listed.

| Package | Licence | Used for |
|---|---|---|
| `@systemic-games/pixels-web-connect` (+ `pixels-core-connect`, `pixels-core-animation`, `pixels-core-utils`) | MIT | Physical Pixels dice |
| `three` | MIT | The map renderer |
| `peerjs` | MIT | Player and projector connections |
| `polygon-clipping` | MIT | Fog of war and MapFX shapes |
| `qrcode` | MIT | The join QR code |
| `idb` | ISC | The workspace database |
| `@vercel/analytics` | MPL-2.0 | Page analytics |
| `@fontsource/*` (Caveat, Cinzel, IM Fell DW Pica, MedievalSharp, Permanent Marker, Playwrite GB J, Press Start 2P, Seaweed Script, Special Elite, Uncial Antiqua, VT323, Whisper) | SIL OFL 1.1 | The themed fonts |

---

## Pixels dice — Systemic Games

Physical dice support (`src/dice/pixelsLink.ts`) is built on Systemic Games'
web packages, loaded only when someone actually pairs a die.
<https://gamewithpixels.com/>

```
MIT License

Copyright (c) 2023 Systemic Games

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Still to do

This file is honest about what it covers and what it does not. The Pixels
notice above is complete; the rest of the table names the licence but does not
yet reproduce each project's copyright line, and MIT, ISC and OFL all ask for
that in a distribution.

Outstanding:

- The full MIT/ISC notices for three, peerjs, polygon-clipping, qrcode and idb.
- The OFL notices for each `@fontsource/*` family. OFL is the strictest of the
  set: it wants the copyright statement, the licence, and the reserved font
  names shipped with the font — one entry per family, not one for all of them.
- `@vercel/analytics` is MPL-2.0, which has source-availability terms rather
  than a notice-only obligation. Worth a look before the next production
  release: it is used unmodified, which is the easy case, but it is the only
  non-permissive licence in the list.

Anything added from here on goes in this file WHEN it is added, rather than
being audited back in later.
