import type { ZipEntry } from 'unzipit';
import type { Generation, VideoMeta } from '../types';
import type { ConfigStatus, ExportAction, ViewerDataSource, ZipLoadResult } from './types';

type JsonRecord = Record<string, unknown>;

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

const ULID_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/i;

function idToTimestamp(id: string): number {
  const raw = id.startsWith('gen_') ? id.slice(4) : id;
  if (ULID_PATTERN.test(raw)) {
    let ts = 0;
    for (let i = 0; i < 10; i++) {
      const n = CROCKFORD.indexOf(raw[i].toLowerCase());
      if (n < 0) return 0;
      ts = ts * 32 + n;
    }
    return ts;
  }
  const parsed = Number.parseInt(raw.slice(0, 8), 16);
  return Number.isFinite(parsed) ? parsed * 1000 : 0;
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function isGenerationJsonName(name: string): boolean {
  const base = basename(name);
  return base === 'generations.json' || base.endsWith('-generations.json');
}

function mp4IdFromName(name: string): string | null {
  const base = basename(name);
  if (!base.toLowerCase().endsWith('.mp4')) return null;
  return base.slice(0, -4);
}

function normalizeGeneration(raw: JsonRecord, source: string, hasMp4: boolean): Generation | null {
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!id) return null;

  return {
    id,
    task_id: typeof raw.task_id === 'string' ? raw.task_id : '',
    width: Number(raw.width) || 0,
    height: Number(raw.height) || 0,
    title: typeof raw.title === 'string' ? raw.title : '',
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    url: typeof raw.url === 'string' ? raw.url : '',
    _source: source,
    _local: hasMp4,
    mediaKind: hasMp4 ? 'browser-zip' : raw.url ? 'remote-url' : 'missing',
  };
}

async function loadJsonArray(entry: ZipEntry): Promise<JsonRecord[]> {
  try {
    const parsed = await entry.json();
    return Array.isArray(parsed) ? (parsed as JsonRecord[]) : [];
  } catch {
    // 壊れた JSON が1つあっても他のファイルの読み込みは続行する
    return [];
  }
}

function triggerDownload(href: string, filename?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  a.click();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function exportCurrentVideoFrame(video: HTMLVideoElement, filename: string) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('動画フレームを取得できません');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas を作成できません');
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG の生成に失敗しました');
  downloadBlob(blob, filename);
}

async function captureThumbnail(videoSrc: string): Promise<string | null> {
  const video = document.createElement('video');
  video.src = videoSrc;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Thumbnail metadata timeout')),
        8000,
      );
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Failed to load video metadata'));
      };
    });

    const target =
      Number.isFinite(video.duration) && video.duration > 0 ? Math.min(0.5, video.duration / 2) : 0;
    if (target > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Thumbnail seek timeout')), 8000);
        video.onseeked = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        video.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error('Failed to seek video'));
        };
        video.currentTime = target;
      });
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    const scale = Math.min(480 / width, 1);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.78),
    );
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    // タイムアウト・失敗時もバックグラウンドのバッファリングを確実に止める
    video.src = '';
    video.load();
  }
}

async function exportAudioM4a(sourceBlob: Blob, filename: string) {
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } =
    await import('mediabunny');
  const input = new Input({
    source: new BlobSource(sourceBlob),
    formats: ALL_FORMATS,
  });
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { discard: true },
      audio: {},
    });
    if (!conversion.isValid) throw new Error('音声トラックを書き出せません');
    await conversion.execute();
    if (!target.buffer) throw new Error('音声データを生成できません');
    downloadBlob(new Blob([target.buffer], { type: 'audio/mp4' }), filename);
  } finally {
    input.dispose();
  }
}

