import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import svgr from 'vite-plugin-svgr'
import path from 'path'

import type { Plugin } from 'vite'

// Renderer-only config for Tauri's dev server / `devUrl`. Mirrors the
// `renderer` block in electron.vite.config.ts (kept for the Electron
// build, untouched) — this is the split-out standalone equivalent so
// Tauri can point at a real Vite dev server instead of electron-vite's
// internal one, which isn't reachable outside the Electron process.
// Named vite.renderer.config.ts (not vite.config.ts) on purpose: Vite's
// default config auto-discovery picks up any root `vite.config.*` and
// that collided with electron-vite's own config resolution, breaking
// `electron-vite build`. Always invoke this file with `--config`.
const srcAliases = ['backend', 'frontend', 'common'].map((aliasName) => ({
  find: aliasName,
  replacement: path.join(__dirname, 'src', aliasName)
}))

const vite_plugin_react_dev_tools: Plugin = {
  name: 'react-dev-tools-replace',
  transformIndexHtml: {
    handler: (html) =>
      html.replace(
        '<!-- REACT_DEVTOOLS_SCRIPT -->',
        '<script src="http://localhost:8097"></script>'
      )
  }
}

export default defineConfig(({ mode }) => ({
  root: '.',
  resolve: { alias: srcAliases },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    rollupOptions: {
      input: path.resolve('index.html')
    },
    target: 'esnext',
    outDir: 'build',
    emptyOutDir: false,
    minify: true,
    sourcemap: mode === 'development' ? 'inline' : false
  },
  plugins: [
    react(),
    svgr(),
    mode !== 'production' && vite_plugin_react_dev_tools
  ]
}))
