import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/feed/simplecast': {
        target: 'https://feeds.simplecast.com',
        changeOrigin: true,
        rewrite: (path) => path.replace('/feed/simplecast', ''),
      },
      '/feed/npr': {
        target: 'https://feeds.npr.org',
        changeOrigin: true,
        rewrite: (path) => path.replace('/feed/npr', ''),
      },
    },
  },
})
