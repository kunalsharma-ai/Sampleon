import SectionHead from './fx/SectionHead.jsx';
import Reveal from './fx/Reveal.jsx';
import Tilt from './fx/Tilt.jsx';
import Icon from './fx/Icon.jsx';
import { trust } from '../content.js';

export default function Trust() {
  return (
    <section className="section trust">
      <div className="container trust-grid">
        <div>
          <SectionHead num="07" eyebrow="Trust & control" title="Fast, and" accent="never careless."
            lead="Speed comes from automation. Confidence comes from what we refused to automate." />
          <div className="trust-cards">
            {trust.map((t, i) => (
              <Reveal key={t.title} delay={i * 0.07}>
                <Tilt className="trust-card" max={8}>
                  <span className="tc-icon"><Icon name={t.icon} size={22} /></span>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                </Tilt>
              </Reveal>
            ))}
          </div>
        </div>
        <Reveal className="code-card" y={40}>
          <div className="code-top"><span /><span /><span /><em>outcome.signed.json</em></div>
          <pre><code>
<span className="k">POST</span> /v1/outcomes{'\n'}
<span className="c">X-Sampledge-Client:</span> zapx{'\n'}
<span className="c">X-Sampledge-Timestamp:</span> 1793961000{'\n'}
<span className="c">X-Sampledge-Signature:</span> v1=9f2c…e71a{'\n\n'}
{'{'}{'\n'}
{'  '}<span className="p">"audienceRequestId"</span>: <span className="s">"AR-01JC9Y3V8Q6K…"</span>,{'\n'}
{'  '}<span className="p">"respondent"</span>: <span className="s">"tok_7Hq…"</span>,  <span className="m">// no name, no e-mail</span>{'\n'}
{'  '}<span className="p">"status"</span>: <span className="s">"complete"</span>,{'\n'}
{'  '}<span className="p">"approvedBy"</span>: <span className="s">"supply.approver"</span>{'\n'}
{'}'}
          </code></pre>
          <div className="code-ok"><Icon name="BadgeCheck" size={16} /> Signature valid · counted once · quota cell updated</div>
        </Reveal>
      </div>
    </section>
  );
}
