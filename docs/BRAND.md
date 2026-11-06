# SampAudience brand

SAMPLEON is now called **SampAudience** (by Sampledge). Tagline: *Ask the world. Hear back.*

## The other products

PROJEXA is now **SampTrek** and ZAPX is now **SampCode**. The console shows those names
(source filter, tiles, request table and detail), and targeting text understands both the
new and the old names ("SampTrek project PRJ-1045", "SampCode survey ZPX-221"). The contract
values `PROJEXA` and `ZAPX` (`source.platform`, client ids, filters in the API) are unchanged.

## What changed and what did not

| Shown to people (renamed) | Technical identifiers (unchanged) |
|---|---|
| Product name in the operations console, its title, favicon and logo | Repository `Sampleon`, package `@sampledge/sampleon`, `apps/sampleon` |
| Product name in SUPPLY360, PROJEXA and ZAPX screens, buttons and help text | API paths (`/sampleon/v1/...`, `/api/v1/integrations/sampleon/...`) |
| Feasibility assumptions text | Environment variables (`SAMPLEON_URL`, `SAMPLEON_CLIENT_SECRET`, ...) |
| | S2S client id `sampleon`, event `source: 'SAMPLEON'`, ZAPX vendor code `SAMPLEON` (`vid=SAMPLEON`) |
| | Database tables, columns and migrations, staff token prefix `son_` |

Renaming the identifiers would break signed requests, stored events and launch links already in
the field. If they are renamed later, do it in all four repositories at once and keep the old
values accepted for a transition period.

## Assets

`apps/sampleon/public/brand/` (served by the service at `/brand/<file>`):

| File | Use |
|---|---|
| `sampaudience-icon.svg` | App icon and favicon (animated SVG) |
| `sampaudience-icon-512.png` | PNG icon, apple-touch-icon, social previews |
| `sampaudience-logo-light.svg` / `@6x.png` | Full lockup on light backgrounds |
| `sampaudience-logo-dark.svg` / `@6x.png` | Full lockup on dark backgrounds |

Brand colour: teal `#14B8A6` (light-theme accent `#0F766E`, dark-theme accent `#2DD4BF`).
The same files are copied to `public/brand/sampaudience/` in SUPPLY360 web, PROJEXA web and
ZAPX studio.
