import Reveal from './Reveal.jsx';

/** Shared section heading: kicker number, eyebrow, title (with optional serif accent) and lead. */
export default function SectionHead({ num, eyebrow, title, accent, lead, align = 'left', tone }) {
  return (
    <div className={`section-head ${align} ${tone || ''}`}>
      <Reveal className="eyebrow">
        {num && <span className="eyebrow-num">{num}</span>}
        {eyebrow}
      </Reveal>
      <Reveal as="h2" delay={0.05} className="h2">
        {title} {accent && <em className="serif">{accent}</em>}
      </Reveal>
      {lead && <Reveal as="p" delay={0.12} className="lead">{lead}</Reveal>}
    </div>
  );
}
