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
  mediaKind?: MediaKind;
}

export interface VideoMeta {
  fps: number;
  frames: number;
  width: number;
  height: number;
  duration: number;
}
