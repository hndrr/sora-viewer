// Web モード用の起動エントリ。
//   開発:   tsx watch server/cli.ts  (Vite と併用)
//   本番:   node dist-electron/server.cjs
// デスクトップ(Electron)は server/index.ts の startServer() を直接 import する。
import { startServer } from './index.js';

startServer().catch((err: unknown) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
