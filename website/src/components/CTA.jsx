import Reveal from './fx/Reveal.jsx';
import Magnetic from './fx/Magnetic.jsx';
import Icon from './fx/Icon.jsx';
import icon from '../assets/brand/sampaudience-icon.svg';
import { cta, links } from '../content.js';

export default function CTA() {
  return (
    <section className="cta">
      <div className="cta-rings" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="container cta-inner">
        <Reveal><img src={icon} alt="" className="cta-icon" /></Reveal>
        <Reveal as="h2" delay={0.08} className="cta-title">{cta.title}</Reveal>
        <Reveal as="p" delay={0.16} className="cta-sub">{cta.sub}</Reveal>
        <Reveal delay={0.24} className="hero-ctas center">
          <Magnetic href={links.demo} className="btn btn-primary btn-lg">Book a demo <Icon name="ArrowUpRight" size={18} /></Magnetic>
          <Magnetic href={links.sales} className="btn btn-ghost btn-lg"><Icon name="Mail" size={18} /> Talk to us</Magnetic>
        </Reveal>
      </div>
    </section>
  );
}
