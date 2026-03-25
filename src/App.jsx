import React, { useState, useEffect, useRef, useCallback } from 'react'

const DEFAULT_FEEDS = [
  { name: 'The Daily', short: 'TD', rssUrl: 'https://feeds.simplecast.com/54nAGcIl', color: '#6B4EFF', category: 'News' },
  { name: 'Up First', short: 'NPR', rssUrl: 'https://feeds.npr.org/510318/podcast.xml', color: '#7C3AED', category: 'News' },
]

const CATEGORIES = ['All', 'News', 'Tech', 'Storytelling', 'Documentary', 'Other']
const NEWS_CATEGORIES = ['News', 'Current Events', 'Politics', 'Daily News']

const isDev = import.meta.env.DEV

function getFeedFetchUrl(rssUrl) {
  if (isDev) {
    try {
      const u = new URL(rssUrl)
      if (u.hostname.includes('simplecast')) return '/feed/simplecast' + u.pathname
      if (u.hostname.includes('npr.org')) return '/feed/npr' + u.pathname
    } catch {}
    return '/.netlify/functions/feed?url=' + encodeURIComponent(rssUrl)
  }
  return '/.netlify/functions/feed?url=' + encodeURIComponent(rssUrl)
}

function detectCategory(genres) {
  if (!genres || !genres.length) return 'Other'
  const g = genres.map((x) => (typeof x === 'string' ? x : x.name || '')).join(' ').toLowerCase()
  if (/news|politics|current events|daily/.test(g)) return 'News'
  if (/tech|science|computer/.test(g)) return 'Tech'
  if (/story|fiction|drama|comedy/.test(g)) return 'Storytelling'
  if (/documentary|history|true crime|investigat/.test(g)) return 'Documentary'
  return 'Other'
}

// --- localStorage helpers ---
function loadFeeds() {
  try {
    const stored = JSON.parse(localStorage.getItem('dd-feeds'))
    if (Array.isArray(stored) && stored.length > 0) {
      // Migrate feeds missing category/color from old format
      return stored.map((f) => ({
        ...f,
        category: f.category || 'Other',
        color: f.color === '#1a8917' || f.color === '#db2128' || f.color === '#555' ? '#6B4EFF' : (f.color || '#6B4EFF'),
      }))
    }
  } catch {}
  return DEFAULT_FEEDS
}
function saveFeeds(feeds) { localStorage.setItem('dd-feeds', JSON.stringify(feeds)) }
function loadPlayback() { try { return JSON.parse(localStorage.getItem('dd-playback')) } catch { return null } }
function savePlayback(data) { localStorage.setItem('dd-playback', JSON.stringify(data)) }
function loadPositions() { try { return JSON.parse(localStorage.getItem('dd-positions')) || {} } catch { return {} } }
function savePosition(id, time) { const p = loadPositions(); p[id] = time; localStorage.setItem('dd-positions', JSON.stringify(p)) }
function getPosition(id) { return loadPositions()[id] || 0 }
function loadCachedEpisodes() {
  try {
    const c = JSON.parse(localStorage.getItem('dd-episodes'))
    if (Array.isArray(c) && c.length > 0) return c.map((ep) => ({ ...ep, pubDate: new Date(ep.pubDate) }))
  } catch {}
  return null
}
function cacheEpisodes(eps) { localStorage.setItem('dd-episodes', JSON.stringify(eps)) }

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
  const channelImg = doc.querySelector('channel > image > url')?.textContent
    || doc.querySelector('channel > *|image')?.getAttribute('href')
    || ''
  const episodes = []

  for (let i = 0; i < Math.min(items.length, 5); i++) {
    const item = items[i]
    const title = item.querySelector('title')?.textContent || 'Untitled'
    const enclosure = item.querySelector('enclosure')
    const audioUrl = enclosure?.getAttribute('url')
    if (!audioUrl) continue

    const pubDate = item.querySelector('pubDate')?.textContent
    const duration = item.querySelector('duration')?.textContent
    const itemImg = item.querySelector('*|image')?.getAttribute('href')

    let durationSec = 0
    if (duration) {
      const parts = duration.split(':').map(Number)
      if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2]
      else if (parts.length === 2) durationSec = parts[0] * 60 + parts[1]
      else durationSec = parts[0]
    }

    episodes.push({
      id: `${feed.short}-${i}`,
      title, audioUrl, durationSec,
      pubDate: pubDate ? new Date(pubDate) : new Date(),
      artwork: itemImg || channelImg || feed.artwork || '',
      feedName: feed.name,
      feedShort: feed.short,
      feedColor: feed.color,
      category: feed.category || 'Other',
    })
  }
  return episodes
}

