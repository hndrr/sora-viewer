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
  /** ビルド済みフロント(dist)の絶対パス。指定かつ存在する場合のみ静的配信を有効化 */
  distDir?: string | null
  ffmpegPath?: string
  ffprobePath?: string
}

export interface RunningServer {
  server: ReturnType<typeof serve>
  port: number
  hostname: string
  jsonDir: string
  movDir: string
  thumbDir: string
  manifestCount: number
  ffmpegFound: boolean
  ffprobeFound: boolean
  close: () => Promise<void>
}

// ── Load manifest ──────────────────────────────────────────────────────────
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
      // パターン1: json/sora-data-files-export-1-generations.json
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as Record<string, unknown>[]
      for (const e of raw) {
        e._source = name
        e._local  = mp4Set.has(e.id as string)
      }
      entries.push(...raw)
    } else if (stat.isDirectory()) {
      // パターン2: json/sora-data-files-export-1/generations.json
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

  // IDから時系列でソート（新しい順）
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

  // IDベースの重複排除（複数JSONに同じエントリがある場合）
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
    execFile(ffmpeg, args, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// ── 動画メタ情報の取得 (ffprobe) ─────────────────────────────────────────────
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
        resolve({
          fps,
          frames,
          width: Number(s.width) || 0,
          height: Number(s.height) || 0,
          duration,
        })
      } catch (e) {
        reject(e)
      }
    })
  })
}

// ── サムネイル生成 (ffmpeg) ────────────────────────────────────────────────
function generateThumbnail(ffmpeg: string, videoPath: string, thumbPath: string): Promise<void> {
  return runFfmpeg(ffmpeg, [
    '-i', videoPath,
    '-ss', '0.5',
    '-vframes', '1',
    '-vf', 'scale=480:-2',
    '-q:v', '6',
    '-y',
    thumbPath,
  ])
}

// ── 静的ファイル配信 (絶対パス対応の手動ハンドラ) ────────────────────────────
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}
function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

// ── App 生成 ─────────────────────────────────────────────────────────────────
interface AppConfig {
  manifest: Record<string, unknown>[]
  movDir: string
  thumbDir: string
  distDir: string | null
  ffmpeg: string
  ffprobe: string
}

