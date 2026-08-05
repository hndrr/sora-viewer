import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { resolveBinary } from './ffmpegPath.js';

// Web モード(npm run dev / serve)は常にプロジェクトルートから起動されるため cwd を基準にする。
// デスクトップ(Electron)は全ディレクトリを明示指定するためこの既定値は使われない。
const ROOT_DIR = process.cwd();

// ── Options ──────────────────────────────────────────────────────────────────
export interface ServerOptions {
  port?: number;
  hostname?: string;
  /** 省略可。指定しない場合は mov フォルダの動画ファイルだけでマニフェストを組み立てる */
  jsonDir?: string;
  movDir?: string;
  thumbDir?: string;
  /** json/mov の選択結果を保存する config ファイルの絶対パス */
  configPath?: string;
  /** ビルド済みフロント(dist)の絶対パス。指定かつ存在する場合のみ静的配信を有効化 */
  distDir?: string | null;
  ffmpegPath?: string;
  ffprobePath?: string;
}

export interface RunningServer {
  server: ReturnType<typeof serve>;
  port: number;
  hostname: string;
  configPath: string;
  thumbDir: string;
  ffmpegFound: boolean;
  ffprobeFound: boolean;
  close: () => Promise<void>;
}

// ── 汎用ヘルパー ─────────────────────────────────────────────────────────────
function dirExists(p?: string): boolean {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readConfigFile(p: string): { jsonDir?: string; movDir?: string } {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfigFile(p: string, data: { jsonDir?: string; movDir?: string }) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

function allowLocalCorsOrigin(origin: string): string | null {
  if (!origin) return null;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
      ? origin
      : null;
  } catch {
    return null;
  }
}

// 指定フォルダの中身を数えて「正しいフォルダか」を設定画面で示す
function countJson(dir?: string): number {
  if (!dirExists(dir)) return 0;
  let n = 0;
  try {
    for (const name of fs.readdirSync(dir!)) {
      if (name.startsWith('._')) continue;
      const full = path.join(dir!, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && name.endsWith('-generations.json')) n++;
        else if (st.isDirectory() && fs.existsSync(path.join(full, 'generations.json'))) n++;
      } catch {
        // ignore
      }
    }
  } catch {
    return 0;
  }
  return n;
}

// 対象にする動画拡張子。並び順は ID 決定の優先順でもある（a.mp4 と a.mov が
// 両方ある場合、先に並ぶ .mp4 が拡張子なしの素の ID を取る）。
const VIDEO_EXTS = ['.mp4', '.mov'];

function videoExtOf(file: string): string | null {
  const ext = path.extname(file).toLowerCase();
  return VIDEO_EXTS.includes(ext) ? ext : null;
}

function listMovFiles(dir?: string): string[] {
  if (!dirExists(dir)) return [];
  try {
    return fs
      .readdirSync(dir!)
      .filter((f) => !f.startsWith('._') && videoExtOf(f))
      .sort(
        (a, b) =>
          VIDEO_EXTS.indexOf(videoExtOf(a)!) - VIDEO_EXTS.indexOf(videoExtOf(b)!) ||
          a.localeCompare(b),
      );
  } catch {
    return [];
  }
}

function countMov(dir?: string): number {
  return listMovFiles(dir).length;
}

function isSafeMediaId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/** mov フォルダの 1 ファイル。id は URL に載せる安全な識別子。 */
interface MovFile {
  id: string;
  /** 拡張子を除いたファイル名（JSON なしモードではこれがタイトルになる） */
  name: string;
  path: string;
  mtimeMs: number;
}

