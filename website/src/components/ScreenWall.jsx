import { useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import Lightbox from './fx/Lightbox.jsx';
import { wall, shot } from '../content.js';

/** Two rows of screenshots drifting in opposite directions on a tilted 3D plane. */
export default function ScreenWall() {
  const ref = useRef(null);
  const [zoom, setZoom] = useState(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const rot = useTransform(scrollYProgress, [0, 0.5, 1], [28, 14, 4]);
  const half = Math.ceil(wall.length / 2);
  const rows = [wall.slice(0, half), wall.slice(half)];
  return (
    <section ref={ref} className="wall" aria-label="More SampAudience and SUPPLY360 screens">
      <motion.div className="wall-plane" style={{ rotateX: rot }}>
        {rows.map((r, k) => (
          <div key={k} className={`wall-row ${k ? 'rev' : ''}`}>
            {[...r, ...r].map((n, i) => (
              <button key={i} className="wall-item" onClick={() => setZoom(n)} aria-label="Enlarge screen">
                <img src={shot(n)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        ))}
      </motion.div>
      <div className="wall-fade" />
      <Lightbox src={zoom && shot(zoom)} onClose={() => setZoom(null)} />
    </section>
  );
}
