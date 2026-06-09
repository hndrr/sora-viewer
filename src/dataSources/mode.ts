import type { ViewerMode } from './types';

function isViewerMode(value: string | null | undefined): value is ViewerMode {
  return value === 'server' || value === 'browser-zip';
}

export function resolveViewerMode(): ViewerMode {
  const queryMode = new URLSearchParams(location.search).get('mode');
  if (isViewerMode(queryMode)) return queryMode;

  const envMode = import.meta.env.VITE_SORA_VIEWER_MODE;
  if (isViewerMode(envMode)) return envMode;

  return 'server';
}
