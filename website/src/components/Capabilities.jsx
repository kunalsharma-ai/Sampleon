import { motion } from 'framer-motion';
import SectionHead from './fx/SectionHead.jsx';
import Reveal from './fx/Reveal.jsx';
import Tilt from './fx/Tilt.jsx';
import Icon from './fx/Icon.jsx';
import { capabilities, panels } from '../content.js';

const inView = { once: true, margin: '-15% 0px' };

/* Small animated illustrations, one per capability tile. */
const Viz = {
  funnel: () => (
    <div className="viz-funnel">
      {[['Eligible', 19714, 100], ['Reachable', 5449, 58], ['Est. completes', 310, 24]].map(([l, n, w], i) => (
        <div key={l} className="vf-row">
          <span>{l}</span>
          <motion.i initial={{ width: 0 }} whileInView={{ width: `${w}%` }} viewport={inView}
            transition={{ duration: 1.1, delay: 0.2 + i * 0.2, ease: [0.2, 0.8, 0.2, 1] }} />
          <b>{n.toLocaleString('en-US')}</b>
        </div>
      ))}
      <table className="vf-table">
        <thead><tr><th>Country</th><th>Eligible</th><th>Reachable</th><th>Est. completes</th></tr></thead>
        <tbody>
          {[['🇺🇸 US', 13621, 3922, 242], ['🇬🇧 GB', 6093, 1527, 68]].map(([c, ...n], i) => (
            <motion.tr key={c} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={inView} transition={{ delay: 0.9 + i * 0.15 }}>
              <td>{c}</td>{n.map((v, k) => <td key={k}>{v.toLocaleString('en-US')}</td>)}
            </motion.tr>
          ))}
        </tbody>
      </table>
      <div className="vf-ok"><Icon name="CircleCheck" size={14} /> Feasible at the requested IR and dates · shortfall 0</div>
    </div>
  ),
  ai: () => (
    <div className="viz-ai">
      <div className="va-q">“oncology nurses in the US and GB”</div>
      <motion.div className="va-arrow" initial={{ scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={inView} transition={{ delay: 0.3 }} />
      <div className="va-chips">
        {['occupation = nurse', 'AND', 'role ∈ oncology', 'AND', 'country ∈ US, GB'].map((c, i) => (
          <motion.span key={i} className={c === 'AND' ? 'and' : ''} initial={{ opacity: 0, y: 10, scale: 0.8 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={inView} transition={{ delay: 0.5 + i * 0.12, type: 'spring' }}>{c}</motion.span>
        ))}
      </div>
    </div>
  ),
  quota: () => (
    <div className="viz-quota">
      {Array.from({ length: 15 }).map((_, i) => {
        const p = [92, 64, 100, 41, 78, 55, 88, 100, 36, 70, 97, 48, 83, 61, 100][i];
        const tone = p >= 100 ? 'full' : p > 75 ? 'good' : p > 50 ? 'mid' : 'low';
        return (
          <motion.span key={i} className={`vq ${tone}`} initial={{ opacity: 0, scale: 0.5 }}
            whileInView={{ opacity: 1, scale: 1 }} viewport={inView} transition={{ delay: i * 0.04 }}>
            <i style={{ height: `${Math.min(p, 100)}%` }} />{p >= 100 ? '✓' : `${p}%`}
          </motion.span>
        );
      })}
    </div>
  ),
  dedupe: () => (
    <div className="viz-dedupe">
      <span className="vd a">T2O</span><span className="vd b">MFR</span><span className="vd c">MHO</span>
      <span className="vd-one"><Icon name="Fingerprint" size={20} /></span>
    </div>
  ),
  launch: () => (
    <div className="viz-launch">
      <div className="vl-track"><motion.i initial={{ width: '0%' }} whileInView={{ width: ['0%', '12%', '12%', '100%'] }}
        viewport={inView} transition={{ duration: 3.2, times: [0, 0.25, 0.55, 1], ease: 'easeInOut' }} /></div>
      <div className="vl-labels"><span>Soft 10%</span><span>Read-out ✓</span><span>Full launch</span></div>
    </div>
  ),
  route: () => (
    <svg className="viz-route" viewBox="0 0 320 120" aria-hidden="true">
      <defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stopColor="#22D3EE" /><stop offset="1" stopColor="#A78BFA" /></linearGradient></defs>
      {[20, 60, 100].map((y, i) => (
        <g key={y}>
          <path id={`rp${i}`} d={`M20 60 C 120 60, 160 ${y}, 260 ${y}`} stroke="url(#rg)" strokeWidth="2" fill="none" opacity=".55" />
          <circle r="4" fill="#ECFEFF"><animateMotion dur={`${2.2 + i * 0.4}s`} repeatCount="indefinite"><mpath href={`#rp${i}`} /></animateMotion></circle>
          <rect x="262" y={y - 11} width="50" height="22" rx="6" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.18)" />
          <text x="287" y={y + 4} textAnchor="middle" fontSize="10" fill="#CFFAFE">{['S-114', 'S-207', 'S-311'][i]}</text>
        </g>
      ))}
      <circle cx="20" cy="60" r="9" fill="#22D3EE" opacity=".25" /><circle cx="20" cy="60" r="5" fill="#22D3EE" />
    </svg>
  ),
  alloc: () => (
    <div className="viz-alloc">
      <div className="va-bar">
        {panels.map((p, i) => (
          <motion.i key={p.short} style={{ background: p.color }} initial={{ flexGrow: 1 }}
            whileInView={{ flexGrow: [1, [14, 9, 77][i], [40, 25, 35][i], [14, 9, 77][i]] }} viewport={inView}
            transition={{ duration: 4, ease: 'easeInOut' }} />
        ))}
      </div>
      <div className="va-legend">{panels.map((p, i) => <span key={p.short}><i style={{ background: p.color }} />{p.short} {[14, 9, 77][i]}</span>)}</div>
    </div>
  ),
  batch: () => (
    <div className="viz-batch">
      {['US', 'GB', 'DE', 'IN'].map((c, r) => (
        <div key={c} className="vb-row"><span>{c}</span>
          <div>{[0, 1, 2].map((k) => (
            <motion.i key={k} style={{ left: `${4 + k * 28 + r * 6}%` }} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }}
              viewport={inView} transition={{ delay: 0.2 + k * 0.25 + r * 0.1 }} />
          ))}</div>
        </div>
      ))}
    </div>
  ),
};

export default function Capabilities() {
  return (
    <section id="capabilities" className="section caps">
      <div className="container">
        <SectionHead num="02" eyebrow="Capabilities" title="Everything an audience needs," accent="in one engine."
          lead="Each capability works on its own and gets better together: the same request, the same respondents, the same live numbers." />
        <div className="bento">
          {capabilities.map((c, i) => {
            const V = Viz[c.viz];
            return (
              <Reveal key={c.id} delay={(i % 4) * 0.06} className={`bento-cell ${c.size}`}>
                <Tilt className="bento-card" style={{ '--c': c.color }} max={6}>
                  <div className="bc-head">
                    <span className="bc-icon"><Icon name={c.icon} size={20} /></span>
                    <h3>{c.title}</h3>
                  </div>
                  <p>{c.text}</p>
                  <div className="bc-viz">{V && <V />}</div>
                  <span className="bc-shine" />
                </Tilt>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
