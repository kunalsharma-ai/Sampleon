/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SampAudience page content
 *  Every word, link, number and screenshot on the page comes from this file.
 *  Marketing can edit copy here without touching any component.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Screenshots live in src/assets/screens. Import them by file name.
const shots = import.meta.glob('./assets/screens/*.webp', { eager: true, import: 'default' });
export const shot = (name) => shots[`./assets/screens/${name}.webp`];

export const links = {
  demo: 'https://sampledge.com/contact?product=sampaudience', // "Book a demo" buttons
  sales: 'mailto:sales@sampledge.com?subject=SampAudience',   // "Talk to us" buttons
  home: 'https://sampledge.com',
};

export const nav = [
  { label: 'How it works', href: '#journey' },
  { label: 'Capabilities', href: '#capabilities' },
  { label: 'Product tour', href: '#tour' },
  { label: 'Why us', href: '#difference' },
  { label: 'Ecosystem', href: '#ecosystem' },
];

export const hero = {
  eyebrow: 'Audience marketplace · Supply execution engine',
  titleA: 'Ask the world.',
  titleB: 'Hear back.',
  sub: 'SampAudience turns a research brief into the right respondents. Feasibility, AI audience matching, quotas, launch, batching and routing run in one engine, wired straight into SUPPLY360, SampTrek and SampCode.',
  ctaPrimary: 'Book a demo',
  ctaSecondary: 'See it work',
  // The hero "brief" card types these one after another.
  briefs: [
    {
      text: 'Cardiologists in the US and UK with 5+ years in practice',
      chips: ['occupation = physician', 'specialty = cardiology', 'experience ≥ 5 yrs', 'country ∈ US, GB'],
      eligible: 2318, reachable: 941, panel: 'MyHealthOpinions',
    },
    {
      text: 'Gen Z online bankers in India and Singapore',
      chips: ['age 18–27', 'uses mobile banking', 'country ∈ IN, SG'],
      eligible: 48210, reachable: 12904, panel: 'Turn2Opinion',
    },
    {
      text: 'IT decision makers at SMBs buying cloud software',
      chips: ['role = IT decision maker', 'company size 10–249', 'buys SaaS / cloud'],
      eligible: 9734, reachable: 3120, panel: 'Turn2Opinion',
    },
  ],
};

export const marquee = [
  'Feasibility', 'AI audience matching', 'Quota cells', 'Cross-panel dedupe', 'Soft launch',
  'Full launch', 'Batching', 'Invitations', 'Smart routing', 'Supplier allocation',
  'Signed events', 'Human approval', 'Outcome sync',
];

export const stats = [
  { value: 1, suffix: '', label: 'respondent database behind every panel' },
  { value: 0, suffix: '', label: 'names or e-mails shared outside SUPPLY360' },
  { value: 100, suffix: '', label: 'points to split supply across panels by reach' },
  { value: 9, suffix: '', label: 'stages tracked under one request ID' },
];

// "How it works": the scroll-driven journey of one audience request.
export const journey = [
  { k: 'Request', icon: 'Inbox', color: '#F5B544',
    text: 'A SampTrek project or a SampCode survey sends an audience request with targets, quotas, IR, LOI and dates. It gets one ID, like AR-01JC9Y…, that follows it everywhere.' },
  { k: 'AI match', icon: 'Sparkles', color: '#A78BFA',
    text: 'Write who you need in plain words. SampAudience turns it into exact profile criteria and shows live counts as you refine.' },
  { k: 'Feasibility', icon: 'Gauge', color: '#5EEAD4',
    text: 'Country by country: eligible, reachable, estimated completes and shortfall, before anyone commits to a number.' },
  { k: 'Allocate', icon: 'SlidersHorizontal', color: '#60A5FA',
    text: 'Split 100 points of supply across Turn2Opinion, MyFrequentRewards and MyHealthOpinions, guided by who can actually be reached.' },
  { k: 'Approve', icon: 'ShieldCheck', color: '#34D399',
    text: 'A supply approver signs off the audience. No invitation is ever sent without a person saying yes.' },
  { k: 'Soft launch', icon: 'Rocket', color: '#F472B6',
    text: 'Open a small slice first. Compare real IR, LOI and drop-off against plan, then go full launch with confidence.' },
  { k: 'Batch & invite', icon: 'Send', color: '#FB923C',
    text: 'Invitations go out in timed batches per country, inside send windows, throttled so quotas fill evenly.' },
  { k: 'Route', icon: 'GitFork', color: '#22D3EE',
    text: 'Screened out? Respondents are offered another survey they qualify for, instead of a dead end.' },
  { k: 'Outcomes', icon: 'CircleCheckBig', color: '#5EEAD4',
    text: 'Completes, screen-outs and over-quotas flow back automatically to the survey, the project and the panel, signed and audited.' },
];

