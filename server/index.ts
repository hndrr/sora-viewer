import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { resolveBinary } from './ffmpegPath'

// Web モード(npm run dev / serve)は常にプロジェクトルートから起動されるため cwd を基準にする。
// デスクトップ(Electron)は全ディレクトリを明示指定するためこの既定値は使われない。
const ROOT_DIR = process.cwd()

// ── Options ──────────────────────────────────────────────────────────────────
export interface ServerOptions {
  port?: number
  hostname?: string
  jsonDir?: string
  movDir?: string
  thumbDir?: string
  /** json/mov の選択結果を保存する config ファイルの絶対パス */
  configPath?: string
  /** ビルド済みフロント(dist)の絶対パス。指定かつ存在する場合のみ静的配信を有効化 */
  distDir?: string | null
  ffmpegPath?: string
  ffprobePath?: string
}

export interface RunningServer {
  server: ReturnType<typeof serve>
  port: number
  hostname: string
  configPath: string
  thumbDir: string
  ffmpegFound: boolean
  ffprobeFound: boolean
  close: () => Promise<void>
}

// ── 汎用ヘルパー ─────────────────────────────────────────────────────────────
function dirExists(p?: string): boolean {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function readConfigFile(p: string): { jsonDir?: string; movDir?: string } {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeConfigFile(p: string, data: { jsonDir?: string; movDir?: string }) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error('Failed to save config:', e)
  }
}

// 指定フォルダの中身を数えて「正しいフォルダか」を設定画面で示す
function countJson(dir?: string): number {
  if (!dirExists(dir)) return 0
  let n = 0
  try {
    for (const name of fs.readdirSync(dir!)) {
      if (name.startsWith('._')) continue
      const full = path.join(dir!, name)
      try {
        const st = fs.statSync(full)
        if (st.isFile() && name.endsWith('-generations.json')) n++
        else if (st.isDirectory() && fs.existsSync(path.join(full, 'generations.json'))) n++
      } catch {
        // ignore
      }
    }
  } catch {
    return 0
  }
  return n
}

function countMov(dir?: string): number {
  if (!dirExists(dir)) return 0
  try {
    return fs.readdirSync(dir!).filter(f => f.endsWith('.mp4') && !f.startsWith('._')).length
  } catch {
    return 0
  }
}

function isSafeMediaId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id)
}

