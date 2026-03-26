import React, { useState, useEffect, useRef, useCallback } from 'react'

const DEFAULT_FEEDS = [
  { name: 'The Daily', short: 'TD', rssUrl: 'https://feeds.simplecast.com/54nAGcIl', color: '#6B4EFF', category: 'News' },
  { name: 'Up First', short: 'NPR', rssUrl: 'https://feeds.npr.org/510318/podcast.xml', color: '#7C3AED', category: 'News' },
]

const CATEGORIES = ['All', 'News', 'Tech', 'Storytelling', 'Documentary', 'Other']
const NEWS_CATEGORIES = ['News', 'Current Events', 'Politics', 'Daily News']
const isDev = import.meta.env.DEV

const RECOMMENDED = [
  { name: 'Darknet Diaries', artist: 'Jack Rhysider', genre: 'Technology', id: 1296350194 },
  { name: 'Radiolab', artist: 'WNYC Studios', genre: 'Science', id: 152249110 },
  { name: 'Serial', artist: 'Serial Productions', genre: 'True Crime', id: 917918570 },
  { name: 'How I Built This', artist: 'Guy Raz / NPR', genre: 'Business', id: 1150510297 },
  { name: 'Planet Money', artist: 'NPR', genre: 'Business', id: 290783428 },
  { name: '99% Invisible', artist: 'Roman Mars', genre: 'Design', id: 394775318 },
]

function getFeedFetchUrl(rssUrl) {
  if (isDev) {
    try {
      const u = new URL(rssUrl)
      if (u.hostname.includes('simplecast')) return '/feed/simplecast' + u.pathname
      if (u.hostname.includes('npr.org')) return '/feed/npr' + u.pathname
    } catch {}
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

function loadFeeds() {
  try {
    const stored = JSON.parse(localStorage.getItem('dd-feeds'))
    if (Array.isArray(stored) && stored.length > 0) return stored.map((f) => ({ ...f, category: f.category || 'Other', color: f.color || '#6B4EFF' }))
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
  try { const c = JSON.parse(localStorage.getItem('dd-episodes')); if (Array.isArray(c) && c.length > 0) return c.map((ep) => ({ ...ep, pubDate: new Date(ep.pubDate) })) } catch {}
  return null
}
function cacheEpisodes(eps) { localStorage.setItem('dd-episodes', JSON.stringify(eps)) }
function loadSearchHistory() { try { return JSON.parse(localStorage.getItem('dd-search-history')) || [] } catch { return [] } }
function saveSearchHistory(h) { localStorage.setItem('dd-search-history', JSON.stringify(h.slice(0, 10))) }

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00'
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
function formatDate(d) {
  const now = new Date(); const diff = now - d
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 172800000) return 'Yesterday'
  if (diff < 604800000) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function stripHtml(html) { if (!html) return ''; const t = document.createElement('div'); t.innerHTML = html; return t.textContent || '' }
function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}


function parseFeed(xml, feed, maxItems = 50) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')
  const items = doc.querySelectorAll('item')
  const channel = doc.querySelector('channel')
  const channelImg = channel?.querySelector('image > url')?.textContent || channel?.querySelector('*|image')?.getAttribute('href') || ''
  const channelDesc = channel?.querySelector('description')?.textContent || ''
  const episodes = []
  for (let i = 0; i < Math.min(items.length, maxItems); i++) {
    const item = items[i]
    const title = item.querySelector('title')?.textContent || 'Untitled'
    const enclosure = item.querySelector('enclosure')
    const audioUrl = enclosure?.getAttribute('url')
    if (!audioUrl) continue
    const pubDate = item.querySelector('pubDate')?.textContent
    const duration = item.querySelector('duration')?.textContent
    const itemImg = item.querySelector('*|image')?.getAttribute('href')
    const desc = stripHtml(item.querySelector('description')?.textContent || item.querySelector('*|summary')?.textContent || '').slice(0, 300)
    let durationSec = 0
    if (duration) { const p = duration.split(':').map(Number); if (p.length === 3) durationSec = p[0]*3600+p[1]*60+p[2]; else if (p.length === 2) durationSec = p[0]*60+p[1]; else durationSec = p[0] }
    episodes.push({ id: `${feed.short}-${i}`, title, audioUrl, durationSec, desc, pubDate: pubDate ? new Date(pubDate) : new Date(), artwork: itemImg || channelImg || feed.artwork || '', feedName: feed.name, feedShort: feed.short, feedColor: feed.color, category: feed.category || 'Other' })
  }
  return { episodes, channelImg, channelDesc, totalCount: items.length }
}

function isRecent(pubDate, category) {
  const hours = NEWS_CATEGORIES.includes(category) ? 36 : 168
  return (Date.now() - pubDate.getTime()) < hours * 3600 * 1000
}

function updateMediaSession(episode, playing, handlers) {
  if (!('mediaSession' in navigator)) return
  const meta = { title: episode.title, artist: episode.feedName }
  if (episode.artwork) meta.artwork = [{ src: episode.artwork, sizes: '512x512', type: 'image/jpeg' }]
  navigator.mediaSession.metadata = new MediaMetadata(meta)
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  for (const [action, handler] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action, handler) } catch {} }
}

