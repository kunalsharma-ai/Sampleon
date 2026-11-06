import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SectionHead from './fx/SectionHead.jsx';
import Reveal from './fx/Reveal.jsx';
import icon from '../assets/brand/sampaudience-icon.svg';
import { ecosystem, panels } from '../content.js';

/** Orbit map: SampAudience in the centre, products on the inner orbit, panels on the outer one. */
export default function Ecosystem() {
  const [sel, setSel] = useState(ecosystem[0].id);
  const cur = ecosystem.find((e) => e.id === sel);
  return (
    <section id="ecosystem" className="section eco">
      <div className="container eco-grid">
        <div>
          <SectionHead num="05" eyebrow="Ecosystem" title="The centre of" accent="Sampledge’s orbit."
            lead="SampAudience is the one routing, quota and invitation engine for the whole platform. Pick a product to see how it connects." />
          <div className="eco-pick">
            {ecosystem.map((e) => (
              <button key={e.id} className={sel === e.id ? 'on' : ''} style={{ '--c': e.color }} onClick={() => setSel(e.id)}>
                <i />{e.name}<small>{e.role}</small>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.p key={cur.id} className="eco-text" style={{ '--c': cur.color }}
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
              {cur.text}
            </motion.p>
          </AnimatePresence>
          <Reveal className="eco-panels">
            <span>Panels served:</span>
            {panels.map((p) => <b key={p.short} style={{ '--c': p.color }}>{p.name}</b>)}
          </Reveal>
        </div>

        <Reveal className="orbit-wrap" y={40}>
          <div className="orbit">
            <div className="orbit-ring r1">
              {ecosystem.map((e, i) => (
                <button key={e.id} className={`orbit-node ${sel === e.id ? 'on' : ''}`} onClick={() => setSel(e.id)}
                  style={{ '--a': `${i * 120}deg`, '--c': e.color }} aria-label={e.name}>
                  <span>{e.name}</span>
                </button>
              ))}
            </div>
            <div className="orbit-ring r2">
              {panels.map((p, i) => (
                <span key={p.short} className="orbit-node small" style={{ '--a': `${60 + i * 120}deg`, '--c': p.color }}>
                  <span>{p.short}</span>
                </span>
              ))}
            </div>
            <div className="orbit-ring r3" />
            <div className="orbit-core">
              <img src={icon} alt="SampAudience" />
            </div>
            <svg className="orbit-beams" viewBox="0 0 400 400" aria-hidden="true">
              {[0, 120, 240].map((a) => (
                <line key={a} x1="200" y1="200" x2={200 + 130 * Math.cos(((a - 90) * Math.PI) / 180)} y2={200 + 130 * Math.sin(((a - 90) * Math.PI) / 180)} />
              ))}
            </svg>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