function isRecent(pubDate, category) {
  const now = Date.now()
  const hours = NEWS_CATEGORIES.includes(category) ? 36 : 168 // 36h for news, 7 days for others
  return (now - pubDate.getTime()) < hours * 3600 * 1000
}

function updateMediaSession(episode, playing, handlers) {
  if (!('mediaSession' in navigator)) return
  const meta = { title: episode.title, artist: episode.feedName }
  if (episode.artwork) meta.artwork = [{ src: episode.artwork, sizes: '512x512', type: 'image/jpeg' }]
  navigator.mediaSession.metadata = new MediaMetadata(meta)
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  for (const [action, handler] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, handler) } catch {}
  }
}

export default function App() {
  const [feeds, setFeeds] = useState(loadFeeds)
  const [episodes, setEpisodes] = useState(() => loadCachedEpisodes() || [])
  const [loading, setLoading] = useState(() => !loadCachedEpisodes())
  const [error, setError] = useState(null)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [tab, setTab] = useState('library')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [newFeedUrl, setNewFeedUrl] = useState('')
  const audioRef = useRef(null)
  const progressRef = useRef(null)
  const saveTimerRef = useRef(null)

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
      const allEpisodes = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
      allEpisodes.sort((a, b) => b.pubDate - a.pubDate)
      const finalEps = allEpisodes.filter((ep) => isRecent(ep.pubDate, ep.category))
      const result = finalEps.length > 0 ? finalEps : allEpisodes.slice(0, 8)
      setEpisodes(result)
      cacheEpisodes(result)
      if (results.every((r) => r.status === 'rejected')) setError('Could not load any feeds.')
      return result
    } catch (e) { setError(e.message); return [] }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const saved = loadPlayback()
    const cached = loadCachedEpisodes()
    if (saved && cached?.length > 0) {
      const idx = cached.findIndex((ep) => ep.id === saved.episodeId)
      if (idx >= 0) {
        setCurrentIndex(idx)
        setTimeout(() => {
          const audio = audioRef.current
          if (audio) { audio.src = cached[idx].audioUrl; audio.load(); audio.currentTime = saved.time || 0 }
        }, 100)
      }
    }
    fetchAllFeeds(feeds)
  }, []) // eslint-disable-line

  const playEpisode = useCallback((index) => {
    setCurrentIndex(index); setPlaying(true); setCurrentTime(0); setDuration(0)
    setTab('playing')
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || currentIndex < 0 || !episodes[currentIndex]) return
    const ep = episodes[currentIndex]
    audio.src = ep.audioUrl; audio.load()
    const savedPos = getPosition(ep.id)
    if (savedPos > 0) audio.currentTime = savedPos
    audio.play().catch(() => {})
  }, [currentIndex, episodes])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        if (currentIndex >= 0 && episodes[currentIndex]) {
          const ep = episodes[currentIndex]
          savePlayback({ episodeId: ep.id, time: audio.currentTime })
          savePosition(ep.id, audio.currentTime)
        }
      }, 5000)
    }
    const onDuration = () => setDuration(audio.duration)
    const onEnded = () => { if (currentIndex < episodes.length - 1) playEpisode(currentIndex + 1); else setPlaying(false) }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDuration)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    return () => { audio.removeEventListener('timeupdate', onTimeUpdate); audio.removeEventListener('durationchange', onDuration); audio.removeEventListener('ended', onEnded); audio.removeEventListener('play', onPlay); audio.removeEventListener('pause', onPause) }
  }, [currentIndex, episodes, playEpisode])

  useEffect(() => {
    if (currentIndex < 0 || !episodes[currentIndex]) return
    const audio = audioRef.current
    updateMediaSession(episodes[currentIndex], playing, {
      play: () => audio?.play(), pause: () => audio?.pause(),
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
    if (playing) audio.pause(); else audio.play().catch(() => {})
  }

  function seekFromEvent(clientX) {
    const audio = audioRef.current; const bar = progressRef.current
    if (!audio || !bar || !duration) return
    const rect = bar.getBoundingClientRect()
    audio.currentTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration
  }

  function skip(sec) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + sec))
  }

  function removeFeed(index) {
    const next = feeds.filter((_, i) => i !== index); setFeeds(next); saveFeeds(next); fetchAllFeeds(next)
  }

  function addFeedByUrl() {
    if (!newFeedUrl.trim()) return
    const short = newFeedUrl.split('/').pop()?.slice(0, 4).toUpperCase() || 'NEW'
    const newFeed = { name: 'Custom Feed', short, rssUrl: newFeedUrl.trim(), color: '#6B4EFF', category: 'Other' }
    const next = [...feeds, newFeed]; setFeeds(next); saveFeeds(next); setNewFeedUrl(''); fetchAllFeeds(next)
  }

  async function searchPodcasts() {
    if (!searchQuery.trim()) return
    try {
      const res = await fetch(`https://itunes.apple.com/search?media=podcast&limit=10&term=${encodeURIComponent(searchQuery)}`)
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch { setSearchResults([]) }
  }

  function addFromSearch(result) {
    if (!result.feedUrl || feeds.some((f) => f.rssUrl === result.feedUrl)) return
    const short = (result.collectionName || '').slice(0, 3).toUpperCase() || 'POD'
    const cat = detectCategory(result.genres || [result.primaryGenreName])
    const newFeed = { name: result.collectionName, short, rssUrl: result.feedUrl, color: '#6B4EFF', category: cat, artwork: result.artworkUrl100 }
    const next = [...feeds, newFeed]; setFeeds(next); saveFeeds(next)
    setSearchResults((prev) => prev.filter((r) => r.collectionId !== result.collectionId))
    fetchAllFeeds(next)
  }

  function updateFeedCategory(index, cat) {
    const next = [...feeds]; next[index] = { ...next[index], category: cat }; setFeeds(next); saveFeeds(next)
  }

  const current = currentIndex >= 0 ? episodes[currentIndex] : null
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  const filteredEpisodes = categoryFilter === 'All' ? episodes : episodes.filter((ep) => ep.category === categoryFilter)
  const groupedByFeed = {}
  filteredEpisodes.forEach((ep, i) => {
    const origIdx = episodes.indexOf(ep)
    if (!groupedByFeed[ep.feedName]) groupedByFeed[ep.feedName] = []
    groupedByFeed[ep.feedName].push({ ...ep, origIdx })
  })

  const upNext = episodes.filter((_, i) => i !== currentIndex && i > currentIndex).slice(0, 5)

  return (
    <div className="app">
      <audio ref={audioRef} preload="metadata" />

      {/* Mini player bar when not on Now Playing tab */}
      {current && tab !== 'playing' && (
        <div className="mini-player" onClick={() => setTab('playing')}>
          {current.artwork && <img src={current.artwork} alt="" className="mini-art" />}
          {!current.artwork && <div className="mini-badge" style={{ background: current.feedColor }}>{current.feedShort}</div>}
          <div className="mini-info">
            <div className="mini-title">{current.title}</div>
            <div className="mini-meta">{current.feedName}</div>
          </div>
          <button className="mini-play" onClick={(e) => { e.stopPropagation(); togglePlay() }}>
            {playing ? '❚❚' : '▶'}
          </button>
        </div>
      )}

      {/* === LIBRARY TAB === */}
      {tab === 'library' && (
        <div className="tab-content">
          <header>
            <h1>Library</h1>
            <p className="date">{dateStr}</p>
          </header>

          <div className="cat-pills">
            {CATEGORIES.filter((c) => c === 'All' || feeds.some((f) => f.category === c) || episodes.some((ep) => ep.category === c)).map((c) => (
              <button key={c} className={`pill ${categoryFilter === c ? 'active' : ''}`} onClick={() => setCategoryFilter(c)}>{c}</button>
            ))}
          </div>

          {loading && !episodes.length && <div className="status">Loading episodes...</div>}
          {error && <div className="status error">{error}</div>}

          {Object.entries(groupedByFeed).map(([feedName, eps]) => (
            <section key={feedName} className="feed-group">
              <div className="feed-header">
                {eps[0].artwork && <img src={eps[0].artwork} alt="" className="feed-art" />}
                {!eps[0].artwork && <div className="badge" style={{ background: eps[0].feedColor }}>{eps[0].feedShort}</div>}
                <div>
                  <div className="feed-name">{feedName}</div>
                  <div className="feed-cat">{eps[0].category}</div>
                </div>
              </div>
              {eps.map((ep) => {
                const now = Date.now()
                const isNew = (now - ep.pubDate.getTime()) < 36 * 3600 * 1000
                return (
                  <div key={ep.id} className="ep-row" onClick={() => playEpisode(ep.origIdx)}>
                    <div className="ep-info">
                      <div className="ep-title">
                        {ep.title}
                        {isNew && <span className="new-badge">NEW</span>}
                      </div>
                      <div className="ep-meta">{Math.round(ep.durationSec / 60)} min</div>
                    </div>
                    <button className="ep-play" onClick={(e) => { e.stopPropagation(); playEpisode(ep.origIdx) }}>▶</button>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      )}

      {/* === NOW PLAYING TAB === */}
      {tab === 'playing' && (
        <div className="tab-content playing-tab">
          {current ? (
            <>
              <div className="art-large-wrap">
                {current.artwork
                  ? <img src={current.artwork} alt="" className="art-large" />
                  : <div className="art-large art-fallback" style={{ background: current.feedColor }}>{current.feedShort}</div>
                }
              </div>

              <div className="playing-info">
                <div className="playing-title">{current.title}</div>
                <div className="playing-meta">{current.feedName}</div>
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
                <button className="play-btn" onClick={togglePlay}>{playing ? '❚❚' : '▶'}</button>
                <button className="ctrl-btn" onClick={() => skip(30)}>+30s</button>
              </div>

              {upNext.length > 0 && (
                <section className="queue">
                  <p className="section-label">UP NEXT</p>
                  {upNext.map((ep) => {
                    const idx = episodes.indexOf(ep)
                    return (
                      <div key={ep.id} className="ep-row" onClick={() => playEpisode(idx)}>
                        {ep.artwork && <img src={ep.artwork} alt="" className="queue-art" />}
                        {!ep.artwork && <div className="queue-badge" style={{ background: ep.feedColor }}>{ep.feedShort}</div>}
                        <div className="ep-info">
                          <div className="ep-title">{ep.title}</div>
                          <div className="ep-meta">{ep.feedName} · {Math.round(ep.durationSec / 60)} min</div>
                        </div>
                      </div>
                    )
                  })}
                </section>
              )}
            </>
          ) : (
            <div className="status">Tap an episode to start listening</div>
          )}
        </div>
      )}

      {/* === SEARCH TAB === */}
      {tab === 'search' && (
        <div className="tab-content">
          <header><h1>Search</h1></header>

          <div className="search-box">
            <input
              type="text"
              placeholder="Search podcasts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchPodcasts()}
              className="search-input"
            />
            <button className="search-btn" onClick={searchPodcasts}>Search</button>
          </div>

          <div className="search-box" style={{ marginTop: 12 }}>
            <input
              type="url"
              placeholder="Or paste RSS feed URL..."
              value={newFeedUrl}
              onChange={(e) => setNewFeedUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFeedByUrl()}
              className="search-input"
            />
            <button className="search-btn" onClick={addFeedByUrl}>Add</button>
          </div>

          {searchResults.length > 0 && (
            <section style={{ marginTop: 20 }}>
              <p className="section-label">RESULTS</p>
              {searchResults.map((r) => {
                const added = feeds.some((f) => f.rssUrl === r.feedUrl)
                return (
                  <div key={r.collectionId} className={`search-result ${added ? 'added' : ''}`}>
                    {r.artworkUrl100 && <img src={r.artworkUrl100} alt="" className="search-art" />}
                    <div className="ep-info">
                      <div className="ep-title">{r.collectionName}</div>
                      <div className="ep-meta">{r.artistName}</div>
                      <div className="search-genre">{r.primaryGenreName}</div>
                    </div>
                    {added
                      ? <span className="added-label">Added</span>
                      : <button className="add-btn" onClick={() => addFromSearch(r)}>+ Add</button>
                    }
                  </div>
                )
              })}
            </section>
          )}

          {feeds.length > 0 && (
            <section style={{ marginTop: 24 }}>
              <p className="section-label">YOUR FEEDS</p>
              {feeds.map((f, i) => (
                <div key={i} className="feed-manage-row">
                  {f.artwork && <img src={f.artwork} alt="" className="queue-art" />}
                  {!f.artwork && <div className="queue-badge" style={{ background: f.color }}>{f.short}</div>}
                  <div className="ep-info">
                    <div className="ep-title">{f.name}</div>
                    <select
                      className="cat-select"
                      value={f.category || 'Other'}
                      onChange={(e) => updateFeedCategory(i, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {CATEGORIES.filter((c) => c !== 'All').map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <button className="remove-btn" onClick={() => removeFeed(i)}>✕</button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* === TAB BAR === */}
      <nav className="tab-bar">
        <button className={`tab ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}>
          <span className="tab-icon">☰</span>Library
        </button>
        <button className={`tab ${tab === 'playing' ? 'active' : ''}`} onClick={() => setTab('playing')}>
          <span className="tab-icon">▶</span>Now Playing
        </button>
        <button className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
          <span className="tab-icon">⌕</span>Search
        </button>
      </nav>
    </div>
  )
}
