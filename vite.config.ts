/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// SharedArrayBuffer (and so the multi-thread ffmpeg core) needs a cross-origin isolated page.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  optimizeDeps: {
    // Pre-bundling breaks the worker and core URLs these packages resolve at runtime.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core', '@ffmpeg/core-mt'],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
