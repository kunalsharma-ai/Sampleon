import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import SectionHead from './fx/SectionHead.jsx';
import Icon from './fx/Icon.jsx';
import { difference } from '../content.js';

/**
 * "Why us" on a light, paper-toned section for contrast.
 * Each row is a 3D card: it starts on "the usual way" and flips to SampAudience when scrolled into view.
 * The switch flips them all back and forth.
 */
export default function Difference() {
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, margin: '-20% 0px' });
  const [ours, setOurs] = useState(false);
  useEffect(() => { if (seen) { const t = setTimeout(() => setOurs(true), 500); return () => clearTimeout(t); } }, [seen]);

  return (
    <section id="difference" className="section diff">
      <div className="container">
        <SectionHead num="04" tone="on-light" eyebrow="Why SampAudience" title="Same industry." accent="Different rules."
          lead="Most sample tools move links and numbers between companies. SampAudience moves the whole job, with people in charge and personal data kept home." />

        <div className="diff-switch" role="group" aria-label="Compare">
          <button className={!ours ? 'on' : ''} onClick={() => setOurs(false)}>{difference.them}</button>
          <button className={ours ? 'on' : ''} onClick={() => setOurs(true)}>{difference.us}</button>
          <motion.span className="diff-knob" animate={{ x: ours ? '100%' : '0%' }} transition={{ type: 'spring', stiffness: 300, damping: 28 }} />
        </div>

        <div ref={ref} className="diff-grid">
          {difference.rows.map((r, i) => (
            <div key={r.topic} className="flip">
              <motion.div className="flip-inner" animate={{ rotateY: ours ? 180 : 0 }}
                transition={{ duration: 0.9, delay: i * 0.08, ease: [0.3, 1.2, 0.4, 1] }}>
                <div className="flip-face them">
                  <small>{r.topic}</small>
                  <p><Icon name="CircleMinus" size={18} /> {r.them}</p>
                </div>
                <div className="flip-face us">
                  <small>{r.topic}</small>
                  <p><Icon name="CircleCheckBig" size={18} /> {r.us}</p>
                </div>
              </motion.div>
            </div>
          ))}
        </div>
        <p className="fine dark">{difference.note}</p>
      </div>
    </section>
  );
}
