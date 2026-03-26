# Daily Drive

A Progressive Web App that replaces Spotify's discontinued Daily Drive feature. It pulls fresh podcast episodes from RSS feeds, builds a morning commute playlist, and lives on your iPhone home screen.

## What It Does

- **Morning Commute Mix** — One-tap playlist that auto-generates a ~30 min queue from your podcasts, prioritizing news then mixing in other categories. Like Spotify's Daily Drive daylist.
- **Podcast Library** — Spotify-style home with a 2-column grid of your subscribed podcasts, latest episode cards, and curated recommendations.
- **Full Episode Browsing** — Tap any podcast to see all episodes (up to 100). Browse old episodes, not just the latest.
- **Search & Discovery** — Search Apple Podcasts, preview any show's episodes before subscribing, search history saved locally.
- **Audio Player** — Full playback controls, touch-friendly seek bar, skip forward/back, lock screen controls via Media Session API.
- **Rain Sounds & Sleep Timer** — Pink noise generator using Web Audio API. Continuous play or timed (15/30/45/60/90 min) with volume fade-out in the last 30 seconds.
- **Auto-Refresh** — Episodes refresh automatically at 6am Chicago time every day.
- **Playback Persistence** — Remembers your position in every episode and which episode you were on across app restarts.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite |
| Styling | Custom CSS (dark theme, CSS variables) |
| RSS Parsing | DOMParser (XML to episodes) |
| Podcast Search | Apple iTunes Search API (free, no CORS) |
| Audio | HTML5 `<audio>` + Web Audio API (rain noise) |
| Lock Screen | Media Session API |
| Persistence | localStorage (feeds, episodes, positions, search history) |
| Dev Proxy | Vite middleware plugin + static proxy paths |
| Prod Proxy | Netlify serverless function |
| Hosting | Netlify (static + functions) |
| PWA | manifest.json, apple-mobile-web-app meta tags |

## Project Structure

```
DD/
├── index.html              # PWA entry point (viewport-fit, Dynamic Island support)
├── manifest.json           # PWA manifest (standalone, dark theme)
├── netlify.toml            # Netlify build config
├── package.json            # React 18, Vite 5
├── vite.config.js          # Dev proxy + feed middleware plugin
├── netlify/
│   └── functions/
│       └── feed.js         # Serverless RSS proxy for production
└── src/
    ├── main.jsx            # React entry
    ├── App.jsx             # All app logic (~600 lines, single component)
    └── style.css           # All styles (~500 lines, CSS variables)
```

## Key Features Explained

### RSS Proxy (CORS)

Browsers block direct RSS feed fetches due to CORS. We solve this two ways:

- **Dev**: Vite dev server has a middleware plugin (`feedProxyPlugin`) that intercepts `/.netlify/functions/feed?url=...` requests and fetches RSS directly. Also has static proxy paths for known feeds (Simplecast, NPR).
- **Prod**: A Netlify serverless function at `netlify/functions/feed.js` does the same — takes a `?url=` param, fetches the RSS, and returns it with CORS headers.

### Morning Commute Mix

The `buildCommuteMix()` function creates a ~30 min playlist:

1. Grabs the latest episode from each news feed
2. Fills remaining time with episodes from other categories, alternating between feeds
3. Accounts for saved playback positions (remaining time, not full duration)
4. As you add more podcasts, the mix gets closer to the 30 min target

### Rain / White Noise

Uses the Web Audio API to generate pink noise (sounds like rain):
- Creates an AudioBuffer with the Voss-McCartney pink noise algorithm
- Loops the buffer continuously
- GainNode controls volume
- Sleep timer counts down and fades volume to zero in the last 30 seconds, then stops both rain and podcast audio

### iPhone PWA Support

- `viewport-fit=cover` + `env(safe-area-inset-top/bottom)` for Dynamic Island and home indicator
- `apple-mobile-web-app-capable` for standalone mode
- `apple-mobile-web-app-status-bar-style: black-translucent` for immersive header
- Touch seek on progress bar via `onTouchStart`/`onTouchMove`

### Persistence

All state is saved to localStorage:

| Key | What |
|-----|------|
| `dd-feeds` | Subscribed podcast feeds (name, RSS URL, category, color, artwork) |
| `dd-episodes` | Cached recent episodes (loads instantly on app open) |
| `dd-playback` | Current episode ID + timestamp |
| `dd-positions` | Per-episode playback positions (resume where you left off) |
| `dd-search-history` | Last 10 search queries |

## Running Locally

```bash
npm install
npm run dev
```

## Deploying

Connect the GitHub repo to Netlify. It will:
1. Run `npm run build`
2. Publish the `dist/` folder
3. Deploy `netlify/functions/feed.js` as a serverless function

## Default Feeds

- The Daily (NYT)
- Up First (NPR)

You can add any podcast via the Search tab (uses Apple Podcasts search).
