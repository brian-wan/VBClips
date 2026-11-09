/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// SharedArrayBuffer (and so the multi-thread ffmpeg core) needs a cross-origin isolated page.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/**
 * The dev server rewrites every .js it serves, injecting an `import` that breaks the core's
 * classic pthread worker. Serve the core scripts byte for byte when the core itself requests
 * them (no query string); the `?url` imports in the app still go through Vite. Builds emit these
 * files as plain assets, so this is dev only.
 */
function serveFFmpegCoreUntransformed(): Plugin {
  const coreScript = /\/@ffmpeg\/core(-mt)?\/dist\/esm\/ffmpeg-core(\.worker)?\.js$/
  return {
    name: 'serve-ffmpeg-core-untransformed',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (url.includes('?') || !coreScript.test(url)) return next()
        const path = join(server.config.root, decodeURIComponent(url))
        if (!path.startsWith(join(server.config.root, 'node_modules'))) return next()
        try {
          const body = await readFile(path)
          res.writeHead(200, { 'Content-Type': 'text/javascript', ...crossOriginIsolation })
          res.end(body)
        } catch {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), serveFFmpegCoreUntransformed()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  build: {
    // The core's pthread worker is small enough to be inlined as a data: URL, which cannot be
    // started as a same-origin worker. Keep every core file a separate asset.
    assetsInlineLimit: (file) => (file.includes('/@ffmpeg/core') ? false : undefined),
  },
  optimizeDeps: {
    // Pre-bundling breaks the worker and core URLs these packages resolve at runtime.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core', '@ffmpeg/core-mt'],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
