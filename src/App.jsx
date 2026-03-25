import React, { useState, useEffect, useRef, useCallback } from 'react'

const DEFAULT_FEEDS = [
  { name: 'The Daily', short: 'TD', rssUrl: 'https://feeds.simplecast.com/54nAGcIl', color: '#1a8917' },
  { name: 'Up First', short: 'NPR', rssUrl: 'https://feeds.npr.org/510318/podcast.xml', color: '#db2128' },
]

const isDev = import.meta.env.DEV

function getFeedFetchUrl(rssUrl) {
  if (isDev) {
    try {
      const u = new URL(rssUrl)
      if (u.hostname.includes('simplecast')) return '/feed/simplecast' + u.pathname
      if (u.hostname.includes('npr.org')) return '/feed/npr' + u.pathname
    } catch {}
    // For unknown feeds in dev, use prod proxy anyway
    return '/.netlify/functions/feed?url=' + encodeURIComponent(rssUrl)
  }
  return '/.netlify/functions/feed?url=' + encodeURIComponent(rssUrl)
}

function loadFeeds() {
  try {
    const stored = JSON.parse(localStorage.getItem('dd-feeds'))
    if (Array.isArray(stored) && stored.length > 0) return stored
  } catch {}
  return DEFAULT_FEEDS
}

function saveFeeds(feeds) {
  localStorage.setItem('dd-feeds', JSON.stringify(feeds))
}

function loadPlayback() {
  try { return JSON.parse(localStorage.getItem('dd-playback')) } catch { return null }
}

function savePlayback(data) {
  localStorage.setItem('dd-playback', JSON.stringify(data))
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function parseFeed(xml, feed) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')
  const items = doc.querySelectorAll('item')
  const episodes = []

  for (let i = 0; i < Math.min(items.length, 5); i++) {
    const item = items[i]
    const title = item.querySelector('title')?.textContent || 'Untitled'
    const enclosure = item.querySelector('enclosure')
    const audioUrl = enclosure?.getAttribute('url')
    if (!audioUrl) continue

    const pubDate = item.querySelector('pubDate')?.textContent
    const duration = item.querySelector('duration')?.textContent

    let durationSec = 0
    if (duration) {
      const parts = duration.split(':').map(Number)
      if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2]
      else if (parts.length === 2) durationSec = parts[0] * 60 + parts[1]
      else durationSec = parts[0]
    }

    episodes.push({
      id: `${feed.short}-${i}`,
      title,
      audioUrl,
      pubDate: pubDate ? new Date(pubDate) : new Date(),
      durationSec,
      feedName: feed.name,
      feedShort: feed.short,
      feedColor: feed.color,
    })
  }
  return episodes
}

function updateMediaSession(episode, playing, handlers) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: episode.title,
    artist: episode.feedName,
  })
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  for (const [action, handler] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, handler) } catch {}
  }
}

