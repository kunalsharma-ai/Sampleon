import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import logo from '../assets/brand/sampaudience-logo-on-dark.svg';
import Icon from './fx/Icon.jsx';
import { nav, links } from '../content.js';

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 30);
    on(); addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="nav-inner container">
        <a href="#top" className="nav-logo" aria-label="SampAudience home">
          <img src={logo} alt="SampAudience by Sampledge" width="190" height="45" />
        </a>
        <nav className="nav-links" aria-label="Page sections">
          {nav.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
        </nav>
        <a href={links.demo} className="btn btn-primary btn-sm nav-cta">Book a demo</a>
        <button className="nav-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'X' : 'Menu'} />
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav className="nav-sheet" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {nav.map((n) => <a key={n.href} href={n.href} onClick={() => setOpen(false)}>{n.label}</a>)}
            <a href={links.demo} className="btn btn-primary">Book a demo</a>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