// サーバー側フォルダブラウザ用: ディレクトリの一覧を返す
function browseDir(p?: string) {
  const target = dirExists(p) ? path.resolve(p!) : os.homedir()
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter(d => {
      if (d.name.startsWith('.')) return false
      try {
        return fs.statSync(path.join(target, d.name)).isDirectory()
      } catch {
        return false
      }
    })
    .map(d => ({ name: d.name, path: path.join(target, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const parent = path.dirname(target)
  return {
    path: target,
    parent: parent === target ? null : parent,
    home: os.homedir(),
    entries,
  }
}

// ── マニフェスト読み込み ─────────────────────────────────────────────────────
function loadManifest(jsonDir: string, movDir: string) {
  const mp4Set = new Set(
    fs.readdirSync(movDir)
      .filter(f => f.endsWith('.mp4') && !f.startsWith('._'))
      .map(f => f.replace('.mp4', ''))
  )

  const entries: Record<string, unknown>[] = []

  for (const name of fs.readdirSync(jsonDir).sort()) {
    const fullPath = path.join(jsonDir, name)
    const stat = fs.statSync(fullPath)

    if (stat.isFile() && name.endsWith('-generations.json') && !name.startsWith('._')) {
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as Record<string, unknown>[]
      for (const e of raw) {
        e._source = name
        e._local  = mp4Set.has(e.id as string)
      }
      entries.push(...raw)
    } else if (stat.isDirectory()) {
      const genFile = path.join(fullPath, 'generations.json')
      if (fs.existsSync(genFile)) {
        const raw = JSON.parse(fs.readFileSync(genFile, 'utf-8')) as Record<string, unknown>[]
        for (const e of raw) {
          e._source = `${name}/generations.json`
          e._local  = mp4Set.has(e.id as string)
        }
        entries.push(...raw)
      }
    }
  }

  const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz'
  function idToTimestamp(id: string): number {
    const raw = id.startsWith('gen_') ? id.slice(4) : id
    if (raw.startsWith('01k') || raw.startsWith('01j') || raw.startsWith('01m')) {
      let ts = 0
      for (let i = 0; i < Math.min(10, raw.length); i++) {
        ts = ts * 32 + CROCKFORD.indexOf(raw[i].toLowerCase())
      }
      return ts
    } else {
      return parseInt(raw.slice(0, 8), 16) * 1000
    }
  }

  const seen = new Set<string>()
  const unique = entries.filter(e => {
    const id = e.id as string
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  unique.sort((a, b) => idToTimestamp(b.id as string) - idToTimestamp(a.id as string))

  console.log(`✓ ${unique.length} entries  (${unique.filter(e => e._local).length} with local mp4, ${entries.length - unique.length} duplicates removed)`)
  console.log(`  JSON_DIR: ${jsonDir}`)
  console.log(`  MOV_DIR:  ${movDir}`)
  return unique
}

// ── ffmpeg 実行ラッパー ─────────────────────────────────────────────────────
function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, (err) => (err ? reject(err) : resolve()))
  })
}

type VideoMeta = { fps: number; frames: number; width: number; height: number; duration: number }
function probeVideo(ffprobe: string, videoPath: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    execFile(ffprobe, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=r_frame_rate,nb_frames,width,height,duration:format=duration',
      '-of', 'json',
      videoPath,
    ], (err, stdout) => {
      if (err) return reject(err)
      try {
        const j = JSON.parse(stdout)
        const s = j.streams?.[0] ?? {}
        const [num, den] = String(s.r_frame_rate ?? '0/1').split('/').map(Number)
        const fps = den ? num / den : 0
        const duration = Number(s.duration ?? j.format?.duration ?? 0)
        let frames = Number(s.nb_frames)
        if (!Number.isFinite(frames) || frames <= 0) {
          frames = fps && duration ? Math.round(fps * duration) : 0
        }
        resolve({ fps, frames, width: Number(s.width) || 0, height: Number(s.height) || 0, duration })
      } catch (e) {
        reject(e)
      }
    })
  })
}

function generateThumbnail(ffmpeg: string, videoPath: string, thumbPath: string): Promise<void> {
  return runFfmpeg(ffmpeg, ['-i', videoPath, '-ss', '0.5', '-vframes', '1', '-vf', 'scale=480:-2', '-q:v', '6', '-y', thumbPath])
}

// ── 静的ファイル配信 (絶対パス対応) ──────────────────────────────────────────
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}
function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

// ── 可変状態 ─────────────────────────────────────────────────────────────────
interface State {
  jsonDir?: string
  movDir?: string
  manifest: Record<string, unknown>[]
}

interface AppConfig {
  state: State
  thumbDir: string
  configPath: string
  distDir: string | null
  ffmpeg: string
  ffprobe: string
}

