import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function feedProxyPlugin() {
  return {
    name: 'feed-proxy',
    configureServer(server) {
      server.middlewares.use('/.netlify/functions/feed', async (req, res) => {
        const url = new URL(req.url, 'http://localhost').searchParams.get('url')
        if (!url) { res.writeHead(400); res.end('Missing url'); return }
        try {
          const r = await fetch(url)
          const body = await r.text()
          res.writeHead(200, { 'Content-Type': 'text/xml', 'Access-Control-Allow-Origin': '*' })
          res.end(body)
        } catch { res.writeHead(502); res.end('Fetch failed') }
      })
    },
  }
}

function spotifyProxyPlugin() {
  return {
    name: 'spotify-proxy',
    configureServer(server) {
      server.middlewares.use('/.netlify/functions/spotify', async (req, res) => {
        const action = new URL(req.url, 'http://localhost').searchParams.get('action')
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        if (req.method === 'OPTIONS') { res.writeHead(200); res.end(''); return }
        // In dev, forward to the real Netlify function or return mock data
        // For now, return a message telling the user to set up Netlify dev
        res.writeHead(200)
        res.end(JSON.stringify({ error: 'Use netlify dev for Spotify functions locally', tracks: [] }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), feedProxyPlugin(), spotifyProxyPlugin()],
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
