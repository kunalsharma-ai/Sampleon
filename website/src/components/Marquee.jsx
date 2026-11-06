import { marquee } from '../content.js';

export default function Marquee() {
  const items = [...marquee, ...marquee];
  return (
    <div className="marquee" aria-label="Capabilities">
      <div className="marquee-track">
        {items.map((m, i) => (
          <span key={i} className="marquee-item">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z" fill="currentColor" /></svg>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}
