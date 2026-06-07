import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { startServer, type RunningServer } from '../server/index'
import { resolveBinary } from '../server/ffmpegPath'

// ── 設定の永続化 ───────────────────────────────────────────────────────────
// データ(json/mov)はアプリに同梱しない。ユーザーが起動時に各フォルダを指定し、
// 選択結果を userData の config.json に保存する。
interface Config {
  jsonDir?: string
  movDir?: string
}

const userDataDir = app.getPath('userData')
const configPath = path.join(userDataDir, 'config.json')
const thumbDir = path.join(userDataDir, 'thumbs')

function loadConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Config
  } catch {
    return {}
  }
}

function saveConfig(cfg: Config) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
  } catch (e) {
    console.error('Failed to save config:', e)
  }
}

function dirExists(p?: string): boolean {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

let config: Config = loadConfig()
let running: RunningServer | null = null
let win: BrowserWindow | null = null

// ── フォルダ選択（json / mov を個別に指定） ──────────────────────────────────
async function promptDir(title: string, message: string, defaultPath?: string): Promise<string | null> {
  const res = await dialog.showOpenDialog({
    title,
    message,
    properties: ['openDirectory'],
    defaultPath: dirExists(defaultPath) ? defaultPath : undefined,
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
}

async function selectJsonDir(): Promise<string | null> {
  return promptDir(
    'JSON フォルダを選択',
    'Sora のエクスポート JSON（*-generations.json）があるフォルダを選択してください。',
    config.jsonDir,
  )
}

async function selectMovDir(): Promise<string | null> {
  return promptDir(
    'mov フォルダを選択',
    'MP4（{generation_id}.mp4）があるフォルダを選択してください。',
    config.movDir,
  )
}

/** 起動に必要な json/mov を確定する。未取得なら順に選択させる。キャンセルなら null（=起動中止） */
async function ensureDataDirs(): Promise<Config | null> {
  let jsonDir = config.jsonDir
  let movDir = config.movDir

  if (!dirExists(jsonDir)) {
    jsonDir = (await selectJsonDir()) ?? undefined
    if (!jsonDir) return null
  }
  if (!dirExists(movDir)) {
    movDir = (await selectMovDir()) ?? undefined
    if (!movDir) return null
  }

  config = { ...config, jsonDir, movDir }
  saveConfig(config)
  return { jsonDir, movDir }
}

// ── サーバー起動 / 再起動 ────────────────────────────────────────────────────
async function startOrRestartServer(jsonDir: string, movDir: string, port?: number) {
  if (running) {
    await running.close()
    running = null
  }

  const ffmpegPath = resolveBinary('ffmpeg') ?? undefined
  const ffprobePath = resolveBinary('ffprobe') ?? undefined

  // パッケージ後の renderer は app(.asar) 内の dist/。fs は asar を透過的に読める。
  const distDir = path.join(app.getAppPath(), 'dist')

  running = await startServer({
    port: port ?? 3001,
    hostname: '127.0.0.1',
    jsonDir,
    movDir,
    thumbDir,
    distDir,
    ffmpegPath,
    ffprobePath,
  })

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

// EADDRINUSE 時はエフェメラルポートにフォールバック
async function startServerWithFallback(jsonDir: string, movDir: string, port = 3001) {
  try {
    return await startOrRestartServer(jsonDir, movDir, port)
  } catch (e) {
    console.warn(`Port ${port} unavailable, falling back to an ephemeral port:`, e)
    return await startOrRestartServer(jsonDir, movDir, 0)
  }
}

async function reloadAfterDirChange() {
  if (!config.jsonDir || !config.movDir) return
  await startOrRestartServer(config.jsonDir, config.movDir, running?.port)
  if (win) await loadWithRetry(win, rendererUrl())
}

// ── ウィンドウ ───────────────────────────────────────────────────────────────
function rendererUrl(): string {
  // dev: Vite。prod: Hono が dist を配信。
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return devUrl
  return `http://127.0.0.1:${running?.port ?? 3001}`
}

async function loadWithRetry(window: BrowserWindow, url: string, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      await window.loadURL(url)
      return
    } catch (e) {
      if (i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 300))
    }
  }
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
    },
  })

  // 外部リンクは既定ブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    win = null
  })

  void loadWithRetry(win, rendererUrl())
}

// ── アプリケーションメニュー ─────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'ファイル',
      submenu: [
        {
          label: 'JSON フォルダを選択…',
          click: async () => {
            const dir = await selectJsonDir()
            if (!dir) return
            config = { ...config, jsonDir: dir }
            saveConfig(config)
            await reloadAfterDirChange()
          },
        },
        {
          label: 'mov フォルダを選択…',
          click: async () => {
            const dir = await selectMovDir()
            if (!dir) return
            config = { ...config, movDir: dir }
            saveConfig(config)
            await reloadAfterDirChange()
          },
        },
        { type: 'separator' as const },
        {
          label: 'ブラウザで開く',
          click: () => {
            shell.openExternal(`http://127.0.0.1:${running?.port ?? 3001}`)
          },
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

  const dirs = await ensureDataDirs()
  if (!dirs) {
    app.quit()
    return
  }

  await startServerWithFallback(dirs.jsonDir!, dirs.movDir!)
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
