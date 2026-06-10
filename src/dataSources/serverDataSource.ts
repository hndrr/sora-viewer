import type { Generation, VideoMeta } from '../types';
import type { BrowseData, ConfigStatus, ExportAction, ViewerDataSource } from './types';

function normalizeGeneration(gen: Generation): Generation {
  const mediaKind = gen._local ? 'server-local' : gen.url ? 'remote-url' : 'missing';
  return { ...gen, mediaKind };
}

function triggerDownload(href: string, filename?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  a.click();
}

export function createServerDataSource(): ViewerDataSource {
  return {
    mode: 'server',

    async getConfig() {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('Failed to load config');
      return res.json() as Promise<ConfigStatus>;
    },

    async applyDir(which, dir) {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [`${which}Dir`]: dir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '設定に失敗しました');
      return data as ConfigStatus;
    },

    async browseDir(path) {
      const q = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await fetch(`/api/browse${q}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'フォルダ一覧の取得に失敗しました');
      return data as BrowseData;
    },

    async loadManifest() {
      const res = await fetch('/api/manifest');
      if (!res.ok) throw new Error('Failed to load manifest');
      const data = (await res.json()) as Generation[];
      return data.map(normalizeGeneration);
    },

    canPlay(gen) {
      return (
        gen.mediaKind === 'server-local' ||
        gen.mediaKind === 'remote-url' ||
        gen._local ||
        !!gen.url
      );
    },

    async getVideoSrc(gen) {
      if (gen.mediaKind === 'server-local' || gen._local) return `/video/${gen.id}`;
      if (gen.mediaKind === 'remote-url' || gen.url) return gen.url;
      return null;
    },

    async getThumbnailSrc(gen) {
      if (gen.mediaKind === 'server-local' || gen._local) return `/thumbnail/${gen.id}`;
      return null;
    },

    async getVideoMeta(gen) {
      if (gen.mediaKind !== 'server-local' && !gen._local) return null;
      const res = await fetch(`/meta/${gen.id}`);
      if (!res.ok) return null;
      return res.json() as Promise<VideoMeta>;
    },

    getExportActions(gen): ExportAction[] {
      if (gen.mediaKind !== 'server-local' && !gen._local) return [];
      return [
        {
          id: 'video',
          label: '動画 (MP4)',
          run: () => triggerDownload(`/video/${gen.id}`, `${gen.id}.mp4`),
        },
        {
          id: 'audio-mp3',
          label: '音声 (MP3)',
          run: () => triggerDownload(`/audio/${gen.id}?format=mp3`),
        },
        {
          id: 'audio-m4a',
          label: '音声 (M4A)',
          run: () => triggerDownload(`/audio/${gen.id}?format=m4a`),
        },
      ];
    },

    getFrameExportAction(gen, frame): ExportAction | null {
      if (gen.mediaKind !== 'server-local' && !gen._local) return null;
      return {
        id: 'frame',
        label: 'フレーム保存',
        run: () => triggerDownload(`/frame/${gen.id}?n=${frame}`),
      };
    },

    dispose() {},
  };
}
