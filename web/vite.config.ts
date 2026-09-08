import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Budget: under 200 KB gzipped. Spec: 02-TRD.md §7
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