function hashedMovId(seed: string): string {
  return `mov_${createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

function buildMovIndex(dir?: string): Map<string, MovFile> {
  const index = new Map<string, MovFile>();
  if (!dirExists(dir)) return index;
  for (const file of listMovFiles(dir)) {
    const name = file.slice(0, file.length - path.extname(file).length);
    const full = path.join(dir!, file);
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(full).mtimeMs;
    } catch {
      // 読めないファイルでも一覧からは落とさない（再生時に 404 になる）
    }
    // Sora の書き出し（{generation_id}.mp4）はファイル名がそのまま ID になる。
    // 手元でリネームしたファイル（日本語・空白入りなど）は安定したハッシュ ID に
    // 置き換え、URL 経路には常に isSafeMediaId を満たす ID だけを流す。
    let id = isSafeMediaId(name) ? name : hashedMovId(name);
    // a.mp4 と a.mov のように拡張子違いで同名なら、後から来た方は拡張子込みで ID を作る
    if (index.has(id)) id = hashedMovId(file);
    if (!index.has(id)) index.set(id, { id, name, path: full, mtimeMs });
  }
  return index;
}

// サーバー側フォルダブラウザ用: ディレクトリの一覧を返す
function browseDir(p?: string) {
  const target = dirExists(p) ? path.resolve(p!) : os.homedir();
  const entries = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((d) => {
      if (d.name.startsWith('.')) return false;
      try {
        return fs.statSync(path.join(target, d.name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((d) => ({ name: d.name, path: path.join(target, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    home: os.homedir(),
    entries,
  };
}

// ── マニフェスト読み込み ─────────────────────────────────────────────────────
// JSON なし（mov フォルダだけ）で起動した場合のマニフェスト。
// prompt / 解像度は JSON にしか無いので空にし、ファイル名をタイトルとして扱う。
function loadMovOnlyManifest(movIndex: Map<string, MovFile>, movDir: string) {
  const entries = [...movIndex.values()]
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    .map((f) => ({
      id: f.id,
      task_id: '',
      width: 0,
      height: 0,
      title: f.name,
      prompt: '',
      url: '',
      _source: '(mov)',
      _local: true,
      _ext: path.extname(f.path).toLowerCase(),
    }));

  console.log(`✓ ${entries.length} entries  (mov only / JSON なし)`);
  console.log(`  MOV_DIR:  ${movDir}`);
  return entries;
}

function loadManifest(jsonDir: string, movDir: string, movIndex: Map<string, MovFile>) {
  // JSON のエントリに、対応するローカル動画の有無と拡張子（.mp4 / .mov）を紐づける
  function attachLocalFile(e: Record<string, unknown>, source: string) {
    const file = movIndex.get(e.id as string);
    e._source = source;
    e._local = !!file;
    if (file) e._ext = path.extname(file.path).toLowerCase();
  }

  const entries: Record<string, unknown>[] = [];

  for (const name of fs.readdirSync(jsonDir).sort()) {
    const fullPath = path.join(jsonDir, name);
    try {
      const stat = fs.statSync(fullPath);

      if (stat.isFile() && name.endsWith('-generations.json') && !name.startsWith('._')) {
        const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as Record<string, unknown>[];
        for (const e of raw) attachLocalFile(e, name);
        entries.push(...raw);
      } else if (stat.isDirectory()) {
        const genFile = path.join(fullPath, 'generations.json');
        if (fs.existsSync(genFile)) {
          const raw = JSON.parse(fs.readFileSync(genFile, 'utf-8')) as Record<string, unknown>[];
          for (const e of raw) attachLocalFile(e, `${name}/generations.json`);
          entries.push(...raw);
        }
      }
    } catch (e) {
      console.warn(`Failed to process manifest entry ${name}:`, e);
    }
  }

  const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
  function idToTimestamp(id: string): number {
    const raw = id.startsWith('gen_') ? id.slice(4) : id;
    if (raw.startsWith('01k') || raw.startsWith('01j') || raw.startsWith('01m')) {
      let ts = 0;
      for (let i = 0; i < Math.min(10, raw.length); i++) {
        ts = ts * 32 + CROCKFORD.indexOf(raw[i].toLowerCase());
      }
      return ts;
    } else {
      return parseInt(raw.slice(0, 8), 16) * 1000;
    }
  }

  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    const id = e.id as string;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  unique.sort((a, b) => idToTimestamp(b.id as string) - idToTimestamp(a.id as string));

  console.log(
    `✓ ${unique.length} entries  (${unique.filter((e) => e._local).length} with local video, ${entries.length - unique.length} duplicates removed)`,
  );
  console.log(`  JSON_DIR: ${jsonDir}`);
  console.log(`  MOV_DIR:  ${movDir}`);
  return unique;
}

// ── ffmpeg 実行ラッパー ─────────────────────────────────────────────────────
function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, (err) => (err ? reject(err) : resolve()));
  });
}

type VideoMeta = {
  fps: number;
  frames: number;
  width: number;
  height: number;
  duration: number;
};
function probeVideo(ffprobe: string, videoPath: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobe,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=r_frame_rate,nb_frames,width,height,duration:format=duration',
        '-of',
        'json',
        videoPath,
      ],
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const j = JSON.parse(stdout);
          const s = j.streams?.[0] ?? {};
          const [num, den] = String(s.r_frame_rate ?? '0/1')
            .split('/')
            .map(Number);
          const fps = den ? num / den : 0;
          const duration = Number(s.duration ?? j.format?.duration ?? 0);
          let frames = Number(s.nb_frames);
          if (!Number.isFinite(frames) || frames <= 0) {
            frames = fps && duration ? Math.round(fps * duration) : 0;
          }
          resolve({
            fps,
            frames,
            width: Number(s.width) || 0,
            height: Number(s.height) || 0,
            duration,
          });
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

function generateThumbnail(ffmpeg: string, videoPath: string, thumbPath: string): Promise<void> {
  return runFfmpeg(ffmpeg, [
    '-i',
    videoPath,
    '-ss',
    '0.5',
    '-vframes',
    '1',
    '-vf',
    'scale=480:-2',
    '-q:v',
    '6',
    '-y',
    thumbPath,
  ]);
}

// ── 静的ファイル配信 (絶対パス対応) ──────────────────────────────────────────
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
};
function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

// ── 可変状態 ─────────────────────────────────────────────────────────────────
interface State {
  /** 未設定なら mov フォルダだけのマニフェストになる */
  jsonDir?: string;
  movDir?: string;
  /** ID → 動画の実ファイル。マニフェスト構築時に作り直す */
  movIndex: Map<string, MovFile>;
  manifest: Record<string, unknown>[];
}

// mov フォルダを読み直してマニフェストを組み立て直す。
// JSON フォルダが無ければ動画ファイルだけの一覧になる（= mov だけで起動できる）。
function refreshManifest(state: State) {
  state.movIndex = buildMovIndex(state.movDir);
  if (!dirExists(state.movDir)) {
    state.manifest = [];
    return;
  }
  state.manifest = dirExists(state.jsonDir)
    ? loadManifest(state.jsonDir!, state.movDir!, state.movIndex)
    : loadMovOnlyManifest(state.movIndex, state.movDir!);
}

// ID から動画の実パスを引く。索引に無い ID は {id}.mp4 / {id}.mov として解決する
// （マニフェスト取得後に mov フォルダへ追加されたファイルも再起動なしで再生できる）。
function videoPathFor(state: State, id: string): string | null {
  const indexed = state.movIndex.get(id);
  if (indexed) return fs.existsSync(indexed.path) ? indexed.path : null;
  if (!state.movDir) return null;
  for (const ext of VIDEO_EXTS) {
    for (const candidate of [ext, ext.toUpperCase()]) {
      const p = path.join(state.movDir, `${id}${candidate}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function videoMimeFor(filePath: string): string {
  return path.extname(filePath).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4';
}

interface AppConfig {
  state: State;
  thumbDir: string;
  configPath: string;
  distDir: string | null;
  ffmpeg: string;
  ffprobe: string;
}

function parseVideoRange(range: string, size: number): { start: number; end: number } | null {
  if (size <= 0 || !range.startsWith('bytes=')) return null;

  const [startPart, endPart] = range.slice('bytes='.length).split('-', 2);
  let start: number;
  let end: number;

  if (startPart === '') {
    const suffixLength = Number.parseInt(endPart ?? '', 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number.parseInt(startPart, 10);
    end = endPart ? Number.parseInt(endPart, 10) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) return null;
  }

  start = Math.max(0, Math.min(start, size - 1));
  end = Math.max(start, Math.min(end, size - 1));
  return { start, end };
}

function createApp(cfg: AppConfig) {
  const { state, thumbDir, configPath, distDir, ffmpeg, ffprobe } = cfg;
  const app = new Hono();
  app.use('*', cors({ origin: allowLocalCorsOrigin }));

  function configStatus() {
    return {
      jsonDir: state.jsonDir ?? null,
      movDir: state.movDir ?? null,
      jsonCount: countJson(state.jsonDir),
      movCount: countMov(state.movDir),
      // JSON は任意。mov フォルダさえ決まっていれば起動できる。
      configured: dirExists(state.movDir),
    };
  }

  // ── 設定 API ────────────────────────────────────────────────────────────
  app.get('/api/config', (c) => c.json(configStatus()));

  app.post('/api/config', async (c) => {
    const body = await c.req
      .json()
      .catch(() => ({}) as { jsonDir?: string | null; movDir?: string });
    if (body.jsonDir !== undefined) {
      // 空文字 / null は「JSON を使わない」の意味
      if (!body.jsonDir) {
        state.jsonDir = undefined;
      } else if (!dirExists(body.jsonDir)) {
        return c.json({ error: `JSON フォルダが存在しません: ${body.jsonDir}` }, 400);
      } else {
        state.jsonDir = path.resolve(body.jsonDir);
      }
    }
    if (body.movDir !== undefined) {
      if (!dirExists(body.movDir))
        return c.json({ error: `mov フォルダが存在しません: ${body.movDir}` }, 400);
      state.movDir = path.resolve(body.movDir);
    }
    try {
      refreshManifest(state);
    } catch (e) {
      return c.json({ error: `読み込みに失敗しました: ${String(e)}` }, 500);
    }
    writeConfigFile(configPath, {
      jsonDir: state.jsonDir,
      movDir: state.movDir,
    });
    return c.json(configStatus());
  });

  // ── サーバー側フォルダブラウザ ────────────────────────────────────────────
  app.get('/api/browse', (c) => {
    try {
      return c.json(browseDir(c.req.query('path')));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get('/api/manifest', (c) => c.json(state.manifest));

  app.get('/thumbnail/:id', async (c) => {
    const id = c.req.param('id');
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400);
    const thumbPath = path.join(thumbDir, `${id}.jpg`);
    const videoPath = videoPathFor(state, id);
    if (!videoPath) return c.notFound();
    if (!fs.existsSync(thumbPath)) {
      try {
        await generateThumbnail(ffmpeg, videoPath, thumbPath);
      } catch (e) {
        console.error(`Thumbnail generation failed for ${id}:`, e);
        return c.text('Thumbnail generation failed', 500);
      }
    }
    const data = fs.readFileSync(thumbPath);
    return new Response(data, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });

  app.get('/audio/:id', async (c) => {
    const id = c.req.param('id');
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400);
    const videoPath = videoPathFor(state, id);
    if (!videoPath) return c.notFound();
    const format = c.req.query('format') === 'm4a' ? 'm4a' : 'mp3';
    const outPath = path.join(os.tmpdir(), `sora-${id}-${Date.now()}.${format}`);
    const codecArgs = format === 'mp3' ? ['-q:a', '2'] : ['-c:a', 'copy'];
    try {
      await runFfmpeg(ffmpeg, ['-i', videoPath, '-vn', ...codecArgs, '-y', outPath]);
      const data = fs.readFileSync(outPath);
      fs.unlinkSync(outPath);
      return new Response(data, {
        headers: {
          'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/mp4',
          'Content-Disposition': `attachment; filename="${id}.${format}"`,
        },
      });
    } catch (e) {
      console.error(`Audio extraction failed for ${id}:`, e);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      return c.text('Audio extraction failed', 500);
    }
  });

  app.get('/meta/:id', async (c) => {
    const id = c.req.param('id');
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400);
    const videoPath = videoPathFor(state, id);
    if (!videoPath) return c.notFound();
    try {
      return c.json(await probeVideo(ffprobe, videoPath));
    } catch (e) {
      console.error(`Probe failed for ${id}:`, e);
      return c.text('Probe failed', 500);
    }
  });

  app.get('/frame/:id', async (c) => {
    const id = c.req.param('id');
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400);
    const videoPath = videoPathFor(state, id);
    if (!videoPath) return c.notFound();
    const n = parseInt(c.req.query('n') ?? '', 10);
    if (!Number.isInteger(n) || n < 0) return c.text('Invalid frame number', 400);
    const outPath = path.join(os.tmpdir(), `sora-${id}-frame${n}-${Date.now()}.png`);
    try {
      await runFfmpeg(ffmpeg, [
        '-i',
        videoPath,
        '-vf',
        `select=eq(n\\,${n})`,
        '-vframes',
        '1',
        '-y',
        outPath,
      ]);
      if (!fs.existsSync(outPath)) return c.text('Frame not found', 404);
      const data = fs.readFileSync(outPath);
      fs.unlinkSync(outPath);
      return new Response(data, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="${id}_frame${n}.png"`,
        },
      });
    } catch (e) {
      console.error(`Frame extraction failed for ${id} (n=${n}):`, e);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      return c.text('Frame extraction failed', 500);
    }
  });

  app.get('/video/:id', async (c) => {
    const id = c.req.param('id');
    if (!isSafeMediaId(id)) return c.text('Invalid ID', 400);
    const fp = videoPathFor(state, id);
    if (!fp) return c.notFound();
    const mime = videoMimeFor(fp);
    const size = fs.statSync(fp).size;
    const range = c.req.header('range');
    if (range) {
      const parsedRange = parseVideoRange(range, size);
      if (!parsedRange) return c.text('Range Not Satisfiable', 416);
      const { start, end } = parsedRange;
      const chunk = end - start + 1;
      const stream = fs.createReadStream(fp, { start, end });
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(chunk),
          'Accept-Ranges': 'bytes',
        },
      });
    }
    const stream = fs.createReadStream(fp);
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    });
  });

  // ── ビルド済みフロントの配信（distDir 指定かつ存在する場合のみ） ────────────
  if (distDir && fs.existsSync(distDir)) {
    app.get('*', (c) => {
      const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      let filePath = path.resolve(distDir, rel);
      const inside = filePath === distDir || filePath.startsWith(distDir + path.sep);
      if (!inside || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html');
        if (!fs.existsSync(filePath)) return c.notFound();
      }
      const data = fs.readFileSync(filePath);
      return new Response(data, {
        headers: { 'Content-Type': mimeFor(filePath) },
      });
    });
  }

  return app;
}

// ── 起動 ─────────────────────────────────────────────────────────────────────
export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const hostname = opts.hostname ?? '127.0.0.1';
  const thumbDir = path.resolve(opts.thumbDir ?? path.join(ROOT_DIR, '.thumbs'));
  const configPath = path.resolve(
    opts.configPath ?? process.env.SORA_CONFIG ?? path.join(ROOT_DIR, '.sora-viewer.json'),
  );
  const distDir = opts.distDir === undefined ? path.join(ROOT_DIR, 'dist') : opts.distDir;
  const distAbs = distDir ? path.resolve(distDir) : null;

  // 初期ディレクトリ: 保存済み config > opts > env > 既定(json/・mov/)。最初に存在するものを採用。
  const saved = readConfigFile(configPath);
  const firstExisting = (...cands: (string | undefined)[]) => {
    for (const c of cands) if (dirExists(c)) return path.resolve(c!);
    return undefined;
  };
  const jsonDir = firstExisting(
    saved.jsonDir,
    opts.jsonDir,
    process.env.SORA_JSON_DIR,
    path.join(ROOT_DIR, 'json'),
  );
  const movDir = firstExisting(
    saved.movDir,
    opts.movDir,
    process.env.SORA_MOV_DIR,
    path.join(ROOT_DIR, 'mov'),
  );

  const ffmpegResolved = opts.ffmpegPath ?? resolveBinary('ffmpeg');
  const ffprobeResolved = opts.ffprobePath ?? resolveBinary('ffprobe');
  const ffmpeg = ffmpegResolved ?? 'ffmpeg';
  const ffprobe = ffprobeResolved ?? 'ffprobe';
  if (!ffmpegResolved)
    console.warn('⚠ ffmpeg が見つかりません。サムネイル/音声/フレーム書き出しは無効になります。');
  if (!ffprobeResolved) console.warn('⚠ ffprobe が見つかりません。メタ情報取得は無効になります。');

  if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

  // mov フォルダだけあれば起動できる（JSON はプロンプト等のメタ情報用で任意）
  const configured = dirExists(movDir);
  const state: State = { jsonDir, movDir, movIndex: new Map(), manifest: [] };
  if (configured) refreshManifest(state);
  else console.log('ℹ データ未設定。設定画面で mov フォルダを指定してください（JSON は任意）。');

  const app = createApp({
    state,
    thumbDir,
    configPath,
    distDir: distAbs,
    ffmpeg,
    ffprobe,
  });

  return new Promise<RunningServer>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: opts.port ?? 3001, hostname }, (info) => {
      const port = info.port;
      console.log(`🎬 Sora server → http://${hostname}:${port}`);
      resolve({
        server,
        port,
        hostname,
        configPath,
        thumbDir,
        ffmpegFound: !!ffmpegResolved,
        ffprobeFound: !!ffprobeResolved,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
    (server as unknown as NodeJS.EventEmitter).on('error', reject);
  });
}
