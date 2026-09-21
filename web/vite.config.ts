import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The Express server (src/index.js) serves this app's build output (dist/) in
// production, plus /vendor/mediapipe/* (downloaded at boot by
// src/vendorAssets.js) and the socket.io endpoint. During `npm run dev` here,
// proxy those same paths to the real server (run separately with `npm start`
// or `npm run dev` from the repo root) so the app behaves identically.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/vendor': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
})
