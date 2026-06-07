# 🎬 Sora Viewer

[Sora2](https://sora.chatgpt.com/) (サービス終了) で生成した動画のエクスポートデータを閲覧するためのローカルビューワー。

## ディレクトリ構成

```
sora-viewer/
├── server/              # API サーバー (Hono + Node.js)
│   ├── index.ts         #   startServer()・マニフェスト配信・動画ストリーミング・dist 静的配信
│   ├── cli.ts           #   Web モード用の起動エントリ
│   └── ffmpegPath.ts    #   ffmpeg/ffprobe の実行ファイル探索（PATH 非継承対策）
├── electron/            # Electron デスクトップシェル
│   └── main.ts          #   サーバー起動 + ウィンドウ + データフォルダ選択
├── scripts/
│   └── build-electron.mjs #  esbuild で main.cjs / server.cjs を生成
├── src/                 # フロントエンド (React + Vite) ※Web/デスクトップ共通
│   ├── main.tsx         #   エントリーポイント
│   ├── App.tsx          #   ルートコンポーネント（検索・無限スクロール）
│   ├── types.ts         #   型定義
│   ├── index.css        #   グローバルスタイル + React Aria Modal スタイル
│   └── components/
│       ├── VideoCard.tsx #   サムネイルカード
│       └── VideoModal.tsx #  動画再生モーダル (React Aria Components)
├── json/                # Sora エクスポート JSON（*-generations.json）
├── mov/                 # ダウンロード済み MP4 ファイル
├── .thumbs/             # 自動生成されるサムネイルキャッシュ（gitignore 済み）
├── dist/                # Vite ビルド成果物（gitignore 済み）
├── dist-electron/       # esbuild 成果物 main.cjs / server.cjs（gitignore 済み）
├── release/             # electron-builder の配布物出力（gitignore 済み）
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tsconfig.server.json
```

## 動作モード

このアプリは **同一の Hono サーバー**を中心に動きます。**モードによって開くポートが異なる**点に注意してください。

| モード | コマンド | 開く URL | 構成 |
| ------ | -------- | -------- | ---- |
| **開発 (Web)** | `npm run dev` | **http://localhost:5173** | Vite(5173, HMR) がフロント配信 → API のみ Hono(3001) へプロキシ |
| **ローカル Web（ビルド後）** | `npm run serve` | **http://localhost:3001** | Vite は動かさず、Hono(3001) が **ビルド済みフロント＋API を両方**配信 |
| **デスクトップ (Electron)** | `npm run dev:electron` / ビルド版 | アプリ内ウィンドウ | Electron が Hono を内部起動。**起動中はブラウザから 3001 へも同時アクセス可** |

> ポイント: 開発中は Vite の **5173**、ビルド後の `serve` / デスクトップでは Hono の **3001** が「全部入り」になります（後者は今回追加した静的配信機能による）。

## セットアップ

### 必要環境

- **Node.js** v18+
- **ffmpeg** — サムネイル生成に使用（後述）

### ffmpeg のインストール

サムネイル生成に `ffmpeg` コマンドが必要です。インストールされていない場合、サムネイルは表示されず代替UIが表示されます（動画自体の再生には影響なし）。

```bash
# macOS (Homebrew)
brew install ffmpeg

# Ubuntu / Debian
sudo apt install ffmpeg

# Windows (Chocolatey)
choco install ffmpeg

# 確認
ffmpeg -version
```

#### ffmpeg の使われ方

サーバー (`server/index.ts`) がサムネイル API `/thumbnail/:id` のリクエスト時に以下を実行します：

```bash
ffmpeg -i mov/{id}.mp4 -ss 0.5 -vframes 1 -vf scale=480:-2 -q:v 6 -y .thumbs/{id}.jpg
```

| オプション         | 説明                                    |
| ------------------ | --------------------------------------- |
| `-ss 0.5`          | 動画の 0.5 秒目のフレームを取得         |
| `-vframes 1`       | 1フレームだけ出力                       |
| `-vf scale=480:-2` | 幅 480px にリサイズ（アスペクト比維持） |
| `-q:v 6`           | JPEG 品質（2=高品質 〜 31=低品質）      |

生成されたサムネイルは `.thumbs/` にキャッシュされ、2回目以降は ffmpeg を呼ばずキャッシュから返します。

### インストール

```bash
npm install
```

### データ配置

`json/` に Sora からエクスポートしたデータを配置。以下の2パターンに対応：

```bash
# パターン A: フラットファイル（リネーム済み）
json/
  sora-data-files-export-1-generations.json
  sora-data-files-export-2-generations.json

# パターン B: ディレクトリ構造（DL そのまま）
json/
  sora-data-files-export-1/
    generations.json
  sora-data-files-export-2/
    generations.json
```

`mov/` に対応する MP4 ファイルを配置（ファイル名は `{generation_id}.mp4`）

> **Note:** 複数 JSON に同じ generation ID が含まれている場合、自動的に重複排除されます。

### 起動

#### 開発（HMR あり）

```bash
npm run dev          # Web 開発: Vite(5173) + Hono(3001)
npm run dev:electron # デスクトップ開発: Vite + Electron ウィンドウ
```

- **React (フロント)**: http://localhost:5173
- **Hono (API)**: http://localhost:3001

#### ローカル Web（ビルド済み・サーバー単体）

```bash
npm run serve        # vite build + サーバー起動 → http://localhost:3001 で全機能
```

#### デスクトップアプリのビルド

> ビルド済みバイナリは配布していません。各自でローカルにビルドしてください。

```bash
npm run dist         # 現在の OS 向けに dmg / nsis / AppImage を release/ に生成
npm run dist:dir     # パッケージ化せず展開ディレクトリのみ（動作確認用・高速）
```

> **asar を無効化しています**（`build.asar: false`）。本リポジトリは外部ボリューム上での運用を想定しており、asar 生成物の読み戻し（整合性ハッシュ計算）が一部の外部ファイルシステムで失敗するためです。内蔵ディスクで運用する場合は `asar: true`（既定）に戻して問題ありません。

**データ（json / mov）はアプリに同梱しません。** 初回のデスクトップ起動時に **JSON フォルダ**と **mov フォルダ**をそれぞれ選択します（別々の場所でも可）。選択内容はアプリのユーザーデータ領域に保存され、メニュー「ファイル → JSON フォルダを選択… / mov フォルダを選択…」でいつでも変更できます。サムネイルキャッシュも同領域に保存されます。

## 機能

| 機能                   | 説明                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| **サムネイル表示**     | ffmpeg で動画の 0.5 秒目を JPEG に変換、`.thumbs/` にキャッシュ          |
| **無限スクロール**     | 60 件ずつ段階的にロード（IntersectionObserver）                          |
| **プロンプト検索**     | ヘッダーの検索バーでプロンプトをインクリメンタル検索                     |
| **アバターフィルター** | プロンプト内の `@mention` を自動抽出、タグチップで複数選択フィルタリング |
| **モーダル再生**       | カードクリックで動画を音声付き再生（React Aria Components）              |
| **時系列ソート**       | ID からタイムスタンプを抽出し、新しい順に表示                            |
| **重複排除**           | 複数 JSON 間の同一 ID エントリを自動排除                                 |

## 環境変数

| 変数            | デフォルト | 説明                        |
| --------------- | ---------- | --------------------------- |
| `SORA_JSON_DIR` | `./json`   | JSON ファイルのディレクトリ |
| `SORA_MOV_DIR`  | `./mov`    | MP4 ファイルのディレクトリ  |

## スクリプト

```bash
npm run dev          # Web 開発: フロント(Vite) + サーバー(Hono) 同時起動
npm run dev:electron # デスクトップ開発: Vite + Electron
npm run server       # サーバーのみ起動（tsx）
npm run build        # Vite ビルド + esbuild(main.cjs / server.cjs)
npm run serve        # build 後にサーバー単体起動（ローカル Web 完成形）
npm run dist         # electron-builder で配布物を生成（release/）
npm run dist:dir     # 展開ディレクトリのみ生成（動作確認用）
```

## ライセンス

本リポジトリのコードは [MIT License](./LICENSE) です。

ソースのみの配布（ビルド済みバイナリは配布しません）。依存は `npm install` で各環境が取得し、**ffmpeg / ffprobe（CLI）は同梱しません**（各自でインストール）。

主要な利用 OSS: [Electron](https://www.electronjs.org/) (MIT) / [React](https://react.dev/) (MIT) / [Hono](https://hono.dev/) (MIT) / [Vite](https://vite.dev/) (MIT) / [React Aria Components](https://react-spectrum.adobe.com/react-aria/) (Apache-2.0)。
