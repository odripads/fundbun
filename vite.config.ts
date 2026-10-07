import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The LLM gateway (server/index.ts) listens on 8787 in development.
const API_PORT = Number(process.env.FUNDBUN_API_PORT ?? 8787)

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'pages' ? '/fundbun/' : '/',
  define: {
    __FUNDBUN_STATIC__: JSON.stringify(mode === 'pages'),
  },
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    proxy: { '/api': `http://localhost:${API_PORT}` },
  },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
}))
