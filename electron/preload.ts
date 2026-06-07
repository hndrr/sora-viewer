import { contextBridge, ipcRenderer } from 'electron';

// 設定画面(React)へ、desktop でのみ使えるネイティブ機能を最小限だけ公開する。
// 設定の保存自体はサーバーの /api/config が担うため、ここではフォルダ選択のみ。
contextBridge.exposeInMainWorld('soraNative', {
  isElectron: true,
  pickDir: (opts?: { title?: string; defaultPath?: string }) =>
    ipcRenderer.invoke('dir:pick', opts ?? {}) as Promise<string | null>,
});
