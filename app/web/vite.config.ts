import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Em "npm run dev", /api e /ws vao para o servidor do llm-agent ui. Rode o
// servidor com LLM_AGENT_UI_ORIGINS=http://localhost:5173.
const target = `http://127.0.0.1:${process.env.LLM_AGENT_UI_PORT ?? 7777}`;

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': target, '/ws': { target, ws: true } } },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
