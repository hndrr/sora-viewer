export type MediaKind = 'server-local' | 'browser-zip' | 'remote-url' | 'missing';

export interface Generation {
  id: string;
  task_id: string;
  width: number;
  height: number;
  title: string;
  prompt: string;
  url: string;
  _source: string;
  _local: boolean;
  /** ローカル動画の拡張子（'.mp4' / '.mov'）。server モードでのみ付く */
  _ext?: string;
  mediaKind?: MediaKind;
}

export interface VideoMeta {
  fps: number;
  frames: number;
  width: number;
  height: number;
  duration: number;
}
