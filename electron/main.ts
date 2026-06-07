import { app, BrowserWindow, dialog, Menu, shell, ipcMain } from 'electron'
import path from 'path'
import { startServer, type RunningServer } from '../server/index'
import { resolveBinary } from '../server/ffmpegPath'

// データ(json/mov)はアプリに同梱しない。設定はサーバー(Hono)が所有し、
// 選択結果は userData の config.json に保存される。Electron は薄いシェルとして
// サーバーを起動し、ウィンドウをそのサーバーに向けるだけ。
const userDataDir = app.getPath('userData')
const configPath = path.join(userDataDir, 'config.json')
const thumbDir = path.join(userDataDir, 'thumbs')
const preloadPath = path.join(app.getAppPath(), 'dist-electron', 'preload.cjs')

let running: RunningServer | null = null
let win: BrowserWindow | null = null

function rendererBase(): string {
  return process.env.ELECTRON_RENDERER_URL ?? `http://127.0.0.1:${running?.port ?? 3001}`
}

async function loadWithRetry(window: BrowserWindow, url: string, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    if (window.isDestroyed()) return
    try {
      await window.loadURL(url)
      return
    } catch (e) {
      if (window.isDestroyed()) return
      if (i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 300))
    }
  }
}

async function startServerOnce() {
  const ffmpegPath = resolveBinary('ffmpeg') ?? undefined
  const ffprobePath = resolveBinary('ffprobe') ?? undefined
  const distDir = path.join(app.getAppPath(), 'dist')

  const tryStart = (port: number) =>
    startServer({ port, hostname: '127.0.0.1', configPath, thumbDir, distDir, ffmpegPath, ffprobePath })

  try {
    running = await tryStart(3001)
  } catch (e) {
    console.warn('Port 3001 unavailable, falling back to an ephemeral port:', e)
    running = await tryStart(0)
  }

  if (!running.ffmpegFound || !running.ffprobeFound) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'ffmpeg が見つかりません',
      message: 'ffmpeg / ffprobe が見つかりませんでした。',
      detail:
        'サムネイル・音声書き出し・フレーム抽出・メタ情報取得が無効になります。\n' +
        'インストール後に再起動してください（macOS: brew install ffmpeg）。\n' +
        '動画の再生自体には影響しません。',
    })
  }
  return running
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#161616',
    title: 'Sora Viewer',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => { win = null })
  void loadWithRetry(win, rendererBase())
}

// ── ネイティブのフォルダ選択（設定画面の「選択」ボタン用） ────────────────────
ipcMain.handle('dir:pick', async (_e, opts: { title?: string; defaultPath?: string }) => {
  const res = await dialog.showOpenDialog(win ?? undefined!, {
    title: opts?.title,
    properties: ['openDirectory'],
    defaultPath: opts?.defaultPath || undefined,
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
})

// ── メニュー ─────────────────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'ファイル',
      submenu: [
        {
          label: 'データ設定…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const base = rendererBase()
            const url = base + (base.includes('?') ? '&' : '?') + 'setup=1'
            if (win) void loadWithRetry(win, url)
          },
        },
        { type: 'separator' as const },
        {
          label: 'ブラウザで開く',
          click: () => shell.openExternal(`http://127.0.0.1:${running?.port ?? 3001}`),
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' as const },
    { role: 'viewMenu' as const },
    { role: 'windowMenu' as const },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── ライフサイクル ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  buildMenu()
  await startServerOnce()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  if (running) {
    await running.close()
    running = null
  }
})
