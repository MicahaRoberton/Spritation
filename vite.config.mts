import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode preview` inlines everything into one HTML file for the shareable browser build.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'preview' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'preview' ? 'dist-preview' : 'dist',
    emptyOutDir: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
