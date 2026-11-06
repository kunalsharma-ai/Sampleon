import { useEffect, useRef } from 'react';

/** A soft teal light that trails the pointer on desktop. */
export default function CursorGlow() {
  const ref = useRef(null);
  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, raf;
    const move = (e) => { tx = e.clientX; ty = e.clientY; };
    const loop = () => {
      x += (tx - x) * 0.12; y += (ty - y) * 0.12;
      if (ref.current) ref.current.style.transform = `translate(${x - 300}px, ${y - 300}px)`;
      raf = requestAnimationFrame(loop);
    };
    addEventListener('pointermove', move); loop();
    return () => { removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}
