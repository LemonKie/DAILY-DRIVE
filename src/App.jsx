import React, { useState, useEffect, useRef, useCallback } from 'react'

// ── Constants ──
const DEFAULT_FEEDS = [
  { name: 'The Daily', short: 'TD', rssUrl: 'https://feeds.simplecast.com/54nAGcIl', color: '#7c3aed', category: 'News' },
  { name: 'Up First', short: 'NPR', rssUrl: 'https://feeds.npr.org/510318/podcast.xml', color: '#a855f7', category: 'News' },
]

const STUDY_DOMAINS = ['Threats & Attacks', 'Cryptography & PKI', 'Identity & Access Mgmt', 'Network Security', 'Risk & GRC']
const STUDY_LINKS = [
  { label: 'Prof Messer', url: 'https://www.professormesser.com/security-plus/sy0-701/sy0-701-video/sy0-701-comptia-security-702-course/' },
  { label: 'Practice Tests', url: 'https://www.examcompass.com/comptia-security-plus-certification-exam-free-practice-test' },
  { label: 'Flashcards', url: 'https://quizlet.com/subject/security-plus/' },
  { label: 'Reddit', url: 'https://www.reddit.com/r/CompTIA/' },
]
const EXAM_DATE = new Date('2026-08-01')
const STUDY_START = new Date('2026-01-01')
const SPEED_OPTIONS = [1, 1.25, 1.5, 2]

// ── Helpers ──
const isDev = import.meta.env.DEV

function getFeedUrl(rssUrl) {
  if (isDev) {
    try {
      const u = new URL(rssUrl)
      if (u.hostname.includes('simplecast')) return '/feed/simplecast' + u.pathname
      if (u.hostname.includes('npr.org')) return '/feed/npr' + u.pathname
    } catch {}
  }
  return '/.netlify/functions/feed?url=' + encodeURIComponent(rssUrl)
}

function stripHtml(html) { if (!html) return ''; const t = document.createElement('div'); t.innerHTML = html; return t.textContent || '' }
function fmtTime(sec) { if (!sec || isNaN(sec)) return '0:00'; const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `${m}:${s.toString().padStart(2, '0')}` }
function fmtDate(d) {
  const now = new Date(); const diff = now - d
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 172800000) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── LocalStorage ──
function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback } catch { return fallback } }
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)) }

function loadSettings() {
  return load('dd-settings', { commuteMin: 30, songsBetween: 5, feeds: DEFAULT_FEEDS, rainVolume: 0.5 })
}

function loadStudy() {
  return load('dd-study', { studiedDays: [], domains: [0, 0, 0, 0, 0], xp: 0 })
}

function loadMix() {
  const m = load('dd-mix', null)
  if (!m) return null
  const today = new Date().toISOString().split('T')[0]
  if (m.date !== today) return null
  return m
}

function loadPositions() { return load('dd-positions', {}) }
function savePosition(id, time) { const p = loadPositions(); p[id] = time; save('dd-positions', p) }
function getPosition(id) { return loadPositions()[id] || 0 }

// ── RSS Parser ──
function parseFeed(xml, feed) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const items = doc.querySelectorAll('item')
  const channel = doc.querySelector('channel')
  const channelImg = channel?.querySelector('image > url')?.textContent || channel?.querySelector('*|image')?.getAttribute('href') || ''
  const episodes = []
  for (let i = 0; i < Math.min(items.length, 5); i++) {
    const item = items[i]
    const title = item.querySelector('title')?.textContent || 'Untitled'
    const audioUrl = item.querySelector('enclosure')?.getAttribute('url')
    if (!audioUrl) continue
    const dur = item.querySelector('duration')?.textContent
    const itemImg = item.querySelector('*|image')?.getAttribute('href')
    const desc = stripHtml(item.querySelector('description')?.textContent || '').slice(0, 200)
    let durationSec = 0
    if (dur) { const p = dur.split(':').map(Number); if (p.length === 3) durationSec = p[0]*3600+p[1]*60+p[2]; else if (p.length === 2) durationSec = p[0]*60+p[1]; else durationSec = p[0] }
    episodes.push({
      id: `pod-${feed.short}-${i}`,
      type: 'podcast',
      title, audioUrl, durationSec, desc,
      artwork: itemImg || channelImg || feed.artwork || '',
      feedName: feed.name, feedShort: feed.short, feedColor: feed.color,
    })
  }
  return { episodes, channelImg }
}

