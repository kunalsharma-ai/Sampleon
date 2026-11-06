import Reveal from './fx/Reveal.jsx';
import Counter from './fx/Counter.jsx';
import { stats } from '../content.js';

export default function Stats() {
  return (
    <section className="stats container">
      {stats.map((s, i) => (
        <Reveal key={i} delay={i * 0.08} className="stat">
          <div className="stat-num"><Counter to={s.value} />{s.suffix}</div>
          <div className="stat-label">{s.label}</div>
        </Reveal>
      ))}
    </section>
  );
}
