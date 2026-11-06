import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SectionHead from './fx/SectionHead.jsx';
import Tilt from './fx/Tilt.jsx';
import Icon from './fx/Icon.jsx';
import Lightbox from './fx/Lightbox.jsx';
import { tour, shot } from '../content.js';

const DURATION = 6500; // ms per screen when auto-playing

export default function Tour() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [zoom, setZoom] = useState(null);
  const t = tour[i];

  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => setI((n) => (n + 1) % tour.length), DURATION);
    return () => clearTimeout(id);
  }, [i, paused]);

  return (
    <section id="tour" className="section tour">
      <div className="container">
        <SectionHead num="03" eyebrow="Product tour" title="Real screens." accent="Real workflow."
          lead="SampAudience lives where your team already works: inside SUPPLY360, PROJEXA and ZAPX. Click any screen to enlarge it." />
        <div className="tour-grid" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          <ul className="tour-tabs" role="tablist">
            {tour.map((x, k) => (
              <li key={x.id}>
                <button role="tab" aria-selected={k === i} className={k === i ? 'on' : ''} onClick={() => setI(k)}>
                  <span className="tt-num">{String(k + 1).padStart(2, '0')}</span>
                  <span className="tt-label">{x.label}</span>
                  {k === i && !paused && <motion.span className="tt-prog" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: DURATION / 1000, ease: 'linear' }} />}
                </button>
              </li>
            ))}
          </ul>
          <div className="tour-stage">
            <Tilt className="browser" max={5}>
              <div className="browser-bar">
                <span /><span /><span />
                <div className="browser-url"><Icon name="Lock" size={12} /> app.sampledge.com / sampaudience</div>
              </div>
              <div className="browser-view">
                <AnimatePresence mode="wait">
                  <motion.button key={t.id} className="browser-shot" onClick={() => setZoom(t.img)} aria-label={`Enlarge ${t.label}`}
                    initial={{ opacity: 0, scale: 1.04, filter: 'blur(10px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, scale: 0.98, filter: 'blur(10px)' }} transition={{ duration: 0.55 }}>
                    <img src={shot(t.img)} alt={`${t.label} screen`} loading="lazy" />
                  </motion.button>
                </AnimatePresence>
              </div>
            </Tilt>
            <AnimatePresence mode="wait">
              <motion.div key={t.id} className="tour-caption glass" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <b>{t.label}</b><p>{t.text}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <p className="fine">Screens show demo data. Some still carry the product’s former name, SAMPLEON.</p>
      </div>
      <Lightbox src={zoom && shot(zoom)} onClose={() => setZoom(null)} />
    </section>
  );
}
