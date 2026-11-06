# Editing guide

## 1. Change text, links and numbers
Everything visible comes from `src/content.js`. Each section has its own export (`hero`, `journey`, `capabilities`,
`tour`, `difference`, `ecosystem`, `trust`, `cta`…). Edit, save, and the dev server reloads.

- **Buttons**: `links.demo` (Book a demo) and `links.sales` (Talk to us). Point them to your real contact page / CRM form.
- **Hero brief card**: `hero.briefs` — each entry types a sentence, then shows criteria chips and counts. These numbers are
  examples and the card is labelled “Demo”; keep that label unless you wire it to live data.
- **Comparison**: `difference.rows`. No competitor is named on purpose; it compares with common industry practice.
  If you add named comparisons, have them checked by legal/marketing first.

## 2. Screenshots
1. Export the new screen as PNG (1440 px wide works best).
2. Convert to WebP (smaller, same quality), e.g. `cwebp -q 80 in.png -o src/assets/screens/my-screen.webp`
   or any online converter.
3. Reference it by file name (without `.webp`) in `content.js`: in `tour` (`img: 'my-screen'`) or in `wall`.

Note: the current screenshots come from the SUPPLY360 / SampTrek / SampCode demo builds and some still show the old names SAMPLEON, PROJEXA and ZAPX.
When the in-product rebrand ships, re-capture and drop the new files in with the same names; nothing else changes.

## 3. Colours, fonts, spacing
Tokens at the top of `src/styles/global.css` (`:root`):
- Brand teal `--teal-*` matches the logo. Accents: `--coral`, `--violet`, `--amber` (SampTrek), `--pink` (SampCode), `--blue` (SUPPLY360).
- Fonts: Manrope (text), Instrument Serif italic (accent words), Unbounded (big numbers), JetBrains Mono (data/IDs).
  They load from Google Fonts in `index.html`. To self-host, download them and replace the `<link>` with `@font-face` rules.
- Each section's styles are grouped under a comment banner (`/* ── Hero ── */` etc.).

## 4. Add, remove or reorder sections
`src/App.jsx` lists the sections in order. Delete a line to remove a section, move lines to reorder.
Nav links (`nav` in content.js) point to section ids (`#journey`, `#capabilities`, `#tour`, `#difference`, `#ecosystem`).

## 5. Icons
Icons come from [lucide](https://lucide.dev/icons). To use a new one: import it in `src/components/fx/Icon.jsx`,
add it to `ICONS`, then use its name in `content.js` (e.g. `icon: 'Globe'`). Only listed icons are bundled.

## 6. Motion and accessibility
- Visitors with “reduce motion” on get a still globe, no loops and instant reveals (CSS + framer-motion `reducedMotion="user"`).
- The 3D globe pauses when it is off-screen and caps pixel ratio at 2 for battery life.
- Animation speeds: `DURATION` in `Tour.jsx` (tour autoplay), `marquee`/`wall-row` durations in CSS, rotation speed in `GlobeScene.jsx` (`globe.rotation.y += dt * 0.12`).

## 7. The feasibility playground
`Playground.jsx` uses a deliberately simple formula, documented at the top of the file, and the section says so.
It is not the product algorithm. Tune the constants or replace `model()` with a call to a public estimate API later.
