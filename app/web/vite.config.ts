import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Em "npm run dev", /api e /ws vao para o servidor do llm-agent ui. Rode o
// servidor com LLM_AGENT_UI_ORIGINS=http://localhost:5173.
const target = `http://127.0.0.1:${process.env.LLM_AGENT_UI_PORT ?? 7777}`;

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': target, '/ws': { target, ws: true } } },
  // Bibliotecas grandes em chunks proprios: o navegador guarda cada uma em
  // cache separado e uma mudanca no app nao obriga a baixar tudo de novo.
  build: {
    // O three e um modulo so (~740 kB minificado) e nao da para dividir; ele
    // so carrega com o globo (CoreScene e lazy). O limite cobre esse chunk e
    // continua avisando se algum outro crescer.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'r3f', test: /node_modules[\\/](@react-three|postprocessing|three-stdlib|camera-controls|maath)[\\/]/ },
            { name: 'xterm', test: /node_modules[\\/]@xterm[\\/]/ },
            { name: 'markdown', test: /node_modules[\\/](react-markdown|remark-|rehype-|micromark|mdast-|hast-|unified|unist-|vfile)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  // css: sem isto o vitest entrega o CSS vazio, e o teste das cores (?raw) nao veria nada.
  test: { environment: 'node', include: ['test/**/*.test.ts'], css: true },
});
