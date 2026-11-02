// Fraunces with all axes (opsz + SOFT) for the soft editorial headlines; self-hosted (no Google Fonts CDN in CN)
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/dm-sans'
import './styles/tokens.css'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, firstScreenChunks, prefetchScreensWhenIdle } from './App'
import { applyThemePreference, readThemePreference } from './hooks/useTheme'
import { getEngine } from './state'

// apply a stored light/dark choice before the first paint to avoid a theme flash
applyThemePreference(readThemePreference())

// A tab left open across a deploy asks for chunks the new deploy no longer has: reload once onto the new
// build (state lives in localStorage, the hash keeps the route) instead of showing a broken screen.
const RELOADED_KEY = 'fundbun:chunk-reload'
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0)
    if (Date.now() - last < 60_000) return // already tried — let the screen's error boundary offer "Try again"
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

const root = document.getElementById('root')
if (!root) throw new Error('FundBun: #root element missing from index.html')

/** Resolves after `ms` — a stalled chunk must not keep the page blank (the route's fallback takes over). */
const atMost = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function start(el: HTMLElement) {
  // boot the engine (and apply ?demo= / ?reset=) first, so we know which screen opens; its chunk is usually
  // already in flight (index.html modulepreloads the home screen) — render once it has landed
  const first = firstScreenChunks(getEngine(), window.location.hash)
  await Promise.race([Promise.all(first.map((screen) => screen.preload())).catch(() => undefined), atMost(3000)])
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
void start(root)

// once the first screen is up, warm the other screens so tab switches never wait on the network
if (document.readyState === 'complete') prefetchScreensWhenIdle()
else window.addEventListener('load', () => prefetchScreensWhenIdle(), { once: true })
