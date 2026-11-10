/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (url.includes('?') || !coreScript.test(url)) return next()
        const path = join(server.config.root, decodeURIComponent(url))
        if (!path.startsWith(join(server.config.root, 'node_modules'))) return next()
        readFile(path).then(
          (body) => {
            res.writeHead(200, {
              'Content-Type': 'text/javascript',
              // The app reads this to show download progress against a total.
              'Content-Length': body.byteLength,
              ...crossOriginIsolation,
            })
            res.end(body)
          },
          () => next(),
        )
      })
    },
  }
}

const ONE_YEAR = 60 * 60 * 24 * 365

/**
 * Installable app with an offline shell. The service worker precaches only the shell; each
 * ffmpeg core is cached the first time a join downloads it. A new version waits until the user
 * presses Reload on the update toast, so an update never interrupts a join.
 */
const pwa = VitePWA({
  registerType: 'prompt',
  injectRegister: false,
  devOptions: { enabled: false },
  manifest: {
    name: 'VBClipper',
    short_name: 'VBClipper',
    description:
      'Mark the points in a volleyball recording and join them into one highlights video.',
    display: 'standalone',
    start_url: '/',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    globPatterns: ['index.html', 'assets/*.{js,css}', 'favicon.svg'],
    globIgnores: ['assets/ffmpeg-core*'],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/assets/ffmpeg-core'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'ffmpeg-core',
          expiration: { maxAgeSeconds: ONE_YEAR },
          cacheableResponse: { statuses: [200] },
        },
      },
    ],
  },
})

/**
 * The plugin's register module imports workbox-window from the app, but pnpm keeps that package
 * inside the plugin's own dependencies. Resolve it from there instead of adding it to package.json.
 */
const workboxWindow = dirname(
  createRequire(createRequire(import.meta.url).resolve('vite-plugin-pwa')).resolve(
    'workbox-window/package.json',
  ),
)

export default defineConfig({
  plugins: [react(), serveFFmpegCoreUntransformed(), pwa],
  resolve: { alias: { 'workbox-window': workboxWindow } },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  build: {
    // The core's pthread worker is small enough to be inlined as a data: URL, which cannot be
    // started as a same-origin worker. Keep every core file a separate asset.
    assetsInlineLimit: (file) => (file.includes('/@ffmpeg/core') ? false : undefined),
  },
  optimizeDeps: {
    // Pre-bundling breaks the worker and core URLs these packages resolve at runtime.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/core', '@ffmpeg/core-mt'],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
