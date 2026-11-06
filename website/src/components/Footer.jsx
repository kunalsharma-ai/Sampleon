import logo from '../assets/brand/sampaudience-logo-on-dark.svg';
import { links, nav } from '../content.js';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <img src={logo} alt="SampAudience by Sampledge" width="200" height="47" />
        <nav aria-label="Footer">{nav.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}</nav>
        <small>© {new Date().getFullYear()} Sampledge · <a href={links.home}>sampledge.com</a> · SampAudience was formerly SAMPLEON.</small>
      </div>
    </footer>
  );
}
