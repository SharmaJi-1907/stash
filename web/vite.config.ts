import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Budget: under 200 KB gzipped. Spec: 02-TRD.md §7
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // Hidden rather than off: the map is written for reading a stack trace
    // locally, but no //# sourceMappingURL comment ships, so browsers never
    // fetch a megabyte nobody asked for. The bundle budget is 200 KB gzipped
    // (02-TRD.md §7) and a shipped map is most of a phone's patience.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // React changes rarely and the app changes constantly. Splitting them
        // means an app update does not re-download the framework.
        manualChunks: { react: ['react', 'react-dom'] },
      },
    },
  },
});
