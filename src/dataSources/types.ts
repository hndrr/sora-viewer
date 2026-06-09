import type { Generation, VideoMeta } from '../types';

export type ViewerMode = 'server' | 'browser-zip';

export interface ConfigStatus {
  jsonDir: string | null;
  movDir: string | null;
  jsonCount: number;
  movCount: number;
  configured: boolean;
  zipName?: string | null;
}

export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowseData {
  path: string;
  parent: string | null;
  home: string;
  entries: BrowseEntry[];
}

export interface ZipLoadResult {
  jsonCount: number;
  movCount: number;
  generationCount: number;
  playableCount: number;
  zipName: string;
}

export interface ExportAction {
  id: string;
  label: string;
  run: () => Promise<void> | void;
}

export interface ViewerDataSource {
  mode: ViewerMode;
  getConfig: () => Promise<ConfigStatus>;
  loadManifest: () => Promise<Generation[]>;
  canPlay: (gen: Generation) => boolean;
  getVideoSrc: (gen: Generation) => Promise<string | null>;
  getThumbnailSrc: (gen: Generation) => Promise<string | null>;
  getVideoMeta: (gen: Generation) => Promise<VideoMeta | null>;
  getExportActions: (gen: Generation) => ExportAction[];
  getFrameExportAction?: (
    gen: Generation,
    frame: number,
    video?: HTMLVideoElement | null,
  ) => ExportAction | null;
  applyDir?: (which: 'json' | 'mov', dir: string) => Promise<ConfigStatus>;
  browseDir?: (path?: string | null) => Promise<BrowseData>;
  loadZipFile?: (file: File) => Promise<ZipLoadResult>;
  dispose: () => void;
}
