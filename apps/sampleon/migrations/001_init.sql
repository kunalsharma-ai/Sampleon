-- SAMPLEON schema v1. SAMPLEON keeps no respondent profiles: only the pseudonymous respondentRef
-- of respondents it invited, for dedupe, fatigue, routing and audit.

CREATE TABLE service_clients (
  id             text PRIMARY KEY,               -- e.g. projexa, zapx, supply360
  system         text NOT NULL CHECK (system IN ('SUPPLY360','PROJEXA','ZAPX','EXTERNAL')),
  name           text NOT NULL,
  secrets        text[] NOT NULL,                -- request-signing secrets; two during rotation
  outcome_secret text,                           -- survey hosts: signs /s2s/outcome
  webhook_url    text,                           -- where SAMPLEON delivers events for this client
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  role            text NOT NULL CHECK (role IN ('supply_admin','supply_approver','supply_manager','viewer','org_viewer')),
  organization_id text,                          -- org_viewer only
  token_hash      text NOT NULL UNIQUE,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_projects (
  source_platform text NOT NULL,
  project_id      text NOT NULL,
  name            text NOT NULL,
  countries       text[] NOT NULL DEFAULT '{}',
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_platform, project_id)
);

CREATE TABLE audience_requests (
  id                 text PRIMARY KEY,           -- AR-<ULID>
  status             text NOT NULL,
  source_platform    text NOT NULL,
  source_project_id  text NOT NULL,
  survey_id          text NOT NULL,
  organization_id    text NOT NULL,
  organization_name  text NOT NULL,
  title              text,
  spec               jsonb NOT NULL,             -- validated AudienceRequest v1
  countries          text[] NOT NULL,
  required_completes integer NOT NULL,
  completes          integer NOT NULL DEFAULT 0,
  host_client_id     text NOT NULL,              -- survey host that verifies outcomes
  created_by         text NOT NULL,              -- user id or client id
  created_via        text NOT NULL,              -- 'client' | 'console'
  approved_by        text,
  approved_at        timestamptz,
  decision_note      text,
  launch_mode        text,                       -- soft | full
  soft_launch_target integer,
  auto_batches       boolean NOT NULL DEFAULT false,
  quota_sequence     integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audience_requests_status ON audience_requests (status);
-- One open request per source survey: no conflicting records for the same project and survey.
CREATE UNIQUE INDEX audience_requests_one_open ON audience_requests (source_platform, source_project_id, survey_id)
  WHERE status NOT IN ('closed','rejected','cancelled');

CREATE TABLE feasibility_snapshots (
  id         bigserial PRIMARY KEY,
  request_id text NOT NULL REFERENCES audience_requests(id),
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feasibility_request ON feasibility_snapshots (request_id, id DESC);

CREATE TABLE allocations (
  request_id text NOT NULL REFERENCES audience_requests(id),
  country    text NOT NULL,
  panel      text NOT NULL,
  target     integer NOT NULL,
  PRIMARY KEY (request_id, country, panel)
);

-- Supply quotas. Every request has one cell per country (key country:XX) plus its quota definitions.
CREATE TABLE quota_cells (
  id         bigserial PRIMARY KEY,
  request_id text NOT NULL REFERENCES audience_requests(id),
  quota_key  text NOT NULL,
  label      text,
  country    text,
  conditions jsonb NOT NULL DEFAULT '[]',
  target     integer NOT NULL,
  count      integer NOT NULL DEFAULT 0,
  hard       boolean NOT NULL DEFAULT true,
  full_announced boolean NOT NULL DEFAULT false,
  UNIQUE (request_id, quota_key)
);

CREATE TABLE batches (
  id           text PRIMARY KEY,
  request_id   text NOT NULL REFERENCES audience_requests(id),
  mode         text NOT NULL CHECK (mode IN ('soft','full')),
  size         integer NOT NULL,
  scheduled_at timestamptz NOT NULL,
  auto         boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'scheduled', -- scheduled | sending | sent | failed | cancelled
  selected     integer NOT NULL DEFAULT 0,
  delivered    integer NOT NULL DEFAULT 0,
  suppressed   integer NOT NULL DEFAULT 0,
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX batches_due ON batches (status, scheduled_at);

CREATE TABLE invitations (
  id             text PRIMARY KEY,
  request_id     text NOT NULL REFERENCES audience_requests(id),
  batch_id       text REFERENCES batches(id),
  respondent_ref text NOT NULL,
  panel          text NOT NULL,
  country        text NOT NULL,
  token          text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'pending', -- pending | delivered | suppressed | opened | withdrawn
  suppress_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  opened_at      timestamptz,
  UNIQUE (request_id, respondent_ref)
);

CREATE TABLE sessions (
  id               text PRIMARY KEY,
  token            text NOT NULL UNIQUE,
  request_id       text NOT NULL REFERENCES audience_requests(id),
  invitation_id    text REFERENCES invitations(id),
  respondent_ref   text NOT NULL,
  panel            text NOT NULL,
  country          text NOT NULL,
  chain_id         text NOT NULL,
  hop              integer NOT NULL DEFAULT 0,
  routed_from      text,
  quota_ids        text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'started', -- started | pending_verification | <outcome>
  browser_outcome  text,
  verified_outcome text,
  verified_at      timestamptz,
  counted          boolean NOT NULL DEFAULT false,
  overquota        boolean NOT NULL DEFAULT false,
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz
);
CREATE INDEX sessions_request ON sessions (request_id, status);
CREATE INDEX sessions_respondent ON sessions (respondent_ref);
CREATE INDEX sessions_chain ON sessions (chain_id);

CREATE TABLE routing_decisions (
  id            bigserial PRIMARY KEY,
  chain_id      text NOT NULL,
  from_session  text NOT NULL,
  from_request  text NOT NULL,
  to_request    text,
  to_session    text,
  trigger       text NOT NULL,                  -- terminate | quota_full | closed | full_on_entry
  considered    integer NOT NULL DEFAULT 0,
  reasons       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX routing_from_request ON routing_decisions (from_request);

CREATE TABLE rewards (
  session_id      text PRIMARY KEY REFERENCES sessions(id),
  request_id      text NOT NULL REFERENCES audience_requests(id),
  respondent_ref  text NOT NULL,
  points          integer NOT NULL,
  value           numeric,
  status          text NOT NULL DEFAULT 'pending', -- pending | confirmed | cancelled
  ledger_entry_id text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox: one row per event and destination.
CREATE TABLE outbox (
  id              bigserial PRIMARY KEY,
  event_id        uuid NOT NULL,
  type            text NOT NULL,
  correlation_id  text NOT NULL,
  destination     text NOT NULL,                -- client id
  url             text NOT NULL,
  envelope        jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending', -- pending | delivered | dead
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  last_status     integer,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  UNIQUE (event_id, destination)
);
CREATE INDEX outbox_due ON outbox (status, next_attempt_at);
CREATE INDEX outbox_correlation ON outbox (correlation_id);

-- Inbox: exactly-once effect for inbound events.
CREATE TABLE inbox (
  event_id    uuid PRIMARY KEY,
  source      text NOT NULL,
  type        text NOT NULL,
  correlation_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  client_id  text NOT NULL,
  key        text NOT NULL,
  status     integer NOT NULL,
  response   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, key)
);

CREATE TABLE integration_errors (
  id         bigserial PRIMARY KEY,
  system     text NOT NULL,
  operation  text NOT NULL,
  request_id text,
  error      text NOT NULL,
  resolved   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  request_id text,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