// ── Rain Noise ──
function createRainNoise(ctx) {
  const buf = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0
    for (let i = 0; i < d.length; i++) {
      const w = Math.random()*2-1
      b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759
      b2=0.96900*b2+w*0.1538520; b3=0.86650*b3+w*0.3104856
      b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980
      d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926
    }
  }
  return buf
}

// ── App ──
export default function App() {
  const [tab, setTab] = useState('player')
  const [settings, setSettings] = useState(loadSettings)
  const [study, setStudy] = useState(loadStudy)
  const [mix, setMix] = useState([])
  const [mixIndex, setMixIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [building, setBuilding] = useState(false)
  const [spotifyOk, setSpotifyOk] = useState(null)
  const [rainPlaying, setRainPlaying] = useState(false)

  const audioRef = useRef(null)
  const progressRef = useRef(null)
  const saveTimer = useRef(null)
  const rainCtx = useRef(null)
  const rainSource = useRef(null)
  const rainGain = useRef(null)

  const current = mix[mixIndex] || null

  // ── Build Mix ──
  const buildMix = useCallback(async (force = false) => {
    if (!force) {
      const cached = loadMix()
      if (cached) { setMix(cached.items); return cached.items }
    }
    setBuilding(true)
    const items = []

    // Fetch podcasts
    const podEpisodes = []
    for (const feed of settings.feeds) {
      try {
        const res = await fetch(getFeedUrl(feed.rssUrl))
        if (!res.ok) continue
        const xml = await res.text()
        const { episodes } = parseFeed(xml, feed)
        if (episodes.length > 0) podEpisodes.push(episodes[0])
      } catch {}
    }

    // Fetch Spotify tracks
    let songs = []
    try {
      const tokenRes = await fetch('/.netlify/functions/spotify?action=token', { method: 'POST' })
      const tokenData = await tokenRes.json()
      if (tokenData.accessToken) {
        setSpotifyOk(true)
        const tracksRes = await fetch('/.netlify/functions/spotify?action=top-tracks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: tokenData.accessToken }),
        })
        const tracksData = await tracksRes.json()
        songs = (tracksData.tracks || []).filter((t) => t.previewUrl).map((t) => ({
          id: `song-${t.id}`,
          type: 'song',
          title: t.title,
          artist: t.artist,
          artwork: t.albumArt,
          audioUrl: t.previewUrl,
          durationSec: Math.round(t.durationMs / 1000),
          previewDuration: 30,
        }))
        // Shuffle songs
        for (let i = songs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [songs[i], songs[j]] = [songs[j], songs[i]] }
      } else {
        setSpotifyOk(false)
      }
    } catch { setSpotifyOk(false) }

    // Interleave: podcast → N songs → podcast → N songs
    const target = settings.commuteMin * 60
    let totalSec = 0; let si = 0; let pi = 0
    while (totalSec < target && (pi < podEpisodes.length || si < songs.length)) {
      // Add podcast
      if (pi < podEpisodes.length) {
        const ep = podEpisodes[pi % podEpisodes.length]
        items.push(ep)
        totalSec += ep.durationSec || 1200
        pi++
      }
      // Add N songs
      for (let s = 0; s < settings.songsBetween && si < songs.length && totalSec < target; s++) {
        items.push(songs[si])
        totalSec += 30 // preview duration
        si++
      }
      // If we've used all podcasts, wrap around
      if (pi >= podEpisodes.length && podEpisodes.length > 0) pi = 0
      if (si >= songs.length && items.length > 0) break
    }

    // If no songs, just podcasts
    if (items.length === 0 && podEpisodes.length > 0) {
      items.push(...podEpisodes)
    }

    setMix(items)
    save('dd-mix', { date: new Date().toISOString().split('T')[0], items })
    setBuilding(false)
    return items
  }, [settings])

  // Init
  useEffect(() => { buildMix() }, [buildMix])

  // ── Audio Events ──
  useEffect(() => {
    const a = audioRef.current; if (!a || !current) return
    a.src = current.audioUrl; a.load()
    if (current.type === 'podcast') {
      const pos = getPosition(current.id); if (pos > 0) a.currentTime = pos
    }
    a.playbackRate = current.type === 'podcast' ? speed : 1
    if (playing) a.play().catch(() => {})
  }, [mixIndex, current?.id]) // eslint-disable-line

  useEffect(() => {
    const a = audioRef.current; if (!a) return
    const onTime = () => {
      setCurrentTime(a.currentTime)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        if (current?.type === 'podcast') savePosition(current.id, a.currentTime)
      }, 3000)
    }
    const onDur = () => setDuration(a.duration)
    const onEnd = () => { if (mixIndex < mix.length - 1) { setMixIndex(mixIndex + 1) } else setPlaying(false) }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    a.addEventListener('timeupdate', onTime); a.addEventListener('durationchange', onDur)
    a.addEventListener('ended', onEnd); a.addEventListener('play', onPlay); a.addEventListener('pause', onPause)
    return () => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('durationchange', onDur); a.removeEventListener('ended', onEnd); a.removeEventListener('play', onPlay); a.removeEventListener('pause', onPause) }
  }, [mixIndex, mix.length, current])

  // Media Session
  useEffect(() => {
    if (!current || !('mediaSession' in navigator)) return
    const meta = { title: current.title, artist: current.type === 'podcast' ? current.feedName : current.artist }
    if (current.artwork) meta.artwork = [{ src: current.artwork, sizes: '512x512', type: 'image/jpeg' }]
    navigator.mediaSession.metadata = new MediaMetadata(meta)
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    const a = audioRef.current
    const h = {
      play: () => a?.play(), pause: () => a?.pause(),
      seekbackward: () => { if (a) a.currentTime = Math.max(0, a.currentTime - 15) },
      seekforward: () => { if (a) a.currentTime = Math.min(a.duration || 0, a.currentTime + 30) },
      previoustrack: mixIndex > 0 ? () => setMixIndex(mixIndex - 1) : null,
      nexttrack: mixIndex < mix.length - 1 ? () => setMixIndex(mixIndex + 1) : null,
    }
    for (const [act, fn] of Object.entries(h)) { try { navigator.mediaSession.setActionHandler(act, fn) } catch {} }
  }, [current, playing, mixIndex, mix.length])

  // ── Controls ──
  function togglePlay() {
    const a = audioRef.current; if (!a) return
    if (!current && mix.length > 0) { setMixIndex(0); setPlaying(true); return }
    if (playing) a.pause(); else a.play().catch(() => {})
  }
  function seek(clientX) {
    const a = audioRef.current; const bar = progressRef.current
    if (!a || !bar || !duration) return
    const r = bar.getBoundingClientRect()
    a.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration
  }
  function skip(sec) { const a = audioRef.current; if (a) a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + sec)) }
  function cycleSpeed() {
    const next = SPEED_OPTIONS[(SPEED_OPTIONS.indexOf(speed) + 1) % SPEED_OPTIONS.length]
    setSpeed(next)
    const a = audioRef.current; if (a && current?.type === 'podcast') a.playbackRate = next
  }
  function jumpTo(i) { setMixIndex(i); setPlaying(true); setTab('player') }

  // ── Rain ──
  function toggleRain() {
    if (rainPlaying) {
      try { rainSource.current?.stop(); rainCtx.current?.close() } catch {}
      setRainPlaying(false); return
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const gain = ctx.createGain(); gain.gain.value = settings.rainVolume; gain.connect(ctx.destination)
    const src = ctx.createBufferSource(); src.buffer = createRainNoise(ctx); src.loop = true; src.connect(gain); src.start()
    rainCtx.current = ctx; rainSource.current = src; rainGain.current = gain
    setRainPlaying(true)
  }
  function setRainVol(v) {
    updateSetting('rainVolume', v)
    if (rainGain.current) rainGain.current.gain.value = v
  }

  // ── Settings ──
  function updateSetting(key, val) {
    const next = { ...settings, [key]: val }; setSettings(next); save('dd-settings', next)
  }
  function addFeed(name, rssUrl, category = 'Other') {
    if (settings.feeds.some((f) => f.rssUrl === rssUrl)) return
    const short = name.slice(0, 3).toUpperCase()
    updateSetting('feeds', [...settings.feeds, { name, short, rssUrl, color: '#7c3aed', category }])
  }
  function removeFeed(i) {
    updateSetting('feeds', settings.feeds.filter((_, idx) => idx !== i))
  }

  // ── Study ──
  const todayStr = new Date().toISOString().split('T')[0]
  const studiedToday = study.studiedDays.includes(todayStr)
  const daysLeft = Math.max(0, Math.ceil((EXAM_DATE - new Date()) / 86400000))
  const examPct = Math.min(100, Math.round((Math.max(0, new Date() - STUDY_START) / (EXAM_DATE - STUDY_START)) * 100))
  const studyLevel = Math.floor(study.xp / 100) + 1
  const xpInLevel = study.xp % 100

  function getWeekDays() {
    const now = new Date(); const day = now.getDay()
    const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7))
    return ['M','T','W','T','F','S','S'].map((l, i) => {
      const d = new Date(mon); d.setDate(mon.getDate() + i)
      return { label: l, date: d.toISOString().split('T')[0] }
    })
  }
  function getStreak() {
    const days = new Set(study.studiedDays); let s = 0; const d = new Date()
    if (!days.has(d.toISOString().split('T')[0])) { d.setDate(d.getDate() - 1); if (!days.has(d.toISOString().split('T')[0])) return 0 }
    for (let i = 0; i < 365; i++) { if (days.has(d.toISOString().split('T')[0])) { s++; d.setDate(d.getDate() - 1) } else break }
    return s
  }
  function markStudied() {
    if (studiedToday) return
    const next = { ...study, studiedDays: [...study.studiedDays, todayStr], xp: study.xp + 25 }
    setStudy(next); save('dd-study', next)
  }
  function tapDomain(i) {
    if (study.domains[i] >= 100) return
    const doms = [...study.domains]; doms[i] = Math.min(100, doms[i] + 20)
    const next = { ...study, domains: doms, xp: study.xp + 5 }
    setStudy(next); save('dd-study', next)
  }

  // ── Derived ──
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const peek = mix.slice(mixIndex + 1, mixIndex + 4)
  const bgArt = current?.artwork || ''

  return (
    <div className="app">
      <audio ref={audioRef} preload="metadata" />

      {/* ═══ PLAYER TAB ═══ */}
      {tab === 'player' && (
        <div className="tab-content player-screen">
          {bgArt && <div className="player-bg" style={{ backgroundImage: `url(${bgArt})` }} />}
          <div className="player-overlay" />

          {building ? (
            <div className="building">
              <div className="building-spinner" />
              <div className="building-text">Building your mix...</div>
              <div className="building-sub">Fetching podcasts & songs</div>
            </div>
          ) : !current ? (
            <div className="building">
              <div className="building-text">No mix yet</div>
              <div className="building-sub">Add podcasts in Settings, then rebuild</div>
            </div>
          ) : (
            <div className="player-content">
              <div className="player-art-wrap">
                {current.artwork ? <img src={current.artwork} alt="" className="player-art" /> : <div className="player-art player-art-fallback">{current.feedShort || '?'}</div>}
              </div>
              <div className="player-info">
                <div className="player-type-badge">{current.type === 'podcast' ? current.feedName : current.artist}</div>
                <h2 className="player-title">{current.title}</h2>
              </div>
              <div className="player-progress">
                <div className="progress-bar" ref={progressRef} onClick={(e) => seek(e.clientX)} onTouchStart={(e) => seek(e.touches[0].clientX)} onTouchMove={(e) => seek(e.touches[0].clientX)}>
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="time-row"><span>{fmtTime(currentTime)}</span><span>{fmtTime(duration)}</span></div>
              </div>
              <div className="player-controls">
                <button className="ctrl-btn" onClick={() => skip(-15)}>-15</button>
                <button className="ctrl-btn" onClick={() => mixIndex > 0 && setMixIndex(mixIndex - 1)}>⏮</button>
                <button className="play-btn" onClick={togglePlay}>{playing ? '❚❚' : '▶'}</button>
                <button className="ctrl-btn" onClick={() => mixIndex < mix.length - 1 && setMixIndex(mixIndex + 1)}>⏭</button>
                <button className="ctrl-btn" onClick={() => skip(30)}>+30</button>
              </div>
              {current.type === 'podcast' && (
                <button className="speed-btn" onClick={cycleSpeed}>{speed}x</button>
              )}
              {peek.length > 0 && (
                <div className="peek">
                  <div className="peek-label">Up next</div>
                  {peek.map((item, i) => (
                    <div key={item.id + i} className="peek-item" onClick={() => jumpTo(mixIndex + 1 + i)}>
                      {item.artwork && <img src={item.artwork} alt="" className="peek-art" />}
                      <div className="peek-info">
                        <div className="peek-title">{item.title}</div>
                        <div className="peek-meta">{item.type === 'podcast' ? item.feedName : item.artist}</div>
                      </div>
                      <span className={`peek-dot ${item.type}`} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ QUEUE TAB ═══ */}
      {tab === 'queue' && (
        <div className="tab-content">
          <header className="tab-header">
            <h1>Today's Mix</h1>
            <button className="rebuild-btn" onClick={() => buildMix(true)} disabled={building}>{building ? 'Building...' : 'Rebuild'}</button>
          </header>
          {mix.length === 0 && !building && <div className="empty">No mix built yet. Check Settings for podcast feeds.</div>}
          {building && <div className="skeleton-list">{[...Array(6)].map((_, i) => <div key={i} className="skeleton-row"><div className="skeleton-art" /><div className="skeleton-lines"><div className="skeleton-line w60" /><div className="skeleton-line w40" /></div></div>)}</div>}
          <div className="queue-list">
            {mix.map((item, i) => (
              <div key={item.id + i} className={`queue-item ${i === mixIndex ? 'active' : ''} ${item.type}`} onClick={() => jumpTo(i)}>
                <div className="queue-num">{i + 1}</div>
                {item.artwork ? <img src={item.artwork} alt="" className="queue-art" /> : <div className="queue-art queue-art-fallback" style={{ background: item.feedColor }}>{item.feedShort}</div>}
                <div className="queue-info">
                  <div className="queue-title">{item.title}</div>
                  <div className="queue-meta">{item.type === 'podcast' ? item.feedName : item.artist} · {item.type === 'song' ? '0:30' : fmtTime(item.durationSec)}</div>
                </div>
                <span className={`queue-type-dot ${item.type}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ STUDY TAB ═══ */}
      {tab === 'study' && (
        <div className="tab-content">
          <header className="tab-header">
            <h1>Study</h1>
            <span className="xp-badge">Lv {studyLevel} · {study.xp} XP</span>
          </header>

          <div className="card">
            <div className="card-row"><span className="card-label">Streak</span><span className="accent-text">{getStreak()} day{getStreak() !== 1 ? 's' : ''}</span></div>
            <div className="streak-dots">
              {getWeekDays().map((d) => (
                <div key={d.date} className="dot-wrap">
                  <div className={`dot ${study.studiedDays.includes(d.date) ? 'filled' : ''} ${d.date === todayStr ? 'today' : ''}`} />
                  <span className="dot-label">{d.label}</span>
                </div>
              ))}
            </div>
            <button className={`checkin-btn ${studiedToday ? 'done' : ''}`} onClick={markStudied}>
              {studiedToday ? 'Done +25 XP' : 'Mark Studied'}
            </button>
          </div>

          <div className="card">
            <div className="card-row"><span className="card-label">Level {studyLevel}</span><span className="accent-text">{xpInLevel}/100</span></div>
            <div className="bar"><div className="bar-fill xp" style={{ width: `${xpInLevel}%` }} /></div>
          </div>

          <div className="card">
            <div className="card-row"><span className="card-label">Security+</span><span className="accent-text">{daysLeft}d left</span></div>
            <div className="card-sub">Aug 1, 2026</div>
            <div className="bar"><div className="bar-fill exam" style={{ width: `${examPct}%` }} /></div>
          </div>

          <div className="card">
            <span className="card-label">Domains</span>
            <div className="domain-list">
              {STUDY_DOMAINS.map((name, i) => (
                <div key={name} className="domain-row" onClick={() => tapDomain(i)}>
                  <div className="domain-top"><span>{name}</span><span className="accent-text">{study.domains[i]}%</span></div>
                  <div className="bar sm"><div className="bar-fill" style={{ width: `${study.domains[i]}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="hint">Tap +20% (+5 XP)</div>
          </div>

          <div className="card">
            <span className="card-label">Links</span>
            <div className="link-grid">
              {STUDY_LINKS.map((l) => (
                <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" className="link-btn">{l.label}</a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ SETTINGS TAB ═══ */}
      {tab === 'settings' && (
        <div className="tab-content">
          <header className="tab-header"><h1>Settings</h1></header>

          <div className="card">
            <div className="card-row">
              <span className="card-label">Spotify</span>
              <span className={`status-dot ${spotifyOk === true ? 'green' : spotifyOk === false ? 'red' : 'gray'}`} />
            </div>
            <div className="card-sub">{spotifyOk === true ? 'Connected — using your top tracks' : spotifyOk === false ? 'Not connected — add env vars in Netlify' : 'Checking...'}</div>
          </div>

          <div className="card">
            <span className="card-label">Mix Length</span>
            <div className="pill-row">
              {[15, 30, 45, 60].map((m) => (
                <button key={m} className={`pill ${settings.commuteMin === m ? 'active' : ''}`} onClick={() => updateSetting('commuteMin', m)}>{m}m</button>
              ))}
            </div>
          </div>

          <div className="card">
            <span className="card-label">Songs Between Podcasts</span>
            <div className="pill-row">
              {[3, 5, 7].map((n) => (
                <button key={n} className={`pill ${settings.songsBetween === n ? 'active' : ''}`} onClick={() => updateSetting('songsBetween', n)}>{n}</button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-row">
              <span className="card-label">Rain Sounds</span>
              <button className={`rain-btn ${rainPlaying ? 'on' : ''}`} onClick={toggleRain}>{rainPlaying ? 'Stop' : 'Play'}</button>
            </div>
            <div className="card-row" style={{ marginTop: 8 }}>
              <span className="card-sub-inline">Volume</span>
              <input type="range" min="0" max="1" step="0.05" value={settings.rainVolume} onChange={(e) => setRainVol(+e.target.value)} className="slider" />
            </div>
          </div>

          <div className="card">
            <span className="card-label">Podcast Feeds</span>
            {settings.feeds.map((f, i) => (
              <div key={f.rssUrl} className="feed-row">
                <div className="feed-info"><span className="feed-name">{f.name}</span><span className="feed-cat">{f.category}</span></div>
                <button className="feed-remove" onClick={() => removeFeed(i)}>×</button>
              </div>
            ))}
            <AddFeedForm onAdd={addFeed} />
          </div>
        </div>
      )}

      {/* ═══ MINI PLAYER ═══ */}
      {current && tab !== 'player' && (
        <div className="mini-player" onClick={() => setTab('player')}>
          {current.artwork ? <img src={current.artwork} alt="" className="mini-art" /> : <div className="mini-art mini-fallback" style={{ background: current.feedColor }}>{current.feedShort}</div>}
          <div className="mini-info"><div className="mini-title">{current.title}</div><div className="mini-meta">{current.type === 'podcast' ? current.feedName : current.artist}</div></div>
          <button className="mini-play" onClick={(e) => { e.stopPropagation(); togglePlay() }}>{playing ? '❚❚' : '▶'}</button>
        </div>
      )}

      {/* ═══ TAB BAR ═══ */}
      <nav className="tab-bar">
        <button className={`tab ${tab === 'player' ? 'active' : ''}`} onClick={() => setTab('player')}><span className="tab-icon">▶</span>Player</button>
        <button className={`tab ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}><span className="tab-icon">☰</span>Queue</button>
        <button className={`tab ${tab === 'study' ? 'active' : ''}`} onClick={() => setTab('study')}><span className="tab-icon">📖</span>Study</button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}><span className="tab-icon">⚙</span>Settings</button>
      </nav>
    </div>
  )
}

// ── Add Feed Form ──
function AddFeedForm({ onAdd }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [cat, setCat] = useState('Other')
  const [open, setOpen] = useState(false)

  if (!open) return <button className="add-feed-toggle" onClick={() => setOpen(true)}>+ Add Feed</button>

  return (
    <div className="add-feed-form">
      <input placeholder="Podcast name" value={name} onChange={(e) => setName(e.target.value)} className="input" />
      <input placeholder="RSS URL" value={url} onChange={(e) => setUrl(e.target.value)} className="input" />
      <select value={cat} onChange={(e) => setCat(e.target.value)} className="select">
        <option>News</option><option>Story</option><option>Documentary</option><option>Other</option>
      </select>
      <div className="add-feed-actions">
        <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn-primary" onClick={() => { if (name && url) { onAdd(name, url, cat); setName(''); setUrl(''); setOpen(false) } }}>Add</button>
      </div>
    </div>
  )
}
