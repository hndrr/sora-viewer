import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const JSON_DIR = process.env.SORA_JSON_DIR
  ? path.resolve(process.env.SORA_JSON_DIR)
  : path.resolve(__dirname, 'json')
const MOV_DIR = process.env.SORA_MOV_DIR
  ? path.resolve(process.env.SORA_MOV_DIR)
  : path.resolve(__dirname, 'mov')
const THUMB_DIR = path.resolve(__dirname, '.thumbs')

// サムネイルキャッシュディレクトリを作成
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true })

// ── Load manifest ──────────────────────────────────────────────────────────
function loadManifest() {
  const mp4Set = new Set(
    fs.readdirSync(MOV_DIR)
      .filter(f => f.endsWith('.mp4') && !f.startsWith('._'))
      .map(f => f.replace('.mp4', ''))
  )

  const entries: Record<string, unknown>[] = []
  for (const fname of fs.readdirSync(JSON_DIR).sort()) {
    if (!fname.endsWith('-generations.json')) continue
    const raw = JSON.parse(fs.readFileSync(path.join(JSON_DIR, fname), 'utf-8')) as Record<string, unknown>[]
    for (const e of raw) {
      e._source = fname
      e._local  = mp4Set.has(e.id as string)
    }
    entries.push(...raw)
  }

  // IDから時系列でソート（新しい順）
  const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz'
  function idToTimestamp(id: string): number {
    // gen_ プレフィックスを除去
    const raw = id.startsWith('gen_') ? id.slice(4) : id
    if (raw.startsWith('01k') || raw.startsWith('01j') || raw.startsWith('01m')) {
      // ULID (Crockford Base32): 先頭10文字がタイムスタンプ
      let ts = 0
      for (let i = 0; i < Math.min(10, raw.length); i++) {
        ts = ts * 32 + CROCKFORD.indexOf(raw[i].toLowerCase())
      }
      return ts
    } else {
      // HEX: 先頭8文字がタイムスタンプ (秒)
      return parseInt(raw.slice(0, 8), 16) * 1000
    }
  }

  entries.sort((a, b) => idToTimestamp(b.id as string) - idToTimestamp(a.id as string))

  console.log(`✓ ${entries.length} entries  (${entries.filter(e => e._local).length} with local mp4)`)
  console.log(`  JSON_DIR: ${JSON_DIR}`)
  console.log(`  MOV_DIR:  ${MOV_DIR}`)
  return entries
}

const manifest = loadManifest()

// ── サムネイル生成 (ffmpeg) ────────────────────────────────────────────────
function generateThumbnail(videoPath: string, thumbPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', videoPath,
      '-ss', '0.5',        // 0.5秒目のフレーム
      '-vframes', '1',
      '-vf', 'scale=480:-2',  // 幅480px、アスペクト比維持
      '-q:v', '6',          // JPEG品質 (2=高品質, 31=低品質)
      '-y',
      thumbPath,
    ], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// ── App ────────────────────────────────────────────────────────────────────
const app = new Hono()
app.use('*', cors())

app.get('/api/manifest', c => c.json(manifest))

// サムネイル: 遅延生成 + キャッシュ
app.get('/thumbnail/:id', async c => {
  const id = c.req.param('id')
  const thumbPath = path.join(THUMB_DIR, `${id}.jpg`)
  const videoPath = path.join(MOV_DIR, `${id}.mp4`)

  if (!fs.existsSync(videoPath)) return c.notFound()

  // キャッシュがなければ生成
  if (!fs.existsSync(thumbPath)) {
    try {
      await generateThumbnail(videoPath, thumbPath)
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

app.get('/video/:id', async c => {
  const id  = c.req.param('id')
  const fp  = path.join(MOV_DIR, `${id}.mp4`)
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

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('🎬 Sora server → http://localhost:3001')
})
