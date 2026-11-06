import { useEffect, useRef, useState } from 'react';
import { animate, useInView } from 'framer-motion';

/** Counts up to `to` the first time it scrolls into view. */
export default function Counter({ to, duration = 1.6, format = (v) => Math.round(v).toLocaleString('en-US') }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(0, to, { duration, ease: [0.2, 0.8, 0.2, 1], onUpdate: setV });
    return () => c.stop();
  }, [inView, to, duration]);
  return <span ref={ref}>{format(v)}</span>;
}
