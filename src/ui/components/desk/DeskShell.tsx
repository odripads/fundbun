import { Camera, ChartColumn, ChevronLeft, Cpu, Gem, History, LayoutDashboard, PanelRightClose, Plus, ReceiptText, Settings, ShieldCheck, Smartphone, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { href, navigate, type RouteName } from '../../router'
import { QuickAdd } from '../../screens/home/QuickAdd'
import { shallowEqual, useSnapshot } from '../../state'
import { SaveFailedBanner } from '../account/StorageMeter'
import { BunMascot, Logo } from '../brand'
import { Button } from '../ds/Button'
import { cx } from '../ds/cx'
import { IconButton, badgeText } from '../ds/IconButton'
import { OverlayRootContext } from '../ds/overlay'
import { rovingIndex } from '../ds/roving'
import { ToastViewport } from '../ds/Toast'
import { TopBarSlotContext } from '../layout/ScreenTopBar'
import { ShellActions } from '../layout/ShellActions'
import { SteamBackdrop } from '../layout/SteamBackdrop'
import { DeskActionsContext, type DeskActions } from './deskActions'
import { DESK_NAV, chatTabName, longDate } from './deskModel'
import { readPanelOpen, readPanelTab, setViewPreference, usePanelDocked, writePanelOpen, writePanelTab, type DeskPanelTab } from './useDeskMode'
import styles from './DeskShell.module.css'

export interface DeskShellProps {
  /** the route the work area shows (the sidebar highlights it) */
  route: RouteName
  /** the page's h1 */
  title: string
  /** "up" destination for a route the sidebar does not list (the receipt reader) */
  parent?: RouteName
  /** changes on navigation: resets scroll and moves focus to the new page (not on first load) */
  pageKey?: string
  /** true: a centred reading column for the phone-shaped screens · false: the full work area (the dashboard) */
  column?: boolean
  /** actions waiting for the user's OK: the count on the Ask Bun tab */
  awaiting?: number
  /** the agent is working on a reply */
  busy?: boolean
  /**
   * Bump it to open the side panel on Ask Bun and put the cursor in the message box (the `chat` route does: on the
   * desk the chat is a panel beside the work, not a page of its own).
   */
  chatRequest?: number
  /** the Ask Bun tab: the chat screen in its panel layout */
  chat: ReactNode
  /** the Glass box tab: the live trace, policy, audit tail and sandbox */
  glassBox: ReactNode
  /** bottom of the sidebar, above Settings (e.g. an AI connection chip); a quiet engine note when absent */
  sidebarFooter?: ReactNode
  children: ReactNode
}

const NAV_ICON: Partial<Record<RouteName, LucideIcon>> = {
  home: LayoutDashboard,
  insights: ChartColumn,
  bills: ReceiptText,
  goals: Gem,
  activity: History,
}

const PANEL_TABS: readonly DeskPanelTab[] = ['chat', 'glass']

const selectShell = (s: AppSnapshot) => ({
  today: s.derived.today,
  sandbox: s.derived.clock === 'sandbox',
  unseen: s.derived.unseenEvents.length,
  engine: s.derived.engine,
})

function initialDockedOpen(): boolean {
  return readPanelOpen() ?? true
}

/**
 * The desktop app: a sidebar to move around, the work area in the middle, and Bun on the side (docked from 1280px,
 * a drawer from 900 to 1279px). Screens render in the work area; sheets, dialogs and toasts open over the whole
 * window through the same contexts the phone frame provides.
 */
export function DeskShell({ route, title, parent, pageKey, column = false, awaiting = 0, busy = false, chatRequest = 0, chat, glassBox, sidebarFooter, children }: DeskShellProps) {
  const { today, sandbox, unseen, engine } = useSnapshot(selectShell, shallowEqual)
  const docked = usePanelDocked()
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null)
  const [topSlot, setTopSlot] = useState<HTMLDivElement | null>(null)
  const [dockedOpen, setDockedOpen] = useState(initialDockedOpen)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState<DeskPanelTab>(readPanelTab)
  const [adding, setAdding] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const lastKey = useRef(pageKey)
  const lastChat = useRef(0)
  const base = useId()
  const panelOpen = docked ? dockedOpen : drawerOpen

  // a new page starts at its top, with focus on it (as in the phone frame)
  useEffect(() => {
    if (pageKey === lastKey.current) return
    lastKey.current = pageKey
    mainRef.current?.scrollTo?.({ top: 0 })
    mainRef.current?.focus({ preventScroll: true })
  }, [pageKey])

  // close the drawer on Escape when in 900..1279px drawer mode
  useEffect(() => {
    if (docked || !drawerOpen) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, drawerOpen])

  const openPanel = useCallback((next: DeskPanelTab) => {
    setTab(next)
    writePanelTab(next)
    if (docked) {
      setDockedOpen(true)
      writePanelOpen(true)
    } else {
      setDrawerOpen(true)
    }
  }, [docked])

  const closePanel = useCallback(() => {
    if (docked) {
      setDockedOpen(false)
      writePanelOpen(false)
    } else {
      setDrawerOpen(false)
    }
  }, [docked])

  /** The message box arrives with the chat's own chunk, so look for it for a moment before giving up. */
  const focusComposer = useCallback(() => {
    let tries = 0
    const attempt = () => {
      const box = panelRef.current?.querySelector<HTMLTextAreaElement>('textarea')
      if (box) box.focus({ preventScroll: true })
      else if (++tries < 20) window.setTimeout(attempt, 60)
    }
    window.setTimeout(attempt, 0)
  }, [])

  const openChat = useCallback(() => {
    openPanel('chat')
    focusComposer()
  }, [openPanel, focusComposer])

  // the `chat` route asked for Bun: open the panel on the chat
  useEffect(() => {
    if (chatRequest === lastChat.current) return
    lastChat.current = chatRequest
    if (chatRequest > 0) openChat()
  }, [chatRequest, openChat])

  const actions = useMemo<DeskActions>(() => ({ addSpending: () => setAdding(true), addingSpending: adding, openChat }), [adding, openChat])

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const index = PANEL_TABS.indexOf(tab)
    const next = rovingIndex(index, e.key, PANEL_TABS.length, () => false)
    if (next === null) return
    e.preventDefault()
    openPanel(PANEL_TABS[next])
    tabRefs.current[next]?.focus()
  }

  const tabId = (t: DeskPanelTab) => `${base}-tab-${t}`
  const paneId = `${base}-pane`
  const badge = badgeText(awaiting)
  const settingsCurrent = route === 'settings'

  return (
    <div className={styles.shell} data-panel={panelOpen ? 'open' : 'closed'} data-panel-mode={docked ? 'docked' : 'drawer'} data-desk="">
      <SteamBackdrop variant="page" />
      <OverlayRootContext.Provider value={overlayRoot}>
        <TopBarSlotContext.Provider value={topSlot}>
          <DeskActionsContext.Provider value={actions}>
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

            <div className={styles.sidebar}>
              <a className={styles.brand} href={href('home')}>
                <Logo size={34} withWordmark />
              </a>

              <nav aria-label="Primary" className={styles.nav}>
                <ul className={styles.navList}>
                  {DESK_NAV.map((item) => {
                    const Icon = NAV_ICON[item.route] ?? LayoutDashboard
                    const current = item.route === route
                    const count = item.route === 'activity' ? badgeText(unseen) : null
                    return (
                      <li key={item.route}>
                        <a className={styles.navLink} href={href(item.route)} title={item.label} aria-current={current ? 'page' : undefined} aria-label={count ? `${item.label}, ${count} new` : undefined}>
                          <Icon aria-hidden="true" />
                          <span className={styles.navLabel}>{item.label}</span>
                          {count ? <span className={styles.navBadge} aria-hidden="true">{count}</span> : null}
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </nav>

              <div className={styles.sideActions}>
                <Button fullWidth iconStart={<Plus />} onClick={() => setAdding(true)} title="Add spending" className={styles.sideActionBtn}>
                  <span className={styles.sideActionLabel}>Add spending</span>
                </Button>
                <Button variant="secondary" size="sm" fullWidth iconStart={<Camera />} href={href('receipt')} title="Receipt or file" aria-current={route === 'receipt' ? 'page' : undefined} className={styles.sideActionBtn}>
                  <span className={styles.sideActionLabel}>Receipt or file</span>
                </Button>
              </div>

              <div className={styles.sideSpacer} />

              <div className={styles.sideFooter} data-slot="sidebar-footer">
                {sidebarFooter ?? (
                  <p className={styles.engine}>
                    <Cpu aria-hidden="true" />
                    <span>
                      <span className={styles.engineLabel}>Bun’s engine</span>
                      <span className={styles.engineValue}>{engine === 'llm' ? 'AI via LLM' : 'On-device rules engine'}</span>
                    </span>
                  </p>
                )}
              </div>

              <ul className={styles.sideBottom}>
                <li>
                  <a className={styles.navLink} href={href('settings')} title="Settings" aria-current={settingsCurrent ? 'page' : undefined}>
                    <Settings aria-hidden="true" />
                    <span className={styles.navLabel}>Settings</span>
                  </a>
                </li>
                <li>
                  <button type="button" className={cx(styles.navLink, styles.quiet)} title="Phone view" onClick={() => setViewPreference('phone')}>
                    <Smartphone aria-hidden="true" />
                    <span className={styles.navLabel}>Phone view</span>
                  </button>
                </li>
              </ul>
            </div>

            <div className={styles.center}>
              <header className={styles.topbar}>
                {parent ? <IconButton label="Back" icon={<ChevronLeft />} onClick={() => navigate(parent)} className={styles.back} /> : null}
                <div className={styles.titles}>
                  <h1 className={styles.title}>{title}</h1>
                  <p className={styles.date}>
                    {sandbox ? <span className={styles.demo}>Bank demo</span> : null}
                    <time dateTime={today}>{longDate(today)}</time>
                  </p>
                </div>
                <div className={styles.topActions}>
                  {/* Activity and Settings live in the sidebar here, so the bar keeps only the kill switch */}
                  <ShellActions compact />
                  {!panelOpen ? (
                    <button type="button" className={styles.askButton} onClick={openChat} aria-label={`Open the side panel: ${chatTabName(awaiting)}`}>
                      <BunMascot size={26} mood="happy" animated={false} />
                      <span aria-hidden="true">Ask Bun</span>
                      {badge ? <span className={styles.tabBadge} aria-hidden="true">{badge}</span> : null}
                    </button>
                  ) : null}
                </div>
              </header>
              <div className={styles.topSlot} ref={setTopSlot} />
              <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
                <SaveFailedBanner />
                <div className={column ? styles.column : styles.wide}>{children}</div>
              </main>
            </div>

            {!docked && panelOpen ? <div className={styles.drawerBackdrop} onClick={closePanel} aria-hidden="true" /> : null}

            {panelOpen ? (
              <aside ref={panelRef} className={cx(styles.panel, !docked && styles.panelDrawer)} data-mode={docked ? 'docked' : 'drawer'} aria-label="Bun: chat and glass box">
                <div className={styles.panelHead}>
                  <div role="tablist" aria-label="Side panel" className={styles.tabs} onKeyDown={onTabKey}>
                    {PANEL_TABS.map((t, i) => {
                      const selected = t === tab
                      return (
                        <button
                          key={t}
                          ref={(el) => {
                            tabRefs.current[i] = el
                          }}
                          id={tabId(t)}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          aria-controls={paneId}
                          aria-label={t === 'chat' ? chatTabName(awaiting) : undefined}
                          tabIndex={selected ? 0 : -1}
                          className={styles.tab}
                          onClick={() => openPanel(t)}
                        >
                          {t === 'chat' ? (
                            <>
                              <span aria-hidden="true">Ask Bun</span>
                              {badge ? <span className={styles.tabBadge} aria-hidden="true">{badge}</span> : null}
                            </>
                          ) : (
                            <>
                              <span>Glass box</span>
                              <span className={cx(styles.liveDot, busy && styles.liveBusy)} aria-hidden="true" />
                            </>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <IconButton label="Hide the side panel" icon={<PanelRightClose />} onClick={closePanel} />
                </div>
                <div role="tabpanel" id={paneId} aria-labelledby={tabId(tab)} className={styles.panelBody}>
                  {tab === 'chat' ? (
                    <div className={styles.chatPane}>
                      <div className={styles.chatScroll}>{chat}</div>
                    </div>
                  ) : (
                    <div className={styles.glassPane}>
                      <div className={styles.glassScroll}>
                        <p className={styles.glassLead}>
                          What the agent sees, decides and records, live.
                          <span className={cx(styles.live, busy && styles.liveOn)}>{busy ? 'Working' : 'Live'}</span>
                        </p>
                        {glassBox}
                      </div>
                      <p className={styles.glassFoot}>
                        <ShieldCheck aria-hidden="true" />
                        <span>The model proposes; the policy engine decides. Every step is hash-chained on this device.</span>
                      </p>
                    </div>
                  )}
                </div>
              </aside>
            ) : null}

            <QuickAdd open={adding} onClose={() => setAdding(false)} />
            <div ref={setOverlayRoot} className={styles.overlayRoot} />
            {overlayRoot ? <ToastViewport /> : null}
          </DeskActionsContext.Provider>
        </TopBarSlotContext.Provider>
      </OverlayRootContext.Provider>
    </div>
  )
}