export const capabilities = [
  { id: 'feas', size: 'xl', icon: 'Gauge', color: '#5EEAD4', title: 'Feasibility in seconds',
    text: 'Eligible → reachable → completes, per country, with the shortfall called out before you quote.', viz: 'funnel' },
  { id: 'ai', size: 'l', icon: 'Sparkles', color: '#A78BFA', title: 'AI audience matching',
    text: '“Oncology nurses in the US and GB” becomes occupation = nurse AND role in oncology, with live counts.', viz: 'ai' },
  { id: 'quota', size: 'm', icon: 'LayoutGrid', color: '#F5B544', title: 'Quota cells that pace themselves',
    text: 'Cells coloured by pace, with automatic close, boost and re-batch.', viz: 'quota' },
  { id: 'dedupe', size: 'm', icon: 'Fingerprint', color: '#F472B6', title: 'Dedupe by design',
    text: 'One respondent identity across every panel, so the same person never counts twice.', viz: 'dedupe' },
  { id: 'launch', size: 'm', icon: 'Rocket', color: '#FB923C', title: 'Soft & full launch',
    text: 'A gated launch with a read-out of real IR, LOI and drop-off versus plan.', viz: 'launch' },
  { id: 'route', size: 'l', icon: 'GitFork', color: '#22D3EE', title: 'Routing that rescues screen-outs',
    text: 'Eligibility decisions route each respondent to a survey with open quota.', viz: 'route' },
  { id: 'alloc', size: 'm', icon: 'SlidersHorizontal', color: '#60A5FA', title: 'Supplier allocation',
    text: 'Points of 100 across panels, suggested by reach.', viz: 'alloc' },
  { id: 'batch', size: 'm', icon: 'CalendarClock', color: '#34D399', title: 'Batching & invitations',
    text: 'Timed waves per country inside send windows and throttles.', viz: 'batch' },
];

export const tour = [
  { id: 'alloc', label: 'Audience allocation', img: 'wave6-sampleon',
    text: 'Every request from SampTrek and SampCode on one board, from submitted to closed. Open one to see feasibility, quotas, batches and events.' },
  { id: 'feas', label: 'Feasibility studio', img: 'wave2-feasibility',
    text: 'Scenario columns side by side, a country waterfall from eligible to achievable and a confidence band.' },
  { id: 'seg', label: 'AI segmentation', img: 'wave2-segmentation',
    text: 'Describe the audience in words; edit the AND/OR tree it builds, with counts updating live.' },
  { id: 'quota', label: 'Quota monitoring', img: 'wave3-quotas',
    text: 'The quota matrix shows pace per cell, with burn-down and auto-actions.' },
  { id: 'launch', label: 'Soft & full launch', img: 'wave3-launch',
    text: 'Launch checklist, soft-launch read-out and a gated full-launch control.' },
  { id: 'route', label: 'Routing intelligence', img: 'wave3-routing',
    text: 'Entry → eligibility → surveys with live quota state → validated outcomes, with path replay.' },
  { id: 'global', label: 'Global reach', img: 'wave6-global',
    text: 'Live survey traffic on a globe, with a fast 2D view and country drill-down.' },
  { id: 'zapx', label: 'Inside SampCode', img: 'zapx-sampleon-panel',
    text: 'Order an audience right from the survey’s Distribute tab. No project needed.' },
  { id: 'projexa', label: 'Inside SampTrek', img: 'projexa-sampleon-tab',
    text: 'A project tab sends targets and quota cells, and shows fieldwork as it happens.' },
];

