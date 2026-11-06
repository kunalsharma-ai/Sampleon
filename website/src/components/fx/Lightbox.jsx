import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon.jsx';

export default function Lightbox({ src, onClose }) {
  useEffect(() => {
    if (!src) return;
    const k = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [src, onClose]);
  return (
    <AnimatePresence>
      {src && (
        <motion.div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="lb-close" aria-label="Close" onClick={onClose}><Icon name="X" /></button>
          <motion.img src={src} alt="" initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
            onClick={(e) => e.stopPropagation()} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
