# Cross-service end-to-end run

`run.mjs` runs both Sampledge workflows with the four real services, nothing mocked:

1. **PROJEXA project → SAMPLEON → SUPPLY360 → panel → ZAPX → SAMPLEON → PROJEXA**
2. **Independent ZAPX survey → SAMPLEON → SUPPLY360 → panel → ZAPX → SAMPLEON → ZAPX**

It creates four empty databases (`sampleon_e2e`, `supply360_e2e`, `zapx_e2e`, `projexa_e2e`),
migrates and seeds them, registers the service clients and two SAMPLEON staff users (a manager
and a separate approver), starts the services on ports 4600–4630, drives the workflows over HTTP
the way the products and a respondent's browser do, checks each system's records, and stops the
services. Service logs go to `e2e/ecosystem/logs/`.

What it checks, in order:

- PROJEXA builds the audience request from a project (countries, targets per country, LOI, IR,
  dates, project code) with a natural-language description; SAMPLEON turns it into criteria from
  SUPPLY360's catalogue.
- Feasibility comes from SUPPLY360 per country; launching before approval is refused; a second
  person approves; the batch goes out as survey cards on the panel website's feed.
- The respondent opens the card, SAMPLEON starts a session and sends them to ZAPX, ZAPX returns
  the browser and confirms the outcome with a signed S2S call; only then does SAMPLEON count the
  complete.
- PROJEXA shows the progress from SAMPLEON's events; SUPPLY360 records the participation, posts
  the reward and confirms it back to SAMPLEON; every event to PROJEXA was delivered.
- An approved target change in PROJEXA is applied in SAMPLEON.
- The independent ZAPX survey reaches its target; SAMPLEON closes it and ZAPX shows it closed;
  PROJEXA has no record or event for it; no event is dead-lettered.

## Running it

Build the four checkouts first (`npm run build` here and in SUPPLY360; `pnpm build` in ZAPX;
`pnpm --filter @projexa/api build` in PROJEXA), then:

```bash
SUPPLY360_DIR=../Sampledge-full-Supply-CRM \
ZAPX_DIR=../Sampledge-ZAPX \
PROJEXA_DIR=../Projecxa \
PG_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres \
node e2e/ecosystem/run.mjs
```

`PG_ADMIN_URL` must be a role that can create databases. The script drops and recreates only the
four `*_e2e` databases.