// Extra screenshots for the moving "wall of screens".
export const wall = [
  'exec-cosmic', 'wave6-distribution', 'wave6-zapx', 'wave6-projexa', 'wave2-panellist-360',
  'wave2-myhealthopinions', 'wave5-quality', 'wave6b-analytics', 'wave6b-api-hub', 'wave6b-copilot',
  'wave4-automation', 'wave4-journeys', 'wave5-rewards', 'studio',
];

// "Why us": common industry practice vs SampAudience. No vendor is named on purpose.
export const difference = {
  them: 'The usual way',
  us: 'SampAudience',
  rows: [
    { topic: 'Respondent data', them: 'Copies of panellist data spread across vendors', us: 'One respondent database. Names and e-mails never leave SUPPLY360.' },
    { topic: 'Going live', them: 'Invites fire as soon as a link is pasted', us: 'A person approves every audience before any invitation goes out' },
    { topic: 'Targeting', them: 'Precode forms and spreadsheets', us: 'Plain-language brief → exact criteria, with live counts' },
    { topic: 'Feasibility', them: 'One headline number, often a guess', us: 'Eligible, reachable, completes and shortfall per country' },
    { topic: 'Quotas', them: 'Caps per supplier, over-quotas found late', us: 'Quota cells synced from the project, paced and auto-managed' },
    { topic: 'Duplicates', them: 'Deduped per supplier, if at all', us: 'Deduped across every panel by one identity' },
    { topic: 'Screen-outs', them: 'A dead end and a wasted respondent', us: 'Routed to another survey they qualify for' },
    { topic: 'Workflow', them: 'Links and CSVs passed by e-mail', us: 'Native in SampTrek and SampCode, with signed events both ways' },
    { topic: 'Audit trail', them: 'Spread across tools and inboxes', us: 'Every event carries one request ID, from brief to outcome' },
  ],
  note: 'Comparison reflects common practice in the sample industry, not any single named vendor.',
};

export const ecosystem = [
  { id: 'supply', name: 'SUPPLY360', color: '#60A5FA', role: 'The respondent database',
    text: 'Owns every panellist, profile and reward. SampAudience counts and delivers through it; personal data stays inside.' },
  { id: 'projexa', name: 'SampTrek', color: '#F5B544', role: 'Projects & quotas',
    text: 'Projects send targets and quota cells to SampAudience from a dedicated tab, and see fieldwork live.' },
  { id: 'zapx', name: 'SampCode', color: '#F472B6', role: 'Survey hosting',
    text: 'Any survey can order an audience on its own. Outcomes come back as signed redirects.' },
];

export const panels = [
  { name: 'Turn2Opinion', short: 'T2O', color: '#3B82F6' },
  { name: 'MyFrequentRewards', short: 'MFR', color: '#8B5CF6' },
  { name: 'MyHealthOpinions', short: 'MHO', color: '#22C55E' },
];

export const trust = [
  { icon: 'UserCheck', title: 'Human in the loop', text: 'An approver signs off every audience. Automation proposes; people decide.' },
  { icon: 'LockKeyhole', title: 'Privacy by architecture', text: 'Partners see pseudonymous tokens. Names and e-mail addresses never leave SUPPLY360.' },
  { icon: 'KeyRound', title: 'Signed, every time', text: 'Every request and outcome is HMAC-signed with a timestamp, so nothing can be forged or replayed.' },
  { icon: 'ScrollText', title: 'One ID, full story', text: 'A single AR- request ID ties brief, feasibility, approval, invites and outcomes together.' },
];

export const playground = {
  title: 'Play with feasibility',
  sub: 'Move the sliders to see how incidence and length change the invitations you need. This is a simplified illustration; the product uses live SUPPLY360 counts.',
};

export const cta = {
  title: 'Your next audience is one sentence away.',
  sub: 'See SampAudience take a brief to live fieldwork, end to end, with your own targets.',
};
