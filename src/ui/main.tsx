// Fraunces with all axes (opsz + SOFT) for the soft editorial headlines; self-hosted (no Google Fonts CDN in CN)
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/dm-sans'
import './styles/tokens.css'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyThemePreference, readThemePreference } from './hooks/useTheme'

// apply a stored light/dark choice before the first paint to avoid a theme flash
applyThemePreference(readThemePreference())

const root = document.getElementById('root')
if (!root) throw new Error('FundBun: #root element missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