export default function App() {
  const [feeds, setFeeds] = useState(loadFeeds)
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [newFeedUrl, setNewFeedUrl] = useState('')
  const audioRef = useRef(null)
  const progressRef = useRef(null)
  const saveTimerRef = useRef(null)

  // Fetch episodes from all feeds
  const fetchAllFeeds = useCallback(async (feedList) => {
    setLoading(true)
    setError(null)
    try {
      const results = await Promise.allSettled(
        feedList.map(async (feed) => {
          const res = await fetch(getFeedFetchUrl(feed.rssUrl))
          if (!res.ok) throw new Error(`Failed to fetch ${feed.name}`)
          const xml = await res.text()
          return parseFeed(xml, feed)
        })
      )

      const allEpisodes = results
        .filter((r) => r.status === 'fulfilled')
        .flatMap((r) => r.value)

      allEpisodes.sort((a, b) => b.pubDate - a.pubDate)

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayEps = allEpisodes.filter((ep) => ep.pubDate >= today)
      const finalEps = todayEps.length > 0 ? todayEps : allEpisodes.slice(0, 6)
      setEpisodes(finalEps)

      if (results.every((r) => r.status === 'rejected')) {
        setError('Could not load any feeds. Check your connection.')
      }

      return finalEps
    } catch (e) {
      setError(e.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + restore playback
  useEffect(() => {
    fetchAllFeeds(feeds).then((eps) => {
      const saved = loadPlayback()
      if (saved && eps.length > 0) {
        const idx = eps.findIndex((ep) => ep.id === saved.episodeId)
        if (idx >= 0) {
          setCurrentIndex(idx)
          setTimeout(() => {
            const audio = audioRef.current
            if (audio) {
              audio.src = eps[idx].audioUrl
              audio.load()
              audio.currentTime = saved.time || 0
            }
          }, 100)
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const playEpisode = useCallback((index) => {
    setCurrentIndex(index)
    setPlaying(true)
    setCurrentTime(0)
    setDuration(0)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || currentIndex < 0 || !episodes[currentIndex]) return

    audio.src = episodes[currentIndex].audioUrl
    audio.load()
    audio.play().catch(() => {})
  }, [currentIndex, episodes])

  // Playback persistence (save every 5s)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        if (currentIndex >= 0 && episodes[currentIndex]) {
          savePlayback({ episodeId: episodes[currentIndex].id, time: audio.currentTime })
        }
      }, 5000)
    }
    const onDurationChange = () => setDuration(audio.duration)
    const onEnded = () => {
      if (currentIndex < episodes.length - 1) {
        playEpisode(currentIndex + 1)
      } else {
        setPlaying(false)
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [currentIndex, episodes, playEpisode])

  // Media Session API
  useEffect(() => {
    if (currentIndex < 0 || !episodes[currentIndex]) return
    const audio = audioRef.current
    updateMediaSession(episodes[currentIndex], playing, {
      play: () => audio?.play(),
      pause: () => audio?.pause(),
      seekbackward: () => { if (audio) audio.currentTime = Math.max(0, audio.currentTime - 15) },
      seekforward: () => { if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 30) },
      previoustrack: currentIndex > 0 ? () => playEpisode(currentIndex - 1) : null,
      nexttrack: currentIndex < episodes.length - 1 ? () => playEpisode(currentIndex + 1) : null,
    })
  }, [currentIndex, playing, episodes, playEpisode])

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (currentIndex < 0 && episodes.length > 0) { playEpisode(0); return }
    if (playing) audio.pause()
    else audio.play().catch(() => {})
  }

  function seekFromEvent(clientX) {
    const audio = audioRef.current
    const bar = progressRef.current
    if (!audio || !bar || !duration) return
    const rect = bar.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    audio.currentTime = pct * duration
  }

  function skip(sec) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + sec))
  }

  // Feed management
  function removeFeed(index) {
    const next = feeds.filter((_, i) => i !== index)
    setFeeds(next)
    saveFeeds(next)
    fetchAllFeeds(next)
  }

  function addFeedByUrl() {
    if (!newFeedUrl.trim()) return
    const short = newFeedUrl.split('/').pop()?.slice(0, 4).toUpperCase() || 'NEW'
    const newFeed = { name: 'Custom Feed', short, rssUrl: newFeedUrl.trim(), color: '#555' }
    const next = [...feeds, newFeed]
    setFeeds(next)
    saveFeeds(next)
    setNewFeedUrl('')
    fetchAllFeeds(next)
  }

  async function searchPodcasts() {
    if (!searchQuery.trim()) return
    try {
      const res = await fetch(`https://itunes.apple.com/search?media=podcast&limit=8&term=${encodeURIComponent(searchQuery)}`)
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch { setSearchResults([]) }
  }

  function addFromSearch(result) {
    if (!result.feedUrl) return
    if (feeds.some((f) => f.rssUrl === result.feedUrl)) return
    const short = (result.collectionName || '').slice(0, 3).toUpperCase() || 'POD'
    const newFeed = { name: result.collectionName, short, rssUrl: result.feedUrl, color: '#555' }
    const next = [...feeds, newFeed]
    setFeeds(next)
    saveFeeds(next)
    setSearchResults((prev) => prev.filter((r) => r.collectionId !== result.collectionId))
    fetchAllFeeds(next)
  }

  const current = currentIndex >= 0 ? episodes[currentIndex] : null
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  if (showSettings) {
    return (
      <div className="app">
        <header>
          <h1>Manage Feeds</h1>
          <button className="ctrl-btn" onClick={() => setShowSettings(false)}>← Back</button>
        </header>

        <section style={{ marginBottom: 24 }}>
          <p className="section-label">YOUR FEEDS</p>
          {feeds.map((f, i) => (
            <div key={i} className="episode-row">
              <div className="badge" style={{ background: f.color }}>{f.short}</div>
              <div className="episode-info">
                <div className="episode-title">{f.name}</div>
                <div className="episode-meta">{f.rssUrl}</div>
              </div>
              <button className="ctrl-btn" onClick={() => removeFeed(i)}>✕</button>
            </div>
          ))}
        </section>

        <section style={{ marginBottom: 24 }}>
          <p className="section-label">ADD BY URL</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="url"
              placeholder="Paste RSS feed URL"
              value={newFeedUrl}
              onChange={(e) => setNewFeedUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFeedByUrl()}
              style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #333', background: '#161616', color: '#fff', fontSize: 14 }}
            />
            <button className="ctrl-btn" onClick={addFeedByUrl}>Add</button>
          </div>
        </section>

        <section>
          <p className="section-label">SEARCH PODCASTS</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchPodcasts()}
              style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #333', background: '#161616', color: '#fff', fontSize: 14 }}
            />
            <button className="ctrl-btn" onClick={searchPodcasts}>Search</button>
          </div>
          {searchResults.map((r) => (
            <div key={r.collectionId} className="episode-row">
              {r.artworkUrl60 && <img src={r.artworkUrl60} alt="" style={{ width: 44, height: 44, borderRadius: 10 }} />}
              <div className="episode-info">
                <div className="episode-title">{r.collectionName}</div>
                <div className="episode-meta">{r.artistName}</div>
              </div>
              <button className="ctrl-btn" onClick={() => addFromSearch(r)}>+ Add</button>
            </div>
          ))}
        </section>
      </div>
    )
  }

  return (
    <div className="app">
      <audio ref={audioRef} preload="metadata" />

      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Daily Drive</h1>
          <button className="ctrl-btn" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
        <p className="date">{dateStr}</p>
      </header>

      {loading && <div className="status">Loading episodes...</div>}
      {error && <div className="status error">{error}</div>}

      {current && (
        <section className="now-playing">
          <p className="section-label">NOW PLAYING</p>
          <div className="episode-row current">
            <div className="badge" style={{ background: current.feedColor }}>{current.feedShort}</div>
            <div className="episode-info">
              <div className="episode-title">{current.title}</div>
              <div className="episode-meta">{current.feedName}</div>
            </div>
          </div>

          <div
            className="progress-bar"
            ref={progressRef}
            onClick={(e) => seekFromEvent(e.clientX)}
            onTouchStart={(e) => seekFromEvent(e.touches[0].clientX)}
            onTouchMove={(e) => seekFromEvent(e.touches[0].clientX)}
          >
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="time-row">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="controls">
            <button className="ctrl-btn" onClick={() => skip(-15)}>-15s</button>
            <button className="play-btn" onClick={togglePlay}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button className="ctrl-btn" onClick={() => skip(30)}>+30s</button>
          </div>
        </section>
      )}

      {!current && !loading && episodes.length > 0 && (
        <section className="now-playing">
          <button className="play-btn start-btn" onClick={() => playEpisode(0)}>
            ▶ Start Listening
          </button>
        </section>
      )}

      {episodes.length > 0 && (
        <section className="queue">
          <p className="section-label">{current ? 'UP NEXT' : 'TODAY\'S EPISODES'}</p>
          {episodes.map((ep, i) => (
            i === currentIndex ? null : (
              <div key={ep.id} className="episode-row" onClick={() => playEpisode(i)}>
                <div className="badge" style={{ background: ep.feedColor }}>{ep.feedShort}</div>
                <div className="episode-info">
                  <div className="episode-title">{ep.title}</div>
                  <div className="episode-meta">
                    {ep.feedName}
                    {ep.durationSec > 0 && ` · ${Math.round(ep.durationSec / 60)} min`}
                  </div>
                </div>
              </div>
            )
          ))}
        </section>
      )}
    </div>
  )
}
