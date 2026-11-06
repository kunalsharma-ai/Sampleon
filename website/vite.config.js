import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`         -> dist/            (production site: hashed JS/CSS + image files)
// `npm run build:preview` -> dist-preview/    (one self-contained index.html, images inlined)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    // Relative base so the build works from any sub-path, e.g. sampledge.com/sampaudience/
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    build: single
      ? { outDir: 'dist-preview', assetsInlineLimit: 100_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 8000 }
      : { outDir: 'dist', assetsInlineLimit: 4096, chunkSizeWarningLimit: 800 },
  };
});