// Rain/white noise generator
function createRainNoise(audioCtx) {
  const bufferSize = audioCtx.sampleRate * 2
  const buffer = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1
      b0 = 0.99886*b0 + white*0.0555179; b1 = 0.99332*b1 + white*0.0750759
      b2 = 0.96900*b2 + white*0.1538520; b3 = 0.86650*b3 + white*0.3104856
      b4 = 0.55000*b4 + white*0.5329522; b5 = -0.7616*b5 - white*0.0168980
      data[i] = (b0+b1+b2+b3+b4+b5+b6+white*0.5362) * 0.11
      b6 = white * 0.115926
    }
  }
  return buffer
}

export default function App() {
  const [feeds, setFeeds] = useState(loadFeeds)
  const [episodes, setEpisodes] = useState(() => loadCachedEpisodes() || [])
  const [allEpisodesByFeed, setAllEpisodesByFeed] = useState({})
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
  const [searchHistory, setSearchHistory] = useState(loadSearchHistory)
  const [detailFeed, setDetailFeed] = useState(null)
  const [detailEpisodes, setDetailEpisodes] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailMeta, setDetailMeta] = useState(null)
  const [previewPodcast, setPreviewPodcast] = useState(null)
  const [previewEpisodes, setPreviewEpisodes] = useState([])
  const [previewLoading, setPreviewLoading] = useState(false)
  // Rain/sleep
  const [rainPlaying, setRainPlaying] = useState(false)
  const [rainVolume, setRainVolume] = useState(0.5)
  const [sleepTimer, setSleepTimer] = useState(0) // minutes, 0 = continuous
  const [sleepRemaining, setSleepRemaining] = useState(0)
  const [showSleep, setShowSleep] = useState(false)
  const rainCtxRef = useRef(null)
  const rainSourceRef = useRef(null)
  const rainGainRef = useRef(null)
  const sleepIntervalRef = useRef(null)

  const audioRef = useRef(null)
  const progressRef = useRef(null)
  const saveTimerRef = useRef(null)

  // Auto-refresh at 6am Chicago time
  useEffect(() => {
    function scheduleRefresh() {
      const now = new Date()
      const chicago = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
      const next6am = new Date(chicago)
      next6am.setHours(6, 0, 0, 0)
      if (chicago >= next6am) next6am.setDate(next6am.getDate() + 1)
      const ms = next6am - chicago
      return setTimeout(() => { fetchAllFeeds(feeds); scheduleRefresh() }, ms)
    }
    const timer = scheduleRefresh()
    return () => clearTimeout(timer)
  }, [feeds]) // eslint-disable-line

  // Rain controls
  function toggleRain() {
    if (rainPlaying) { stopRain(); return }
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const gain = ctx.createGain()
    gain.gain.value = rainVolume
    gain.connect(ctx.destination)
    const buffer = createRainNoise(ctx)
    const source = ctx.createBufferSource()
    source.buffer = buffer; source.loop = true
    source.connect(gain); source.start()
    rainCtxRef.current = ctx; rainSourceRef.current = source; rainGainRef.current = gain
    setRainPlaying(true)
    if (sleepTimer > 0) startSleepTimer(sleepTimer)
  }

  function stopRain() {
    try { rainSourceRef.current?.stop(); rainCtxRef.current?.close() } catch {}
    rainCtxRef.current = null; rainSourceRef.current = null; rainGainRef.current = null
    setRainPlaying(false); setSleepRemaining(0)
    clearInterval(sleepIntervalRef.current)
  }

  function updateRainVolume(v) {
    setRainVolume(v)
    if (rainGainRef.current) rainGainRef.current.gain.value = v
  }

  function startSleepTimer(mins) {
    setSleepRemaining(mins * 60)
    clearInterval(sleepIntervalRef.current)
    sleepIntervalRef.current = setInterval(() => {
      setSleepRemaining((prev) => {
        if (prev <= 1) { stopRain(); const a = audioRef.current; if (a) a.pause(); return 0 }
        // Fade out in last 30 seconds
        if (prev <= 30 && rainGainRef.current) rainGainRef.current.gain.value = rainVolume * (prev / 30)
        return prev - 1
      })
    }, 1000)
  }

  const fetchAllFeeds = useCallback(async (feedList) => {
    setLoading(true); setError(null)
    try {
      const results = await Promise.allSettled(feedList.map(async (feed) => {
        const res = await fetch(getFeedFetchUrl(feed.rssUrl))
        if (!res.ok) throw new Error(`Failed: ${feed.name}`)
        const xml = await res.text()
        return { feed, ...parseFeed(xml, feed, 50) }
      }))
      const byFeed = {}; const recentEps = []
      results.filter((r) => r.status === 'fulfilled').forEach((r) => {
        const { feed, episodes: eps, channelImg, channelDesc, totalCount } = r.value
        byFeed[feed.name] = { episodes: eps, channelImg, channelDesc, totalCount, feed }
        eps.filter((ep) => isRecent(ep.pubDate, ep.category)).forEach((ep) => recentEps.push(ep))
      })
      recentEps.sort((a, b) => b.pubDate - a.pubDate)
      const finalEps = recentEps.length > 0 ? recentEps : Object.values(byFeed).flatMap((b) => b.episodes.slice(0, 3)).sort((a, b) => b.pubDate - a.pubDate)
      setEpisodes(finalEps); setAllEpisodesByFeed(byFeed); cacheEpisodes(finalEps)
      if (results.every((r) => r.status === 'rejected')) setError('Could not load any feeds.')
      return finalEps
    } catch (e) { setError(e.message); return [] }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const saved = loadPlayback(); const cached = loadCachedEpisodes()
    if (saved && cached?.length > 0) {
      const idx = cached.findIndex((ep) => ep.id === saved.episodeId)
      if (idx >= 0) { setCurrentIndex(idx); setTimeout(() => { const a = audioRef.current; if (a) { a.src = cached[idx].audioUrl; a.load(); a.currentTime = saved.time || 0 } }, 100) }
    }
    fetchAllFeeds(feeds)
  }, []) // eslint-disable-line

  const playEpisode = useCallback((index) => { setCurrentIndex(index); setPlaying(true); setCurrentTime(0); setDuration(0); setTab('playing') }, [])

  function playEpisodeDirect(ep) {
    const idx = episodes.findIndex((e) => e.id === ep.id)
    if (idx >= 0) { playEpisode(idx); return }
    const newEps = [ep, ...episodes]; setEpisodes(newEps)
    setCurrentIndex(0); setPlaying(true); setCurrentTime(0); setDuration(0); setTab('playing')
  }

  useEffect(() => {
    const audio = audioRef.current; if (!audio || currentIndex < 0 || !episodes[currentIndex]) return
    const ep = episodes[currentIndex]; audio.src = ep.audioUrl; audio.load()
    const savedPos = getPosition(ep.id); if (savedPos > 0) audio.currentTime = savedPos
    audio.play().catch(() => {})
  }, [currentIndex, episodes])

  useEffect(() => {
    const audio = audioRef.current; if (!audio) return
    const onTime = () => { setCurrentTime(audio.currentTime); clearTimeout(saveTimerRef.current); saveTimerRef.current = setTimeout(() => { if (currentIndex >= 0 && episodes[currentIndex]) { const ep = episodes[currentIndex]; savePlayback({ episodeId: ep.id, time: audio.currentTime }); savePosition(ep.id, audio.currentTime) } }, 5000) }
    const onDur = () => setDuration(audio.duration)
    const onEnd = () => { if (currentIndex < episodes.length - 1) playEpisode(currentIndex + 1); else setPlaying(false) }
    const onPlay = () => setPlaying(true); const onPause = () => setPlaying(false)
    audio.addEventListener('timeupdate', onTime); audio.addEventListener('durationchange', onDur); audio.addEventListener('ended', onEnd); audio.addEventListener('play', onPlay); audio.addEventListener('pause', onPause)
    return () => { audio.removeEventListener('timeupdate', onTime); audio.removeEventListener('durationchange', onDur); audio.removeEventListener('ended', onEnd); audio.removeEventListener('play', onPlay); audio.removeEventListener('pause', onPause) }
  }, [currentIndex, episodes, playEpisode])

  useEffect(() => {
    if (currentIndex < 0 || !episodes[currentIndex]) return; const audio = audioRef.current
    updateMediaSession(episodes[currentIndex], playing, {
      play: () => audio?.play(), pause: () => audio?.pause(),
      seekbackward: () => { if (audio) audio.currentTime = Math.max(0, audio.currentTime - 15) },
      seekforward: () => { if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 30) },
      previoustrack: currentIndex > 0 ? () => playEpisode(currentIndex - 1) : null,
      nexttrack: currentIndex < episodes.length - 1 ? () => playEpisode(currentIndex + 1) : null,
    })
  }, [currentIndex, playing, episodes, playEpisode])

  function togglePlay() { const a = audioRef.current; if (!a) return; if (currentIndex < 0 && episodes.length > 0) { playEpisode(0); return }; if (playing) a.pause(); else a.play().catch(() => {}) }
  function seekFromEvent(clientX) { const a = audioRef.current; const bar = progressRef.current; if (!a || !bar || !duration) return; const rect = bar.getBoundingClientRect(); a.currentTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration }
  function skip(sec) { const a = audioRef.current; if (a) a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + sec)) }

  function removeFeed(index) { const next = feeds.filter((_, i) => i !== index); setFeeds(next); saveFeeds(next); fetchAllFeeds(next) }

  function addFromSearch(result) {
    if (!result.feedUrl || feeds.some((f) => f.rssUrl === result.feedUrl)) return
    const short = (result.collectionName || '').slice(0, 3).toUpperCase() || 'POD'
    const cat = detectCategory(result.genres || [result.primaryGenreName])
    const nf = { name: result.collectionName, short, rssUrl: result.feedUrl, color: '#6B4EFF', category: cat, artwork: result.artworkUrl100 }
    const next = [...feeds, nf]; setFeeds(next); saveFeeds(next); fetchAllFeeds(next)
  }

  async function searchPodcasts(q) {
    const query = q || searchQuery; if (!query.trim()) return
    const hist = [query, ...searchHistory.filter((h) => h !== query)].slice(0, 10)
    setSearchHistory(hist); saveSearchHistory(hist)
    try {
      const res = await fetch(`https://itunes.apple.com/search?media=podcast&limit=12&term=${encodeURIComponent(query)}`)
      const data = await res.json(); setSearchResults(data.results || [])
    } catch { setSearchResults([]) }
  }

  async function openFeedDetail(feedName) {
    const cached = allEpisodesByFeed[feedName]
    if (cached) { setDetailFeed(cached.feed); setDetailEpisodes(cached.episodes); setDetailMeta({ desc: cached.channelDesc, img: cached.channelImg, count: cached.totalCount }); setTab('detail'); return }
    const feed = feeds.find((f) => f.name === feedName); if (!feed) return
    setDetailFeed(feed); setDetailLoading(true); setTab('detail')
    try { const res = await fetch(getFeedFetchUrl(feed.rssUrl)); const xml = await res.text(); const { episodes: eps, channelImg, channelDesc, totalCount } = parseFeed(xml, feed, 100); setDetailEpisodes(eps); setDetailMeta({ desc: channelDesc, img: channelImg, count: totalCount }) }
    catch { setDetailEpisodes([]) } finally { setDetailLoading(false) }
  }

  async function openPreview(result) {
    if (!result.feedUrl) return
    setPreviewPodcast(result); setPreviewLoading(true); setPreviewEpisodes([]); setTab('preview')
    try { const res = await fetch(getFeedFetchUrl(result.feedUrl)); const xml = await res.text(); const short = (result.collectionName || '').slice(0, 3).toUpperCase(); const ff = { name: result.collectionName, short, rssUrl: result.feedUrl, color: '#6B4EFF', category: detectCategory(result.genres || [result.primaryGenreName]), artwork: result.artworkUrl100 }; const { episodes: eps } = parseFeed(xml, ff, 50); setPreviewEpisodes(eps) }
    catch { setPreviewEpisodes([]) } finally { setPreviewLoading(false) }
  }

  async function addRecommended(rec) {
    try {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${rec.id}&entity=podcast`)
      const data = await res.json()
      if (data.results?.[0]) addFromSearch(data.results[0])
    } catch {}
  }

  function buildCommuteMix(targetMin = 30) {
    const target = targetMin * 60
    const positions = loadPositions()
    const pool = [...episodes].filter((ep) => ep.durationSec > 0)
    const news = pool.filter((ep) => NEWS_CATEGORIES.includes(ep.category))
    const other = pool.filter((ep) => !NEWS_CATEGORIES.includes(ep.category))
    const mix = []; let total = 0
    const remaining = (ep) => { const pos = positions[ep.id] || 0; return Math.max(ep.durationSec - pos, 60) }
    // 1. Add latest news from each feed
    const newsByFeed = {}
    news.forEach((ep) => { if (!newsByFeed[ep.feedName]) newsByFeed[ep.feedName] = ep })
    for (const ep of Object.values(newsByFeed)) {
      mix.push(ep); total += remaining(ep)
    }
    // 2. If under target, fill with other episodes (alternate feeds)
    if (total < target) {
      const otherByFeed = {}
      other.forEach((ep) => { if (!otherByFeed[ep.feedName]) otherByFeed[ep.feedName] = []; otherByFeed[ep.feedName].push(ep) })
      const feedQueues = Object.values(otherByFeed)
      let qi = 0; let passes = 0
      while (total < target && passes < pool.length && feedQueues.length > 0) {
        passes++
        const q = feedQueues[qi % feedQueues.length]
        const ep = q.shift()
        if (!ep) { feedQueues.splice(qi % feedQueues.length, 1); continue }
        if (mix.some((m) => m.id === ep.id)) { qi++; continue }
        mix.push(ep); total += remaining(ep); qi++
      }
    }
    // 3. If still under, add more news episodes
    for (const ep of news) {
      if (total >= target) break
      if (mix.some((m) => m.id === ep.id)) continue
      mix.push(ep); total += remaining(ep)
    }
    return { mix, totalMin: Math.round(total / 60) }
  }

  function playCommuteMix() {
    const { mix } = buildCommuteMix(30)
    if (mix.length === 0) return
    setEpisodes(mix)
    setCurrentIndex(0); setPlaying(true); setCurrentTime(0); setDuration(0); setTab('playing')
  }

  const current = currentIndex >= 0 ? episodes[currentIndex] : null
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const filteredEpisodes = categoryFilter === 'All' ? episodes : episodes.filter((ep) => ep.category === categoryFilter)
  const upNext = episodes.filter((_, i) => i !== currentIndex && i > currentIndex).slice(0, 5)
  const recsToShow = RECOMMENDED.filter((r) => !feeds.some((f) => f.name === r.name))
  const commuteMix = buildCommuteMix(30)

  return (
    <div className="app">
      <audio ref={audioRef} preload="metadata" />

      {current && tab !== 'playing' && (
        <div className="mini-player" onClick={() => setTab('playing')}>
          {current.artwork ? <img src={current.artwork} alt="" className="mini-art" /> : <div className="mini-badge" style={{ background: current.feedColor }}>{current.feedShort}</div>}
          <div className="mini-info"><div className="mini-title">{current.title}</div><div className="mini-meta">{current.feedName}</div></div>
          <button className="mini-play" onClick={(e) => { e.stopPropagation(); togglePlay() }}>{playing ? '❚❚' : '▶'}</button>
        </div>
      )}

      {/* === LIBRARY (Spotify-style home) === */}
      {tab === 'library' && (
        <div className="tab-content">
          <header className="home-header">
            <h1>{getGreeting()}</h1>
            <div className="header-actions">
              <button className={`rain-toggle ${rainPlaying ? 'active' : ''}`} onClick={() => setShowSleep(!showSleep)}>🌧</button>
            </div>
          </header>

          {/* Sleep / Rain panel */}
          {showSleep && (
            <div className="sleep-panel">
              <div className="sleep-row">
                <span className="sleep-label">Rain Sounds</span>
                <button className={`rain-btn ${rainPlaying ? 'active' : ''}`} onClick={toggleRain}>{rainPlaying ? 'Stop' : 'Play'}</button>
              </div>
              <div className="sleep-row">
                <span className="sleep-label">Volume</span>
                <input type="range" min="0" max="1" step="0.05" value={rainVolume} onChange={(e) => updateRainVolume(+e.target.value)} className="vol-slider" />
              </div>
              <div className="sleep-row">
                <span className="sleep-label">Sleep Timer</span>
                <div className="timer-pills">
                  {[0, 15, 30, 45, 60, 90].map((m) => (
                    <button key={m} className={`timer-pill ${sleepTimer === m ? 'active' : ''}`} onClick={() => { setSleepTimer(m); if (rainPlaying && m > 0) startSleepTimer(m); if (m === 0) { setSleepRemaining(0); clearInterval(sleepIntervalRef.current) } }}>
                      {m === 0 ? '∞' : `${m}m`}
                    </button>
                  ))}
                </div>
              </div>
              {sleepRemaining > 0 && <div className="sleep-remaining">Stopping in {Math.floor(sleepRemaining/60)}:{(sleepRemaining%60).toString().padStart(2,'0')}</div>}
            </div>
          )}

          {/* Commute Mix */}
          {commuteMix.mix.length > 0 && (
            <div className="commute-card" onClick={playCommuteMix}>
              <div className="commute-left">
                <div className="commute-icon">🚗</div>
                <div className="commute-info">
                  <div className="commute-title">Morning Commute</div>
                  <div className="commute-meta">{commuteMix.mix.length} episodes · ~{commuteMix.totalMin} min</div>
                  <div className="commute-feeds">{[...new Set(commuteMix.mix.map((e) => e.feedName))].join(' · ')}</div>
                </div>
              </div>
              <span className="commute-play">▶</span>
            </div>
          )}

          {/* Category pills */}
          <div className="cat-pills">
            {CATEGORIES.filter((c) => c === 'All' || feeds.some((f) => f.category === c)).map((c) => (
              <button key={c} className={`pill ${categoryFilter === c ? 'active' : ''}`} onClick={() => setCategoryFilter(c)}>{c}</button>
            ))}
          </div>

          {loading && !episodes.length && <div className="status">Loading episodes...</div>}
          {error && <div className="status error">{error}</div>}

          {/* Podcast grid (Spotify-style) */}
          <div className="podcast-grid">
            {feeds.filter((f) => categoryFilter === 'All' || f.category === categoryFilter).map((f) => {
              const meta = allEpisodesByFeed[f.name]
              const latestEp = meta?.episodes?.[0]
              const hasNew = latestEp && (Date.now() - latestEp.pubDate.getTime()) < 36 * 3600 * 1000
              return (
                <div key={f.rssUrl} className="podcast-card" onClick={() => openFeedDetail(f.name)}>
                  {(meta?.channelImg || f.artwork) ? <img src={meta?.channelImg || f.artwork} alt="" className="card-art" /> : <div className="card-art card-fallback" style={{ background: f.color }}>{f.short}</div>}
                  <div className="card-info">
                    <div className="card-name">{f.name}</div>
                    {hasNew && <span className="card-dot" />}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Latest episodes */}
          {filteredEpisodes.length > 0 && (
            <section style={{ marginTop: 20 }}>
              <h2 className="section-title">Latest Episodes</h2>
              {filteredEpisodes.slice(0, 6).map((ep) => {
                const idx = episodes.indexOf(ep)
                const isNew = (Date.now() - ep.pubDate.getTime()) < 36 * 3600 * 1000
                return (
                  <div key={ep.id} className="ep-card" onClick={() => idx >= 0 ? playEpisode(idx) : playEpisodeDirect(ep)}>
                    {ep.artwork && <img src={ep.artwork} alt="" className="ep-card-art" />}
                    <div className="ep-card-info">
                      <div className="ep-card-feed">{ep.feedName} {isNew && <span className="new-badge">NEW</span>}</div>
                      <div className="ep-card-title">{ep.title}</div>
                      <div className="ep-card-meta">{formatDate(ep.pubDate)} · {Math.round(ep.durationSec / 60)} min</div>
                      {ep.desc && <div className="ep-card-desc">{ep.desc}</div>}
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* Recommendations */}
          {recsToShow.length > 0 && (
            <section style={{ marginTop: 24 }}>
              <h2 className="section-title">Recommended</h2>
              <div className="rec-scroll">
                {recsToShow.map((r) => (
                  <div key={r.id} className="rec-card" onClick={() => addRecommended(r)}>
                    <div className="rec-icon">+</div>
                    <div className="rec-name">{r.name}</div>
                    <div className="rec-genre">{r.genre}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* === PODCAST DETAIL === */}
      {tab === 'detail' && detailFeed && (
        <div className="tab-content">
          <button className="back-btn" onClick={() => setTab('library')}>← Library</button>
          <div className="detail-header">
            {detailMeta?.img ? <img src={detailMeta.img} alt="" className="detail-art" /> : <div className="detail-art detail-fallback" style={{ background: detailFeed.color }}>{detailFeed.short}</div>}
            <div className="detail-info"><h2 className="detail-name">{detailFeed.name}</h2><div className="feed-cat">{detailFeed.category}</div><div className="detail-count">{detailMeta?.count || detailEpisodes.length} episodes</div></div>
          </div>
          {detailMeta?.desc && <p className="detail-desc">{stripHtml(detailMeta.desc).slice(0, 200)}</p>}
          <button className="remove-feed-btn" onClick={() => { removeFeed(feeds.indexOf(detailFeed)); setTab('library') }}>Remove from Library</button>
          {detailLoading && <div className="status">Loading episodes...</div>}
          <p className="section-label" style={{ marginTop: 16 }}>ALL EPISODES</p>
          {detailEpisodes.map((ep) => (
            <div key={ep.id} className="ep-row" onClick={() => playEpisodeDirect(ep)}>
              <div className="ep-info">
                <div className="ep-title">{ep.title}{(Date.now() - ep.pubDate.getTime()) < 36*3600*1000 && <span className="new-badge">NEW</span>}</div>
                <div className="ep-meta">{formatDate(ep.pubDate)} · {Math.round(ep.durationSec/60)} min</div>
                {ep.desc && <div className="ep-desc">{ep.desc}</div>}
              </div>
              <button className="ep-play" onClick={(e) => { e.stopPropagation(); playEpisodeDirect(ep) }}>▶</button>
            </div>
          ))}
        </div>
      )}

      {/* === SEARCH PREVIEW === */}
      {tab === 'preview' && previewPodcast && (
        <div className="tab-content">
          <button className="back-btn" onClick={() => setTab('search')}>← Search</button>
          <div className="detail-header">
            {previewPodcast.artworkUrl100 && <img src={previewPodcast.artworkUrl100} alt="" className="detail-art" />}
            <div className="detail-info"><h2 className="detail-name">{previewPodcast.collectionName}</h2><div className="detail-artist">{previewPodcast.artistName}</div><div className="feed-cat">{previewPodcast.primaryGenreName}</div><div className="detail-count">{previewPodcast.trackCount} episodes</div></div>
          </div>
          {!feeds.some((f) => f.rssUrl === previewPodcast.feedUrl) ? <button className="add-feed-btn" onClick={() => addFromSearch(previewPodcast)}>+ Add to Library</button> : <div className="added-feed-label">Already in Library</div>}
          {previewLoading && <div className="status">Loading episodes...</div>}
          {previewEpisodes.length > 0 && (<><p className="section-label" style={{ marginTop: 16 }}>EPISODES</p>{previewEpisodes.map((ep) => (<div key={ep.id} className="ep-row" onClick={() => playEpisodeDirect(ep)}><div className="ep-info"><div className="ep-title">{ep.title}</div><div className="ep-meta">{formatDate(ep.pubDate)} · {Math.round(ep.durationSec/60)} min</div>{ep.desc && <div className="ep-desc">{ep.desc}</div>}</div><button className="ep-play" onClick={(e) => { e.stopPropagation(); playEpisodeDirect(ep) }}>▶</button></div>))}</>)}
        </div>
      )}

      {/* === NOW PLAYING === */}
      {tab === 'playing' && (
        <div className="tab-content playing-tab">
          {current ? (<>
            <div className="art-large-wrap">{current.artwork ? <img src={current.artwork} alt="" className="art-large" /> : <div className="art-large art-fallback" style={{ background: current.feedColor }}>{current.feedShort}</div>}</div>
            <div className="playing-info"><div className="playing-title">{current.title}</div><div className="playing-meta">{current.feedName} · {formatDate(current.pubDate)}</div>{current.desc && <div className="playing-desc">{current.desc}</div>}</div>
            <div className="progress-bar" ref={progressRef} onClick={(e) => seekFromEvent(e.clientX)} onTouchStart={(e) => seekFromEvent(e.touches[0].clientX)} onTouchMove={(e) => seekFromEvent(e.touches[0].clientX)}><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
            <div className="time-row"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
            <div className="controls"><button className="ctrl-btn" onClick={() => skip(-15)}>-15s</button><button className="play-btn" onClick={togglePlay}>{playing ? '❚❚' : '▶'}</button><button className="ctrl-btn" onClick={() => skip(30)}>+30s</button></div>
            {upNext.length > 0 && (<section className="queue"><p className="section-label">UP NEXT</p>{upNext.map((ep) => { const idx = episodes.indexOf(ep); return (<div key={ep.id} className="ep-row" onClick={() => playEpisode(idx)}>{ep.artwork && <img src={ep.artwork} alt="" className="queue-art" />}{!ep.artwork && <div className="queue-badge" style={{ background: ep.feedColor }}>{ep.feedShort}</div>}<div className="ep-info"><div className="ep-title">{ep.title}</div><div className="ep-meta">{ep.feedName} · {Math.round(ep.durationSec/60)} min</div></div></div>) })}</section>)}
          </>) : (<div className="empty-state"><div className="empty-icon">🎧</div><div className="empty-title">Nothing playing</div><div className="empty-sub">Browse your library or search to start listening</div></div>)}
        </div>
      )}

      {/* === SEARCH === */}
      {tab === 'search' && (
        <div className="tab-content">
          <header><h1>Search</h1></header>
          <div className="search-box">
            <input type="text" placeholder="Search podcasts..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchPodcasts()} className="search-input" />
            <button className="search-btn" onClick={() => searchPodcasts()}>Search</button>
          </div>

          {!searchResults.length && searchHistory.length > 0 && (
            <section style={{ marginTop: 20 }}>
              <p className="section-label">RECENT SEARCHES</p>
              {searchHistory.map((h, i) => (
                <div key={i} className="history-row" onClick={() => { setSearchQuery(h); searchPodcasts(h) }}>
                  <span className="history-icon">↻</span> {h}
                </div>
              ))}
            </section>
          )}

          {searchResults.length > 0 && (
            <section style={{ marginTop: 20 }}>
              <p className="section-label">RESULTS</p>
              {searchResults.map((r) => {
                const added = feeds.some((f) => f.rssUrl === r.feedUrl)
                return (
                  <div key={r.collectionId} className="search-result" onClick={() => openPreview(r)}>
                    {r.artworkUrl100 && <img src={r.artworkUrl100} alt="" className="search-art" />}
                    <div className="ep-info"><div className="ep-title">{r.collectionName}</div><div className="ep-meta">{r.artistName}</div><div className="search-detail">{r.primaryGenreName} · {r.trackCount} eps</div></div>
                    {added ? <span className="added-label">Added</span> : <button className="add-btn" onClick={(e) => { e.stopPropagation(); addFromSearch(r) }}>+ Add</button>}
                  </div>
                )
              })}
            </section>
          )}
        </div>
      )}

      <nav className="tab-bar">
        <button className={`tab ${tab === 'library' || tab === 'detail' ? 'active' : ''}`} onClick={() => setTab('library')}><span className="tab-icon">☰</span>Library</button>
        <button className={`tab ${tab === 'playing' ? 'active' : ''}`} onClick={() => setTab('playing')}><span className="tab-icon">▶</span>Now Playing</button>
        <button className={`tab ${tab === 'search' || tab === 'preview' ? 'active' : ''}`} onClick={() => setTab('search')}><span className="tab-icon">⌕</span>Search</button>
      </nav>
    </div>
  )
}
