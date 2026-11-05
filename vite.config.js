import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 8000,
    host: true,           // opcional: expone en 0.0.0.0 para probar desde el móvil
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  // publicDir: 'public' es el default de Vite — no hace falta declararlo
});