function createApp(cfg: AppConfig) {
  const { manifest, movDir, thumbDir, distDir, ffmpeg, ffprobe } = cfg
  const app = new Hono()
  app.use('*', cors())

  app.get('/api/manifest', c => c.json(manifest))

  app.get('/thumbnail/:id', async c => {
    const id = c.req.param('id')
    const thumbPath = path.join(thumbDir, `${id}.jpg`)
    const videoPath = path.join(movDir, `${id}.mp4`)

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
    return new Response(data, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  })

  // ── 音声書き出し ───────────────────────────────────────────────────────────
  app.get('/audio/:id', async c => {
    const id = c.req.param('id')
    const videoPath = path.join(movDir, `${id}.mp4`)
    if (!fs.existsSync(videoPath)) return c.notFound()

    const format = c.req.query('format') === 'm4a' ? 'm4a' : 'mp3'
    const outPath = path.join(os.tmpdir(), `sora-${id}-${Date.now()}.${format}`)

    // mp3 は再エンコード、m4a は AAC をそのままコピー（無劣化）
    const codecArgs = format === 'mp3'
      ? ['-q:a', '2']
      : ['-c:a', 'copy']

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

  // ── 動画メタ情報 (fps / 総フレーム数) ──────────────────────────────────────
  app.get('/meta/:id', async c => {
    const id = c.req.param('id')
    const videoPath = path.join(movDir, `${id}.mp4`)
    if (!fs.existsSync(videoPath)) return c.notFound()
    try {
      return c.json(await probeVideo(ffprobe, videoPath))
    } catch (e) {
      console.error(`Probe failed for ${id}:`, e)
      return c.text('Probe failed', 500)
    }
  })

  // ── 任意フレームの抽出 ─────────────────────────────────────────────────────
  app.get('/frame/:id', async c => {
    const id = c.req.param('id')
    const videoPath = path.join(movDir, `${id}.mp4`)
    if (!fs.existsSync(videoPath)) return c.notFound()

    const n = parseInt(c.req.query('n') ?? '', 10)
    if (!Number.isInteger(n) || n < 0) return c.text('Invalid frame number', 400)

    const outPath = path.join(os.tmpdir(), `sora-${id}-frame${n}-${Date.now()}.png`)

    try {
      // select フィルタで n 番目のフレームのみを通し、-vframes 1 で確定
      await runFfmpeg(ffmpeg, ['-i', videoPath, '-vf', `select=eq(n\\,${n})`, '-vframes', '1', '-y', outPath])
      if (!fs.existsSync(outPath)) return c.text('Frame not found', 404)
      const data = fs.readFileSync(outPath)
      fs.unlinkSync(outPath)
      return new Response(data, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="${id}_frame${n}.png"`,
        },
      })
    } catch (e) {
      console.error(`Frame extraction failed for ${id} (n=${n}):`, e)
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
      return c.text('Frame extraction failed', 500)
    }
  })

  app.get('/video/:id', async c => {
    const id  = c.req.param('id')
    const fp  = path.join(movDir, `${id}.mp4`)
    if (!fs.existsSync(fp)) return c.notFound()

    const size  = fs.statSync(fp).size
    const range = c.req.header('range')

    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-')
      const start  = parseInt(s, 10)
      const end    = e ? parseInt(e, 10) : size - 1
      const chunk  = end - start + 1

      const stream = fs.createReadStream(fp, { start, end })
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type':  'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(chunk),
          'Accept-Ranges': 'bytes',
        },
      })
    }

    const stream = fs.createReadStream(fp)
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type':   'video/mp4',
        'Content-Length': String(size),
        'Accept-Ranges':  'bytes',
      },
    })
  })

  // ── ビルド済みフロントの配信（distDir 指定かつ存在する場合のみ） ────────────
  if (distDir && fs.existsSync(distDir)) {
    app.get('*', c => {
      const urlPath = decodeURIComponent(new URL(c.req.url).pathname)
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
      let filePath = path.resolve(distDir, rel)

      // ディレクトリトラバーサル防止 + SPA フォールバック
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
  const jsonDir = path.resolve(opts.jsonDir ?? process.env.SORA_JSON_DIR ?? path.join(ROOT_DIR, 'json'))
  const movDir  = path.resolve(opts.movDir  ?? process.env.SORA_MOV_DIR  ?? path.join(ROOT_DIR, 'mov'))
  const thumbDir = path.resolve(opts.thumbDir ?? path.join(ROOT_DIR, '.thumbs'))
  const distDir = opts.distDir === undefined
    ? path.join(ROOT_DIR, 'dist')   // CLI(web) 既定: プロジェクトの dist
    : opts.distDir
  const distAbs = distDir ? path.resolve(distDir) : null

  // ffmpeg / ffprobe の解決（指定 > PATH/既知の場所 > 'ffmpeg' フォールバック）
  const ffmpegResolved  = opts.ffmpegPath  ?? resolveBinary('ffmpeg')
  const ffprobeResolved = opts.ffprobePath ?? resolveBinary('ffprobe')
  const ffmpeg  = ffmpegResolved  ?? 'ffmpeg'
  const ffprobe = ffprobeResolved ?? 'ffprobe'
  if (!ffmpegResolved)  console.warn('⚠ ffmpeg が見つかりません。サムネイル/音声/フレーム書き出しは無効になります。')
  if (!ffprobeResolved) console.warn('⚠ ffprobe が見つかりません。メタ情報取得は無効になります。')

  // サムネイルキャッシュディレクトリを作成
  if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true })

  const manifest = loadManifest(jsonDir, movDir)
  const app = createApp({ manifest, movDir, thumbDir, distDir: distAbs, ffmpeg, ffprobe })

  return new Promise<RunningServer>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: opts.port ?? 3001, hostname }, (info) => {
      const port = info.port
      console.log(`🎬 Sora server → http://${hostname}:${port}`)
      resolve({
        server,
        port,
        hostname,
        jsonDir,
        movDir,
        thumbDir,
        manifestCount: manifest.length,
        ffmpegFound: !!ffmpegResolved,
        ffprobeFound: !!ffprobeResolved,
        close: () => new Promise<void>((res) => server.close(() => res())),
      })
    })
    // listen 前のエラー(EADDRINUSE 等)を補足。resolve 済みの場合は no-op。
    ;(server as unknown as NodeJS.EventEmitter).on('error', reject)
  })
}
