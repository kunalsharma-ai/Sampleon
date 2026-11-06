import { Suspense, lazy, useEffect, useState } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import Magnetic from './fx/Magnetic.jsx';
import Icon from './fx/Icon.jsx';
import { hero, links } from '../content.js';

// three.js is loaded after the text has painted, so the headline never waits for 3D.
const GlobeScene = lazy(() => import('./GlobeScene.jsx'));

const ease = [0.2, 0.8, 0.2, 1];

function SplitTitle({ text, className, delay = 0 }) {
  return (
    <span className={className} aria-label={text}>
      {text.split('').map((ch, i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          className="char"
          initial={{ y: '110%', rotateX: -80, opacity: 0 }}
          animate={{ y: '0%', rotateX: 0, opacity: 1 }}
          transition={{ duration: 0.9, delay: delay + i * 0.035, ease }}
        >
          {ch === ' ' ? ' ' : ch}
        </motion.span>
      ))}
    </span>
  );
}

/** The animated "brief → criteria → feasibility" card. Cycles through hero.briefs. */
function BriefCard() {
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [stage, setStage] = useState(0); // 0 typing, 1 chips, 2 numbers
  const b = hero.briefs[idx];

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(b.text); setStage(2); return;
    }
    setTyped(''); setStage(0);
    let i = 0;
    const timers = [];
    const type = setInterval(() => {
      i++; setTyped(b.text.slice(0, i));
      if (i >= b.text.length) {
        clearInterval(type);
        timers.push(setTimeout(() => setStage(1), 350));
        timers.push(setTimeout(() => setStage(2), 1500));
        timers.push(setTimeout(() => setIdx((n) => (n + 1) % hero.briefs.length), 5600));
      }
    }, 34);
    return () => { clearInterval(type); timers.forEach(clearTimeout); };
  }, [idx]);

  return (
    <div className="brief-card glass">
      <div className="brief-top">
        <span className="brief-dot" /><span className="brief-dot" /><span className="brief-dot" />
        <span className="brief-title"><Icon name="Sparkles" size={14} /> Describe your audience</span>
        <span className="demo-tag">Demo</span>
      </div>
      <div className="brief-input">
        {typed}<span className="caret" />
      </div>
      <div className="brief-chips">
        <AnimatePresence mode="popLayout">
          {stage >= 1 && b.chips.map((c, i) => (
            <motion.span key={idx + c} className="chip"
              initial={{ opacity: 0, scale: 0.6, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }} transition={{ delay: i * 0.12, type: 'spring', stiffness: 380, damping: 22 }}>
              {c}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <div className="brief-nums">
        <Num label="Eligible" value={stage >= 2 ? b.eligible : 0} />
        <Num label="Reachable" value={stage >= 2 ? b.reachable : 0} accent />
        <div className="brief-panel">
          <span>Best panel</span>
          <AnimatePresence mode="wait">
            <motion.b key={stage >= 2 ? b.panel : 'wait'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              {stage >= 2 ? b.panel : '…'}
            </motion.b>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Num({ label, value, accent }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf; const start = performance.now(); const from = v;
    const step = (now) => {
      const p = Math.min((now - start) / 900, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (value - from) * e));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={`brief-num ${accent ? 'accent' : ''}`}>
      <span>{label}</span>
      <b>{v.toLocaleString('en-US')}</b>
    </div>
  );
}

export default function Hero() {
  const { scrollY } = useScroll();
  const globeY = useTransform(scrollY, [0, 800], [0, 160]);
  const globeScale = useTransform(scrollY, [0, 800], [1, 0.82]);
  const textY = useTransform(scrollY, [0, 800], [0, -80]);
  const fade = useTransform(scrollY, [0, 600], [1, 0]);

  return (
    <section className="hero" id="top">
      <div className="hero-aurora" aria-hidden="true">
        <span className="blob b1" /><span className="blob b2" /><span className="blob b3" />
      </div>
      <div className="hero-grid-floor" aria-hidden="true" />

      <motion.div className="hero-globe" style={{ y: globeY, scale: globeScale }}>
        <Suspense fallback={null}><GlobeScene className="globe-canvas" /></Suspense>
        <FloatChip className="fc1" icon="MessageCircleQuestion" color="#FF8A65" title="Question sent" sub="AR-01JC9Y · 3 countries" d={1.4} />
        <FloatChip className="fc2" icon="CircleCheckBig" color="#5EEAD4" title="Complete received" sub="signed · 0.4s ago" d={1.7} />
        <FloatChip className="fc3" icon="LayoutGrid" color="#F5B544" title="Quota cell 82%" sub="Women 35–44 · GB" d={2.0} />
      </motion.div>

      <motion.div className="hero-inner container" style={{ y: textY, opacity: fade }}>
        <motion.div className="pill" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease }}>
          <span className="pill-new">New name</span> SAMPLEON is now SampAudience
        </motion.div>
        <motion.p className="hero-eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          {hero.eyebrow}
        </motion.p>
        <h1 className="hero-title">
          <SplitTitle text={hero.titleA} className="line a" delay={0.25} />
          <SplitTitle text={hero.titleB} className="line b serif" delay={0.75} />
        </h1>
        <motion.p className="hero-sub" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.8, ease }}>
          {hero.sub}
        </motion.p>
        <motion.div className="hero-ctas" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4, duration: 0.8, ease }}>
          <Magnetic href={links.demo} className="btn btn-primary">
            {hero.ctaPrimary} <Icon name="ArrowUpRight" size={18} />
          </Magnetic>
          <Magnetic href="#journey" className="btn btn-ghost">
            <Icon name="Play" size={16} /> {hero.ctaSecondary}
          </Magnetic>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6, duration: 0.9, ease }}>
          <BriefCard />
        </motion.div>
      </motion.div>

      <a href="#journey" className="scroll-cue" aria-label="Scroll to how it works"><span /></a>
    </section>
  );
}

function FloatChip({ className, icon, color, title, sub, d }) {
  return (
    <motion.div className={`float-chip glass ${className}`} style={{ '--c': color }}
      initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: d, type: 'spring', stiffness: 200, damping: 16 }}>
      <span className="fc-icon"><Icon name={icon} size={16} /></span>
      <span><b>{title}</b><small>{sub}</small></span>
    </motion.div>
  );
}
