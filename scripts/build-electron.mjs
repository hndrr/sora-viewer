// Electron メイン / preload と、Web 用サーバーを esbuild でバンドルする。
//   dist-electron/main.cjs    … Electron メイン (startServer を内包)
//   dist-electron/preload.cjs … 設定画面向けの最小ネイティブ API (フォルダ選択)
//   dist-electron/server.cjs  … Web モード単体起動用 (node dist-electron/server.cjs)
//
// package.json は "type": "module" のため、CJS 出力は .cjs 拡張子にして Node に CJS と認識させる。
import { build } from 'esbuild'

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
  external: ['electron'],
}

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' })
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' })
await build({ ...common, entryPoints: ['server/cli.ts'], outfile: 'dist-electron/server.cjs' })

console.log('✓ Built dist-electron/{main,preload,server}.cjs')
