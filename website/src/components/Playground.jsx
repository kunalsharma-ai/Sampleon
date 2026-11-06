import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import SectionHead from './fx/SectionHead.jsx';
import Reveal from './fx/Reveal.jsx';
import { playground } from '../content.js';

/**
 * A playful, deliberately simple feasibility model (NOT the product's real algorithm).
 * invitations = completes / (incidence × response rate × completion rate)
 */
function model({ completes, ir, loi, countries }) {
  const response = 0.2 * (1 - (loi - 5) / 70);           // longer surveys → fewer people start
  const completion = 0.95 - loi * 0.006;                   // and fewer finish
  const invites = completes / ((ir / 100) * response * completion);
  const perDay = 6000 * countries;                         // illustrative send capacity
  const days = Math.max(2, Math.ceil(invites / perDay) + 1); // +1 for the soft launch
  const ease = Math.max(0, Math.min(100, 100 - (Math.log10(invites) - 3) * 35 + countries * 2));
  return { invites: Math.round(invites), days, ease: Math.round(ease) };
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange, color }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="pg-slider" style={{ '--c': color, '--p': `${pct}%` }}>
      <span className="pg-l">{label}<b>{value.toLocaleString('en-US')}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export default function Playground() {
  const [s, set] = useState({ completes: 400, ir: 25, loi: 15, countries: 2 });
  const r = useMemo(() => model(s), [s]);
  const up = (k) => (v) => set((o) => ({ ...o, [k]: v }));
  const tone = r.ease > 60 ? ['Comfortable', '#34D399'] : r.ease > 35 ? ['Stretch', '#F5B544'] : ['Hard to reach', '#FB7185'];
  const C = 2 * Math.PI * 70;

  return (
    <section className="section pg">
      <div className="container">
        <SectionHead num="06" eyebrow="Try it" title={playground.title} accent="(no login needed)." lead={playground.sub} />
        <Reveal className="pg-card">
          <div className="pg-controls">
            <Slider label="Completes" value={s.completes} min={50} max={3000} step={50} onChange={up('completes')} color="#5EEAD4" />
            <Slider label="Incidence rate" value={s.ir} min={2} max={90} unit="%" onChange={up('ir')} color="#A78BFA" />
            <Slider label="Survey length" value={s.loi} min={5} max={45} unit=" min" onChange={up('loi')} color="#F5B544" />
            <Slider label="Countries" value={s.countries} min={1} max={8} onChange={up('countries')} color="#F472B6" />
          </div>
          <div className="pg-out">
            <svg viewBox="0 0 180 180" className="pg-gauge" aria-hidden="true">
              <circle cx="90" cy="90" r="70" className="pg-track" />
              <motion.circle cx="90" cy="90" r="70" className="pg-arc" stroke={tone[1]} strokeDasharray={C}
                animate={{ strokeDashoffset: C * (1 - r.ease / 100) }} transition={{ type: 'spring', stiffness: 80, damping: 16 }} />
            </svg>
            <div className="pg-gauge-label"><b style={{ color: tone[1] }}>{tone[0]}</b><small>reach score {r.ease}</small></div>
            <div className="pg-nums">
              <div><small>Invitations needed</small><b>{r.invites.toLocaleString('en-US')}</b></div>
              <div><small>Field time (est.)</small><b>{r.days} days</b></div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
