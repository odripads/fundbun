import { BatteryFull, Signal, Wifi } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Chrome } from '../../router'
import { OverlayRootContext } from '../ds/overlay'
import { ToastViewport } from '../ds/Toast'
import { GlassBoxSlot } from './GlassBoxSlot'
import { TopBarSlotContext } from './ScreenTopBar'
import { SteamBackdrop } from './SteamBackdrop'
import styles from './AppFrame.module.css'

export interface AppFrameProps {
  /** 'app' phone layout · 'bare' phone layout without bars · 'wide' full-width page (gallery) */
  chrome: Chrome
  /** the shell's TopBar; screens with their own use <ScreenTopBar>, which lands in the same slot */
  topBar?: ReactNode
  tabBar?: ReactNode
  /** content of the desktop glass-box panel; undefined hides the panel */
  glassBox?: ReactNode
  glassBoxBusy?: boolean
  /** changes on navigation: resets scroll and moves focus to the new page (not on first load) */
  pageKey?: string
  children: ReactNode
}

/** Decorative phone status bar, shown only inside the desktop device frame. */
function DeviceStatusBar() {
  return (
    <div className={styles.statusBar} aria-hidden="true">
      <span className={styles.clock}>9:41</span>
      <span className={styles.island} />
      <span className={styles.sysIcons}>
        <Signal />
        <Wifi />
        <BatteryFull />
      </span>
    </div>
  )
}

/**
 * The shell: mobile-first column (max var(--app-max)); at >= 1024px a phone-sized device frame on the left
 * and the glass-box panel on the right. Overlays and toasts render inside the frame via OverlayRootContext.
 */
export function AppFrame({ chrome, topBar, tabBar, glassBox, glassBoxBusy, pageKey, children }: AppFrameProps) {
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null)
  const [topSlot, setTopSlot] = useState<HTMLDivElement | null>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const lastKey = useRef(pageKey)

  useEffect(() => {
    if (pageKey === lastKey.current) return
    lastKey.current = pageKey
    screenRef.current?.scrollTo?.({ top: 0 })
    if (typeof window !== 'undefined') window.scrollTo?.({ top: 0 })
    mainRef.current?.focus({ preventScroll: true })
  }, [pageKey])

  const hasGlass = chrome !== 'wide' && glassBox !== undefined
  return (
    <div className={styles.stage} data-chrome={chrome} data-glass={hasGlass || undefined}>
      {chrome !== 'wide' ? <SteamBackdrop variant="canvas" /> : null}
      <OverlayRootContext.Provider value={overlayRoot}>
        <TopBarSlotContext.Provider value={topSlot}>
          <div className={styles.device} data-tabbar={Boolean(tabBar) || undefined}>
            {chrome !== 'wide' ? <DeviceStatusBar /> : null}
            <SteamBackdrop variant={chrome === 'wide' ? 'page' : 'screen'} />
            <div className={styles.screen} ref={screenRef}>
              <a
                className="skip-link"
                href="#main"
                onClick={(e) => {
                  e.preventDefault()
                  mainRef.current?.focus()
                }}
              >
                Skip to content
              </a>
              <div className={styles.topSlot} ref={setTopSlot}>{topBar}</div>
              <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
                {children}
              </main>
            </div>
            {tabBar}
            <div ref={setOverlayRoot} className={styles.overlayRoot} />
            {overlayRoot ? <ToastViewport /> : null}
            {chrome !== 'wide' ? <span className={styles.homeIndicator} aria-hidden="true" /> : null}
          </div>
        </TopBarSlotContext.Provider>
      </OverlayRootContext.Provider>
      {hasGlass ? <GlassBoxSlot busy={glassBoxBusy}>{glassBox}</GlassBoxSlot> : null}
    </div>
  )
}
