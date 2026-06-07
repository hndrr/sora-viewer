# 🎬 Sora Viewer

Sora API で生成した動画をブラウジングするためのローカルビューワー。

## ディレクトリ構成

```
sora-viewer/
├── server/              # API サーバー (Hono + Node.js)
│   └── index.ts         #   マニフェスト配信・動画ストリーミング・サムネイル生成
├── src/                 # フロントエンド (React + Vite)
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
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tsconfig.server.json
```

## セットアップ

### 必要環境

- **Node.js** v18+
- **ffmpeg** (サムネイル生成に使用)

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

### 起動

```bash
npm run dev
```

- **Vite (フロント)**: http://localhost:5173
- **Hono (API)**: http://localhost:3001

## 機能

| 機能 | 説明 |
|------|------|
| **サムネイル表示** | ffmpeg で動画の 0.5 秒目を JPEG に変換、`.thumbs/` にキャッシュ |
| **無限スクロール** | 60 件ずつ段階的にロード（IntersectionObserver） |
| **プロンプト検索** | ヘッダーの検索バーでプロンプトをインクリメンタル検索 |
| **モーダル再生** | カードクリックで動画を音声付き再生（React Aria Components） |
| **時系列ソート** | ID からタイムスタンプを抽出し、新しい順に表示 |

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `SORA_JSON_DIR` | `./json` | JSON ファイルのディレクトリ |
| `SORA_MOV_DIR` | `./mov` | MP4 ファイルのディレクトリ |

## スクリプト

```bash
npm run dev      # フロント + サーバーを同時起動
npm run build    # Vite プロダクションビルド
npm run server   # サーバーのみ起動
```
