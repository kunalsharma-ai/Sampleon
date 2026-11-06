import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform, useMotionTemplate } from 'framer-motion';
import SectionHead from './fx/SectionHead.jsx';
import Reveal from './fx/Reveal.jsx';
import Icon from './fx/Icon.jsx';
import { journey } from '../content.js';

/**
 * "How it works": one request travels through nine stages.
 * Desktop: the page scrolls vertically while the stages slide sideways (sticky track).
 * Tablet/phone: a simple vertical timeline.
 */
export default function Journey() {
  const wrap = useRef(null);
  const track = useRef(null);
  const [dist, setDist] = useState(0);
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const measure = () => {
      setWide(innerWidth >= 960);
      if (track.current) setDist(Math.max(track.current.scrollWidth - innerWidth + 80, 0));
    };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, []);

  const { scrollYProgress } = useScroll({ target: wrap, offset: ['start start', 'end end'] });
  const x = useTransform(scrollYProgress, [0, 1], [0, -dist]);
  const hue = useTransform(scrollYProgress, [0, 0.5, 1], [190, 265, 170]);
  const bg = useMotionTemplate`radial-gradient(1200px 600px at 70% 30%, hsla(${hue}, 80%, 45%, 0.18), transparent 60%)`;
  const bar = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

  if (!wide) {
    return (
      <section id="journey" className="journey-v container section">
        <SectionHead num="01" eyebrow="How it works" title="From brief to answers," accent="in nine moves."
          lead="Follow one audience request as SampAudience takes it from a sentence to signed, counted outcomes." />
        <ol className="jv-list">
          {journey.map((s, i) => (
            <Reveal as="li" key={s.k} className="jv-item" style={{ '--c': s.color }}>
              <span className="jv-dot"><Icon name={s.icon} size={18} /></span>
              <div><small>Step {String(i + 1).padStart(2, '0')}</small><h3>{s.k}</h3><p>{s.text}</p></div>
            </Reveal>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section id="journey" ref={wrap} className="journey" style={{ height: `calc(100vh + ${dist}px)` }}>
      <motion.div className="journey-sticky" style={{ backgroundImage: bg }}>
        <div className="container journey-head">
          <SectionHead num="01" eyebrow="How it works" title="From brief to answers," accent="in nine moves."
            lead="Keep scrolling. One audience request travels from a sentence to signed, counted outcomes." />
        </div>
        <div className="journey-rail" aria-hidden="true">
          <motion.div className="journey-rail-fill" style={{ width: bar }} />
          <motion.span className="journey-token" style={{ left: bar }}>AR-01JC9Y…</motion.span>
        </div>
        <motion.ol ref={track} className="journey-track" style={{ x }}>
          {journey.map((s, i) => (
            <li key={s.k} className="j-card" style={{ '--c': s.color }}>
              <span className="j-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="j-orb"><Icon name={s.icon} size={26} /></span>
              <h3>{s.k}</h3>
              <p>{s.text}</p>
              <span className="j-glow" />
            </li>
          ))}
          <li className="j-card j-end">
            <span className="serif">and then</span>
            <b>you hear back.</b>
          </li>
        </motion.ol>
      </motion.div>
    </section>
  );
}