export function createZipDataSource(): ViewerDataSource {
  let zipName: string | null = null;
  let manifest: Generation[] = [];
  let jsonCount = 0;
  let movCount = 0;
  const mp4Entries = new Map<string, ZipEntry>();
  const videoUrls = new Map<string, string>();
  const thumbnailUrls = new Map<string, string>();
  const metaCache = new Map<string, VideoMeta | null>();

  function revokeAll() {
    for (const url of videoUrls.values()) URL.revokeObjectURL(url);
    for (const url of thumbnailUrls.values()) URL.revokeObjectURL(url);
    videoUrls.clear();
    thumbnailUrls.clear();
    metaCache.clear();
  }

  async function blobFor(gen: Generation): Promise<Blob | null> {
    const entry = mp4Entries.get(gen.id);
    if (!entry) return null;
    return entry.blob('video/mp4');
  }

  const dataSource: ViewerDataSource = {
    mode: 'browser-zip',

    async getConfig(): Promise<ConfigStatus> {
      return {
        jsonDir: null,
        movDir: null,
        jsonCount,
        movCount,
        configured: manifest.length > 0,
        zipName,
      };
    },

    async loadZipFile(file: File): Promise<ZipLoadResult> {
      revokeAll();
      zipName = file.name;
      manifest = [];
      jsonCount = 0;
      movCount = 0;
      mp4Entries.clear();

      const { unzip } = await import('unzipit');
      const { entries } = await unzip(file);
      const jsonEntries: [string, ZipEntry][] = [];
      for (const [name, entry] of Object.entries(entries)) {
        if (entry.isDirectory) continue;
        if (isGenerationJsonName(name)) {
          jsonEntries.push([name, entry]);
          continue;
        }
        const mp4Id = mp4IdFromName(name);
        if (mp4Id) mp4Entries.set(mp4Id, entry);
      }

      jsonCount = jsonEntries.length;
      movCount = mp4Entries.size;

      const parsedEntries: Generation[] = [];
      for (const [name, entry] of jsonEntries.sort(([a], [b]) => a.localeCompare(b))) {
        const raw = await loadJsonArray(entry);
        for (const item of raw) {
          const id = typeof item.id === 'string' ? item.id : '';
          const gen = normalizeGeneration(item, basename(name), !!id && mp4Entries.has(id));
          if (gen) parsedEntries.push(gen);
        }
      }

      const seen = new Set<string>();
      manifest = parsedEntries
        .filter((gen) => {
          if (seen.has(gen.id)) return false;
          seen.add(gen.id);
          return true;
        })
        .sort((a, b) => idToTimestamp(b.id) - idToTimestamp(a.id));

      return {
        jsonCount,
        movCount,
        generationCount: manifest.length,
        playableCount: manifest.filter((gen) => dataSource.canPlay(gen)).length,
        zipName: file.name,
      };
    },

    async loadManifest() {
      return manifest;
    },

    canPlay(gen) {
      return gen.mediaKind === 'browser-zip' || gen.mediaKind === 'remote-url' || !!gen.url;
    },

    async getVideoSrc(gen) {
      if (gen.mediaKind === 'remote-url' || (gen.url && gen.mediaKind !== 'browser-zip'))
        return gen.url;
      if (gen.mediaKind !== 'browser-zip') return null;
      const cached = videoUrls.get(gen.id);
      if (cached) return cached;
      const blob = await blobFor(gen);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      videoUrls.set(gen.id, url);
      return url;
    },

    releaseVideoSrc(gen) {
      const url = videoUrls.get(gen.id);
      if (!url) return;
      videoUrls.delete(gen.id);
      URL.revokeObjectURL(url);
    },

    async getThumbnailSrc(gen) {
      if (gen.mediaKind !== 'browser-zip') return null;
      const cached = thumbnailUrls.get(gen.id);
      if (cached) return cached;
      // サムネ生成は一時的な Blob URL で行い、終わったら即座に解放する。
      // videoUrls キャッシュを経由すると、サムネを出しただけの動画の mp4 全体がメモリに残り続ける。
      const blob = await blobFor(gen);
      if (!blob) return null;
      const tmpUrl = URL.createObjectURL(blob);
      try {
        const thumb = await captureThumbnail(tmpUrl);
        if (thumb) thumbnailUrls.set(gen.id, thumb);
        return thumb;
      } catch {
        return null;
      } finally {
        URL.revokeObjectURL(tmpUrl);
      }
    },

    async getVideoMeta(gen) {
      if (metaCache.has(gen.id)) return metaCache.get(gen.id) ?? null;
      if (gen.mediaKind !== 'browser-zip') return null;

      try {
        const blob = await blobFor(gen);
        if (!blob) return null;
        const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
        const input = new Input({
          source: new BlobSource(blob),
          formats: ALL_FORMATS,
        });
        try {
          const videoTrack = await input.getPrimaryVideoTrack();
          if (!videoTrack) {
            metaCache.set(gen.id, null);
            return null;
          }
          const [durationFromMetadata, width, height, stats] = await Promise.all([
            input.getDurationFromMetadata().catch(() => null),
            videoTrack.getDisplayWidth().catch(() => gen.width),
            videoTrack.getDisplayHeight().catch(() => gen.height),
            videoTrack.computePacketStats(90).catch(() => null),
          ]);
          const duration =
            durationFromMetadata ?? (await input.computeDuration([videoTrack]).catch(() => 0));
          const fps = stats?.averagePacketRate ?? 0;
          const frames =
            stats?.packetCount && duration && fps
              ? Math.max(stats.packetCount, Math.round(duration * fps))
              : 0;
          const meta: VideoMeta = { fps, frames, width, height, duration };
          metaCache.set(gen.id, meta);
          return meta;
        } finally {
          input.dispose();
        }
      } catch {
        metaCache.set(gen.id, null);
        return null;
      }
    },

    getExportActions(gen): ExportAction[] {
      if (gen.mediaKind !== 'browser-zip') return [];
      return [
        {
          id: 'video',
          label: '動画 (MP4)',
          run: async () => {
            const src = await dataSource.getVideoSrc(gen);
            if (!src) throw new Error('動画ファイルが見つかりません');
            triggerDownload(src, `${gen.id}.mp4`);
          },
        },
        {
          id: 'audio-m4a',
          label: '音声 (M4A)',
          run: async () => {
            const blob = await blobFor(gen);
            if (!blob) throw new Error('動画ファイルが見つかりません');
            await exportAudioM4a(blob, `${gen.id}.m4a`);
          },
        },
      ];
    },

    getFrameExportAction(gen, _frame, video): ExportAction | null {
      if (gen.mediaKind !== 'browser-zip') return null;
      return {
        id: 'frame',
        label: '現在フレーム (PNG)',
        run: async () => {
          if (!video) throw new Error('再生中の動画がありません');
          await exportCurrentVideoFrame(video, `${gen.id}_frame.png`);
        },
      };
    },

    dispose() {
      revokeAll();
    },
  };

  if (import.meta.env.DEV) {
    // Blob URL の解放確認用デバッグフック(dev ビルド限定)
    (window as Window & { __zipBlobStats?: () => unknown }).__zipBlobStats = () => ({
      videos: videoUrls.size,
      videoIds: [...videoUrls.keys()],
      thumbnails: thumbnailUrls.size,
    });
  }

  return dataSource;
}
