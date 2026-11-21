import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Pfade, damit die App auch in einem Unterordner läuft (z. B. GitHub Pages).
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  test: { include: ['tests/unit/**/*.test.js'] },
});