function createApp(cfg: AppConfig) {
  const { state, thumbDir, configPath, distDir, ffmpeg, ffprobe } = cfg
  const app = new Hono()
  app.use('*', cors())

  function configStatus() {
    return {
      jsonDir: state.jsonDir ?? null,
      movDir: state.movDir ?? null,
      jsonCount: countJson(state.jsonDir),
      movCount: countMov(state.movDir),
      configured: dirExists(state.jsonDir) && dirExists(state.movDir),
    }
  }

  // ── 設定 API ────────────────────────────────────────────────────────────
  app.get('/api/config', c => c.json(configStatus()))

  app.post('/api/config', async c => {
    const body = await c.req.json().catch(() => ({} as { jsonDir?: string; movDir?: string }))
    if (body.jsonDir !== undefined) {
      if (!dirExists(body.jsonDir)) return c.json({ error: `JSON フォルダが存在しません: ${body.jsonDir}` }, 400)
      state.jsonDir = path.resolve(body.jsonDir)
    }
    if (body.movDir !== undefined) {
      if (!dirExists(body.movDir)) return c.json({ error: `mov フォルダが存在しません: ${body.movDir}` }, 400)
      state.movDir = path.resolve(body.movDir)
    }
    if (dirExists(state.jsonDir) && dirExists(state.movDir)) {
      try {
        state.manifest = loadManifest(state.jsonDir!, state.movDir!)
      } catch (e) {
        return c.json({ error: `読み込みに失敗しました: ${String(e)}` }, 500)
      }
    }
    writeConfigFile(configPath, { jsonDir: state.jsonDir, movDir: state.movDir })
    return c.json(configStatus())
  })

  // ── サーバー側フォルダブラウザ ────────────────────────────────────────────
  app.get('/api/browse', c => {
    try {
      return c.json(browseDir(c.req.query('path')))
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  app.get('/api/manifest', c => c.json(state.manifest))

  app.get('/thumbnail/:id', async c => {
    const id = c.req.param('id')
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400)
    if (!state.movDir) return c.notFound()
    const thumbPath = path.join(thumbDir, `${id}.jpg`)
    const videoPath = path.join(state.movDir, `${id}.mp4`)
    if (!fs.existsSync(videoPath)) return c.notFound()
    if (!fs.existsSync(thumbPath)) {
      try {
        await generateThumbnail(ffmpeg, videoPath, thumbPath)
      } catch (e) {
        console.error(`Thumbnail generation failed for ${id}:`, e)
        return c.text('Thumbnail generation failed', 500)
      }
    }
    const data = fs.readFileSync(thumbPath)
    return new Response(data, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } })
  })

  app.get('/audio/:id', async c => {
    const id = c.req.param('id')
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400)
    if (!state.movDir) return c.notFound()
    const videoPath = path.join(state.movDir, `${id}.mp4`)
    if (!fs.existsSync(videoPath)) return c.notFound()
    const format = c.req.query('format') === 'm4a' ? 'm4a' : 'mp3'
    const outPath = path.join(os.tmpdir(), `sora-${id}-${Date.now()}.${format}`)
    const codecArgs = format === 'mp3' ? ['-q:a', '2'] : ['-c:a', 'copy']
    try {
      await runFfmpeg(ffmpeg, ['-i', videoPath, '-vn', ...codecArgs, '-y', outPath])
      const data = fs.readFileSync(outPath)
      fs.unlinkSync(outPath)
      return new Response(data, {
        headers: {
          'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/mp4',
          'Content-Disposition': `attachment; filename="${id}.${format}"`,
        },
      })
    } catch (e) {
      console.error(`Audio extraction failed for ${id}:`, e)
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
      return c.text('Audio extraction failed', 500)
    }
  })

  app.get('/meta/:id', async c => {
    const id = c.req.param('id')
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400)
    if (!state.movDir) return c.notFound()
    const videoPath = path.join(state.movDir, `${id}.mp4`)
    if (!fs.existsSync(videoPath)) return c.notFound()
    try {
      return c.json(await probeVideo(ffprobe, videoPath))
    } catch (e) {
      console.error(`Probe failed for ${id}:`, e)
      return c.text('Probe failed', 500)
    }
  })

  app.get('/frame/:id', async c => {
    const id = c.req.param('id')
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400)
    if (!state.movDir) return c.notFound()
    const videoPath = path.join(state.movDir, `${id}.mp4`)
    if (!fs.existsSync(videoPath)) return c.notFound()
    const n = parseInt(c.req.query('n') ?? '', 10)
    if (!Number.isInteger(n) || n < 0) return c.text('Invalid frame number', 400)
    const outPath = path.join(os.tmpdir(), `sora-${id}-frame${n}-${Date.now()}.png`)
    try {
      await runFfmpeg(ffmpeg, ['-i', videoPath, '-vf', `select=eq(n\\,${n})`, '-vframes', '1', '-y', outPath])
      if (!fs.existsSync(outPath)) return c.text('Frame not found', 404)
      const data = fs.readFileSync(outPath)
      fs.unlinkSync(outPath)
      return new Response(data, {
        headers: { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${id}_frame${n}.png"` },
      })
    } catch (e) {
      console.error(`Frame extraction failed for ${id} (n=${n}):`, e)
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
      return c.text('Frame extraction failed', 500)
    }
  })

  app.get('/video/:id', async c => {
    const id = c.req.param('id')
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400)
    if (!state.movDir) return c.notFound()
    const fp = path.join(state.movDir, `${id}.mp4`)
    if (!fs.existsSync(fp)) return c.notFound()
    const size = fs.statSync(fp).size
    const range = c.req.header('range')
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-')
      const start = parseInt(s, 10)
      const end = e ? parseInt(e, 10) : size - 1
      const chunk = end - start + 1
      const stream = fs.createReadStream(fp, { start, end })
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(chunk),
          'Accept-Ranges': 'bytes',
        },
      })
    }
    const stream = fs.createReadStream(fp)
    return new Response(stream as unknown as ReadableStream, {
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    })
  })

  // ── ビルド済みフロントの配信（distDir 指定かつ存在する場合のみ） ────────────
  if (distDir && fs.existsSync(distDir)) {
    app.get('*', c => {
      const urlPath = decodeURIComponent(new URL(c.req.url).pathname)
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
      let filePath = path.resolve(distDir, rel)
      const inside = filePath === distDir || filePath.startsWith(distDir + path.sep)
      if (!inside || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html')
        if (!fs.existsSync(filePath)) return c.notFound()
      }
      const data = fs.readFileSync(filePath)
      return new Response(data, { headers: { 'Content-Type': mimeFor(filePath) } })
    })
  }

  return app
}

