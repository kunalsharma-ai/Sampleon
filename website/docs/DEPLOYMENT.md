# Deployment

## Build
```bash
npm ci && npm run build      # outputs dist/
```
Upload the **contents** of `dist/` (index.html, favicon.png, assets/). Cache `assets/*` for a year (file names are hashed);
cache `index.html` for a few minutes or not at all.

## Hosting options
| Host | Settings |
|---|---|
| Netlify / Vercel / Cloudflare Pages | Build command `npm run build`, output directory `dist` |
| AWS S3 + CloudFront, Azure Static Web Apps, GCS | Upload `dist/`; set `index.html` as the default document |
| Existing Apache / Nginx server | Copy `dist/` into a folder, e.g. `/var/www/sampledge/sampaudience/` |

## Adding it to sampledge.com
Pick one:
1. **Own page (recommended)** — host `dist/` at `sampledge.com/sampaudience/` and link to it from the main menu / products page.
   Relative paths (`base: './'` in vite.config.js) make the sub-folder work with no changes.
2. **Inside an existing React site** — copy `src/components`, `src/assets`, `src/content.js` and `src/styles/global.css`
   into the site, install `framer-motion three lucide-react`, and render `<App />` (rename it, e.g. `SampAudiencePage`) on a route.
   The CSS is global; if it clashes with your site, wrap the page in a `.sampaudience` container and prefix the selectors,
   or move the file to a CSS module.
3. **WordPress / Webflow / other CMS** — upload `dist/` to a folder on the server (or a subdomain such as
   `sampaudience.sampledge.com`) and link to it. Embedding with an `<iframe>` also works but loses SEO; prefer a link.

## Before going live
- Set the real URLs in `links` (src/content.js) and the `og:` tags in `index.html`; add an `og:image` (1200×630) if you want link previews.
- Add your analytics snippet to `index.html` (before `</head>`).
- If your site has a Content Security Policy, allow `fonts.googleapis.com` and `fonts.gstatic.com`, or self-host the fonts.
- Check on Chrome, Safari (iOS and macOS), Firefox and Edge. WebGL is needed for the globe; without it the rest of the page still works.
