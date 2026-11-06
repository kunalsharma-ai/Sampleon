import { useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

/** A link/button that leans toward the pointer. */
export default function Magnetic({ children, className, href, strength = 0.35, ...rest }) {
  const ref = useRef(null);
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 15 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 15 });
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  return (
    <motion.a ref={ref} href={href} className={className} style={{ x, y }}
      onPointerMove={onMove} onPointerLeave={() => { x.set(0); y.set(0); }} {...rest}>
      {children}
    </motion.a>
  );
}
