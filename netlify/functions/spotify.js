export default async (req) => {
  const action = new URL(req.url).searchParams.get('action')
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }

  if (req.method === 'OPTIONS') return new Response('', { headers })

  if (action === 'token') {
    const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
      return new Response(JSON.stringify({ error: 'Missing Spotify env vars' }), { status: 500, headers })
    }
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`) },
        body: `grant_type=refresh_token&refresh_token=${SPOTIFY_REFRESH_TOKEN}`,
      })
      const data = await res.json()
      if (!res.ok) return new Response(JSON.stringify({ error: data.error_description || 'Token refresh failed' }), { status: 401, headers })
      return new Response(JSON.stringify({ accessToken: data.access_token, expiresIn: data.expires_in }), { headers })
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Token request failed' }), { status: 502, headers })
    }
  }

  if (action === 'top-tracks') {
    try {
      const body = await req.json()
      const { accessToken } = body
      if (!accessToken) return new Response(JSON.stringify({ error: 'Missing accessToken' }), { status: 400, headers })
      const res = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return new Response(JSON.stringify({ error: err.error?.message || 'Spotify API error' }), { status: res.status, headers })
      }
      const data = await res.json()
      const tracks = (data.items || []).map((t) => ({
        id: t.id,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        albumArt: t.album.images?.[0]?.url || '',
        previewUrl: t.preview_url || '',
        durationMs: t.duration_ms,
      }))
      return new Response(JSON.stringify({ tracks }), { headers })
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Failed to fetch tracks' }), { status: 502, headers })
    }
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers })
}