// ── 起動 ─────────────────────────────────────────────────────────────────────
export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const hostname = opts.hostname ?? '127.0.0.1'
  const thumbDir = path.resolve(opts.thumbDir ?? path.join(ROOT_DIR, '.thumbs'))
  const configPath = path.resolve(opts.configPath ?? process.env.SORA_CONFIG ?? path.join(ROOT_DIR, '.sora-viewer.json'))
  const distDir = opts.distDir === undefined ? path.join(ROOT_DIR, 'dist') : opts.distDir
  const distAbs = distDir ? path.resolve(distDir) : null

  // 初期ディレクトリ: 保存済み config > opts > env > 既定(json/・mov/)。最初に存在するものを採用。
  const saved = readConfigFile(configPath)
  const firstExisting = (...cands: (string | undefined)[]) => {
    for (const c of cands) if (dirExists(c)) return path.resolve(c!)
    return undefined
  }
  const jsonDir = firstExisting(saved.jsonDir, opts.jsonDir, process.env.SORA_JSON_DIR, path.join(ROOT_DIR, 'json'))
  const movDir = firstExisting(saved.movDir, opts.movDir, process.env.SORA_MOV_DIR, path.join(ROOT_DIR, 'mov'))

  const ffmpegResolved = opts.ffmpegPath ?? resolveBinary('ffmpeg')
  const ffprobeResolved = opts.ffprobePath ?? resolveBinary('ffprobe')
  const ffmpeg = ffmpegResolved ?? 'ffmpeg'
  const ffprobe = ffprobeResolved ?? 'ffprobe'
  if (!ffmpegResolved) console.warn('⚠ ffmpeg が見つかりません。サムネイル/音声/フレーム書き出しは無効になります。')
  if (!ffprobeResolved) console.warn('⚠ ffprobe が見つかりません。メタ情報取得は無効になります。')

  if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true })

  const configured = dirExists(jsonDir) && dirExists(movDir)
  const state: State = {
    jsonDir,
    movDir,
    manifest: configured ? loadManifest(jsonDir!, movDir!) : [],
  }
  if (!configured) console.log('ℹ データ未設定。設定画面で json/mov フォルダを指定してください。')

  const app = createApp({ state, thumbDir, configPath, distDir: distAbs, ffmpeg, ffprobe })

  return new Promise<RunningServer>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: opts.port ?? 3001, hostname }, (info) => {
      const port = info.port
      console.log(`🎬 Sora server → http://${hostname}:${port}`)
      resolve({
        server,
        port,
        hostname,
        configPath,
        thumbDir,
        ffmpegFound: !!ffmpegResolved,
        ffprobeFound: !!ffprobeResolved,
        close: () => new Promise<void>((res) => server.close(() => res())),
      })
    })
    ;(server as unknown as NodeJS.EventEmitter).on('error', reject)
  })
}
