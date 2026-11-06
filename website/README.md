# SampAudience — product showcase page

> Lives in `website/` of the Sampleon repo, outside the npm workspaces: run all commands from this folder.

Marketing page for **SampAudience** (formerly SAMPLEON), Sampledge's audience marketplace and supply execution engine.
Built with React 18 + Vite 5, framer-motion for motion and plain three.js for the 3D globe.

## Quick start

```bash
npm install          # Node 18+ (tested on Node 22)
npm run dev          # http://localhost:5173 with hot reload
npm run build        # production site  -> dist/
npm run build:preview  # one self-contained HTML file -> dist-preview/index.html
npm run preview      # serve dist/ locally to check the production build
```

`dist/` is a static site: upload its contents to any web server, CDN or bucket. It uses relative paths,
so it works at the domain root or in a sub-folder such as `sampledge.com/sampaudience/`.

`dist-preview/index.html` has every script, style and screenshot inlined (~4.7 MB). Double-click it to open,
or e-mail it for review. Use `dist/` for the live site, since it loads faster (images load lazily, 3D loads after the text).

## Where things are

```
index.html                 page <head>: title, meta/OG tags, Google Fonts, favicon
vite.config.js             build modes (normal + single-file preview)
public/favicon.png         SampAudience app icon (512px)
src/
  content.js               ALL copy, links, numbers, screenshot lists  ← edit this first
  App.jsx                  section order
  main.jsx                 entry; MotionConfig respects OS "reduce motion"
  styles/global.css        design tokens (:root) + all styles, one block per section
  assets/brand/            SampAudience logo (on-dark, on-light) and icon SVGs (animated)
  assets/screens/*.webp    product screenshots (converted from PNG, 1440px wide)
  components/
    Nav.jsx                sticky header + mobile sheet
    Hero.jsx               kinetic headline, AI "brief" card, floating chips
    GlobeScene.jsx         three.js globe, orbit ring, question/answer arcs
    Marquee.jsx, Stats.jsx
    Journey.jsx            9-step scroll-driven horizontal journey (vertical timeline < 960px)
    Capabilities.jsx       bento grid with animated mini-visuals
    Tour.jsx               auto-playing product tour in a 3D browser frame + lightbox
    ScreenWall.jsx         tilted wall of moving screenshots
    Difference.jsx         "why us": flip cards, usual way vs SampAudience
    Ecosystem.jsx          orbit map: SUPPLY360, SampTrek, SampCode + panels
    Playground.jsx         interactive feasibility sliders (illustrative model)
    Trust.jsx, CTA.jsx, Footer.jsx
    fx/                    reusable effects: Reveal, Tilt, Counter, Magnetic, Lightbox, Icon, CursorGlow…
docs/
  EDITING_GUIDE.md         how to change copy, colours, screenshots, sections
  DEPLOYMENT.md            hosting options and embedding in sampledge.com
```

See `docs/EDITING_GUIDE.md` and `docs/DEPLOYMENT.md` for details.
