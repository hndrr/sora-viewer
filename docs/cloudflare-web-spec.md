# Cloudflare Web Spec

## Purpose

Sora2 export archive files such as `sora-data-files-export-4.zip` should be playable from a web deployment on Cloudflare Pages.

The Cloudflare version reads the user's archive directly in the browser. It must not require uploading the user's JSON or MP4 files to Cloudflare.

## Architecture

The Electron/Node local version and the Cloudflare web version should share the viewer UI, search, filters, cards, and playlist playback behavior. They differ only in the data source and media URL resolution.

Introduce a `DataSource`-style boundary for loading generations and resolving media assets:

- Electron/Node local version uses the existing server API.
- Cloudflare web version uses browser-selected ZIP files and browser-local Blob URLs.

The UI should not directly construct paths such as `/video/:id` or `/thumbnail/:id` in shared components. Shared components should ask the active data source for video URLs, thumbnail URLs, and metadata.

## Cloudflare Web Version

Cloudflare Pages should serve the built Vite static app from `dist/`. The Cloudflare web version should not depend on server APIs such as `/api`, `/video`, `/thumbnail`, `/meta`, `/audio`, or `/frame`.

The setup flow should allow the user to select a Sora2 ZIP archive, for example:

- `sora-data-files-export-4.zip`
- `sora-data-files-export-*.zip`

The ZIP reader should detect flat archive entries:

- `generations.json`
- `*-generations.json`
- `{generation_id}.mp4`

Use `unzipit` for ZIP reading. It can read ZIP entries from a browser `Blob`/`File` and allows the app to access only the entries it needs instead of eagerly extracting the entire archive.

Generation loading behavior:

- Parse all supported JSON generation files found in the ZIP.
- Deduplicate generations by `id`.
- Match MP4 entries by filename, where `{generation_id}.mp4` corresponds to `generation.id`.
- Preserve the existing newest-first sorting behavior.
- Mark generations without a matching MP4 as not playable, while keeping them visible when useful.

Media loading behavior:

- Do not Blob-ify every MP4 during initial load.
- Create an MP4 `Blob` and `URL.createObjectURL()` only when a card preview, selected video, or playlist item needs it.
- Revoke object URLs when they are no longer needed to avoid leaking browser memory.
- Generate thumbnails with `HTMLVideoElement` plus canvas, preferably around the 0.5 second mark.

Mediabunny usage:

- Use Mediabunny for browser-side media metadata where it is useful, such as duration, dimensions, rotation, tracks, or other information that can improve the details panel.
- Treat Mediabunny-powered metadata as optional. Playback must still work if metadata extraction fails.
- Keep future audio extraction as a possible Mediabunny-backed enhancement.

Do not include `ffmpeg.wasm` in v1. It remains a future option for heavier browser-side conversion and extraction, but it adds significant bundle/runtime cost and may require cross-origin isolation headers for multithreaded use.

## Electron/Node Local Version

The existing Electron/Node local version remains API-backed.

Keep the current server endpoints:

- `/api/manifest`
- `/api/config`
- `/api/browse`
- `/video/:id`
- `/thumbnail/:id`
- `/meta/:id`
- `/audio/:id`
- `/frame/:id`

The local version should continue using Node filesystem access for configured `json/` and `mov/` directories.

The local version should continue using `ffmpeg` and `ffprobe` for:

- Thumbnail generation.
- Audio export.
- Frame export.
- Detailed video metadata.

This preserves the current desktop and local web functionality while allowing Cloudflare web to run without access to the user's local filesystem.

## Shared UI Requirements

Shared UI should continue to support:

- Generation grid.
- Prompt search.
- Avatar extraction and filtering.
- Card preview.
- Single-video playback.
- Fullscreen playlist playback.
- Prompt/details display.

The implementation should avoid coupling these components to either API URLs or ZIP internals. Components should receive resolved media URLs or call data-source helpers.

Recommended data source responsibilities:

- Load setup/configuration state.
- Load and normalize generation manifests.
- Resolve playable video source for a generation.
- Resolve thumbnail source for a generation when available.
- Resolve metadata when available.
- Clean up temporary object URLs.

## Testing

Cloudflare web version:

- Select a `sora-data-files-export-*.zip` file and load generations.
- Detect `generations.json`, `*-generations.json`, and `{generation_id}.mp4` entries in a flat archive.
- Match MP4 files to generation IDs.
- Avoid creating Blob URLs for all MP4 files during initial load.
- Play videos from Blob URLs.
- Generate thumbnails from browser video/canvas.
- Keep search, avatar filter, card click playback, and fullscreen playlist playback working.
- Handle missing MP4 files without crashing.
- Continue playback even if Mediabunny metadata extraction fails.
- Verify the built `dist/` app works from Cloudflare Pages/static hosting without a Node server.

Electron/Node local version:

- Existing local web and Electron flows still load configured `json/` and `mov/` directories.
- Existing API endpoints still work.
- ffmpeg/ffprobe-backed thumbnail, audio export, frame export, and metadata behavior are not regressed.

## Assumptions

- The Cloudflare web v1 does not upload or persist user files.
- The user must reselect the ZIP after a page reload unless a future persistence feature is added.
- Authentication, Cloudflare R2 storage, and multi-user cloud libraries are out of scope for v1.
- The Electron/Node local version and Cloudflare web version can have different feature availability, as long as the shared viewer experience remains consistent.
