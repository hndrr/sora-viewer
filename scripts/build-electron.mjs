// Electron メインプロセスと Web 用サーバーを esbuild でバンドルする。
//   dist-electron/main.cjs   … Electron メイン (startServer を内包)
//   dist-electron/server.cjs … Web モード単体起動用 (node dist-electron/server.cjs)
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
  // electron はランタイムが提供。バンドルしない。
  external: ['electron'],
}

await build({
  ...common,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.cjs',
})

await build({
  ...common,
  entryPoints: ['server/cli.ts'],
  outfile: 'dist-electron/server.cjs',
})

console.log('✓ Built dist-electron/main.cjs and dist-electron/server.cjs')
