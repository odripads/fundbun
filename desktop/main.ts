/**
 * FundBun for the desktop: an Electron window around the same app, with FundBun's own server running inside it
 * on an address only this computer can reach. The server keeps the user's AI connections (keys go through the
 * system keychain here) and starts the agents; the window is an ordinary sandboxed web page with no Node access.
 */
import { app, BrowserWindow, Menu, dialog, safeStorage, session, shell, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAIN_CODEC, type SecretCodec } from '../server/ai/store'
import { LOCAL_PORT, startLocal, type LocalServer } from '../server/local'

const here = dirname(fileURLToPath(import.meta.url))
let local: LocalServer | null = null
let win: BrowserWindow | null = null

/** Keys encrypted with the key the operating system keeps for this app (the Keychain on a Mac). */
function keychainCodec(): SecretCodec {
  if (!safeStorage.isEncryptionAvailable()) return PLAIN_CODEC
  return {
    describe: process.platform === 'darwin' ? 'Keys are encrypted with your Mac’s Keychain and kept on this computer.' : 'Keys are encrypted by your operating system and kept on this computer.',
    encode: (plain) => `safe:${safeStorage.encryptString(plain).toString('base64')}`,
    decode: (stored) => (stored.startsWith('safe:') ? safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64')) : PLAIN_CODEC.decode(stored)),
  }
}

function isOurs(url: string): boolean {
  return local !== null && (url === local.url || url.startsWith(`${local.url}/`))
}

function openOutside(url: string): void {
  // only ordinary web links leave the app, and they open in the user's own browser
  if (/^https:\/\//i.test(url)) void shell.openExternal(url)
}

function createWindow(): void {
  if (!local) return
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 380,
    minHeight: 620,
    title: 'FundBun',
    backgroundColor: '#fffaf2',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isOurs(url)) return
    event.preventDefault()
    openOutside(url)
  })
  void win.loadURL(local.url)
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'FundBun on GitHub', click: () => openOutside('https://github.com/odripads/fundbun') }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function start(): Promise<void> {
  // the web page asks for nothing from the system: no camera, microphone, location or notifications
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false))
  const dist = join(here, 'dist')
  try {
    local = await startLocal({
      port: Number(process.env.FUNDBUN_LOCAL_PORT) || LOCAL_PORT,
      home: process.env.FUNDBUN_HOME?.trim() || join(homedir(), '.fundbun'),
      distDir: existsSync(dist) ? dist : null,
      codec: keychainCodec(),
      bridgeScript: join(here, 'mcp-bridge.mjs'),
      // the agents start FundBun's bridge with this program acting as plain Node
      nodePath: process.execPath,
      nodeEnv: { ELECTRON_RUN_AS_NODE: '1' },
      env: {},
      log: () => undefined,
    })
  } catch (err) {
    const busy = (err as { code?: string }).code === 'EADDRINUSE'
    dialog.showErrorBox('FundBun could not start', busy ? 'Another program is using the address FundBun needs on this computer. Close it (or a second FundBun) and try again.' : 'FundBun’s own server did not start.')
    app.quit()
    return
  }
  buildMenu()
  createWindow()
}

app.setName('FundBun')
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (!win && local) createWindow()
  })
  app.on('before-quit', () => {
    // stop any agent FundBun started
    local?.agents.close()
  })
  void app.whenReady().then(start)
}
