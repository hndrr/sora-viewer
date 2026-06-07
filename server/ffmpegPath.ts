import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ffmpeg / ffprobe の実行ファイルを探索する。
 *
 * 重要: macOS で Finder から起動した Electron はシェルの PATH を継承しないため、
 * `/opt/homebrew/bin` 等が PATH に含まれず `execFile('ffmpeg')` が失敗する。
 * そのため PATH に加えて代表的なインストール先も明示的に探索する。
 *
 * 探索順: PATH → 既知のディレクトリ → which/where → 見つからなければ null
 */

// Homebrew(Apple Silicon / Intel)・MacPorts・一般的な Unix の配置
const COMMON_UNIX_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/opt/local/bin',
];

// Windows の一般的な配置（Chocolatey / scoop / winget など）
const COMMON_WIN_DIRS = ['C:\\ffmpeg\\bin', 'C:\\ProgramData\\chocolatey\\bin'];

function isExecutableFile(p: string, isWin: boolean): boolean {
  try {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return false;
    if (!isWin) fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
  const isWin = process.platform === 'win32';
  const exe = isWin ? `${name}.exe` : name;

  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const commonDirs = isWin ? COMMON_WIN_DIRS : COMMON_UNIX_DIRS;

  for (const dir of [...pathDirs, ...commonDirs]) {
    const full = path.join(dir, exe);
    if (isExecutableFile(full, isWin)) return full;
  }

  // which / where によるフォールバック
  try {
    const cmd = isWin ? 'where' : 'which';
    const out = execFileSync(cmd, [name], { encoding: 'utf-8' }).split(/\r?\n/)[0]?.trim();
    if (out && isExecutableFile(out, isWin)) return out;
  } catch {
    // 見つからない場合は which/where が非ゼロ終了する
  }

  return null;
}
