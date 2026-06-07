import { Check, Copy, Download } from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import type { Generation } from '../types';

// 動画の再生メタ情報（実解像度・fps/総フレーム・現在フレーム）を追跡する共通フック。
// VideoModal / PlaylistPlayer の両方で使う。
export function useVideoPlaybackMeta(
  videoRef: RefObject<HTMLVideoElement | null>,
  genId: string,
  enabled: boolean,
) {
  // manifest(JSON)の width/height は実体とズレる場合があるので実解像度を優先する
  const [actualDim, setActualDim] = useState<{ w: number; h: number } | null>(null);
  // fps はフレーム番号 ⇔ 再生時間の変換に必要（ffprobe からサーバー経由で取得）
  const [meta, setMeta] = useState<{ fps: number; frames: number } | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);

  // src(genId) が変わったら実解像度をリセットし、読込済み/読込時に反映
  useEffect(() => {
    if (!genId) {
      setActualDim(null);
      return;
    }
    const v = videoRef.current;
    setActualDim(v?.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null);
    if (!v) return;
    const onLoaded = () => setActualDim({ w: v.videoWidth, h: v.videoHeight });
    v.addEventListener('loadedmetadata', onLoaded);
    return () => v.removeEventListener('loadedmetadata', onLoaded);
  }, [genId, videoRef]);

  // fps / 総フレーム数を ffprobe から取得（ローカルのみ）
  useEffect(() => {
    setMeta(null);
    setCurrentFrame(0);
    if (!enabled || !genId) return;
    let cancelled = false;
    fetch(`/meta/${genId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!cancelled && m?.fps) setMeta({ fps: m.fps, frames: m.frames });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [genId, enabled]);

  // 現在表示中フレーム番号を追跡（requestVideoFrameCallback 優先、無ければ timeupdate）
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !meta?.fps) return;
    const toFrame = (t: number) => setCurrentFrame(Math.round(t * meta.fps));

    if (typeof video.requestVideoFrameCallback === 'function') {
      let handle = 0;
      const tick = (_now: number, md: VideoFrameCallbackMetadata) => {
        toFrame(md.mediaTime);
        handle = video.requestVideoFrameCallback(tick);
      };
      handle = video.requestVideoFrameCallback(tick);
      return () => video.cancelVideoFrameCallback(handle);
    }

    const onUpdate = () => toFrame(video.currentTime);
    video.addEventListener('timeupdate', onUpdate);
    video.addEventListener('seeked', onUpdate);
    return () => {
      video.removeEventListener('timeupdate', onUpdate);
      video.removeEventListener('seeked', onUpdate);
    };
  }, [meta, videoRef]);

  return { actualDim, meta, currentFrame };
}

// 動画の詳細情報＋エクスポート操作パネル。再生用の <video> は持たない（純粋な情報UI）。
export function VideoDetailsPanel({
  gen,
  currentFrame,
  meta,
  actualDim,
  className,
}: {
  gen: Generation;
  currentFrame: number;
  meta: { fps: number; frames: number } | null;
  actualDim: { w: number; h: number } | null;
  className?: string;
}) {
  const [frameNo, setFrameNo] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prompt = gen.prompt?.trim() ?? '';
  const title = gen.title && gen.title !== 'New Video' ? gen.title : '';
  const canExport = gen._local;

  // サーバーが Content-Disposition を返すので <a> クリックでダウンロードされる。
  // 動画(/video)はインライン配信なので download 属性でファイル名を指定して保存させる
  const triggerDownload = (href: string, filename?: string) => {
    const a = document.createElement('a');
    a.href = href;
    if (filename) a.download = filename;
    a.click();
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード非対応/権限なしは無視
    }
  };

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // 入力が空なら現在のフレーム、数値が入っていればその番号を保存対象にする
  const frameToSave =
    frameNo.trim() === '' ? currentFrame : Math.max(0, Math.floor(Number(frameNo) || 0));

  return (
    <aside
      className={`video-modal-details${className ? ` ${className}` : ''}`}
      aria-label="Video prompt and details"
    >
      {title && <h2 className="video-modal-title">{title}</h2>}

      <div className="video-modal-prompt-header">
        <span className="video-modal-section-label">Prompt</span>
        <button
          type="button"
          className="video-modal-icon-btn"
          onClick={copyPrompt}
          disabled={!prompt}
          aria-label="プロンプトをコピー"
          title={copied ? 'コピーしました' : 'プロンプトをコピー'}
        >
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        </button>
      </div>

      {prompt ? (
        <p className="video-modal-prompt">{prompt}</p>
      ) : (
        <p className="video-modal-prompt video-modal-prompt-empty">(プロンプトなし)</p>
      )}

      <div className="video-modal-resolution">
        <span className="video-modal-resolution-label">Resolution</span>
        <span className="video-modal-resolution-value">
          {actualDim ? `${actualDim.w} × ${actualDim.h}` : `${gen.width} × ${gen.height}`}
        </span>
      </div>

      {canExport && (
        <section className="video-modal-export" aria-label="Export options">
          <div className="video-modal-section-label">Export</div>

          <div className="video-modal-export-row">
            <button
              type="button"
              className="video-modal-btn"
              onClick={() => triggerDownload(`/video/${gen.id}`, `${gen.id}.mp4`)}
            >
              <Download size={15} aria-hidden /> 動画 (MP4)
            </button>
            <button
              type="button"
              className="video-modal-btn"
              onClick={() => triggerDownload(`/audio/${gen.id}?format=mp3`)}
            >
              <Download size={15} aria-hidden /> 音声 (MP3)
            </button>
            <button
              type="button"
              className="video-modal-btn"
              onClick={() => triggerDownload(`/audio/${gen.id}?format=m4a`)}
            >
              <Download size={15} aria-hidden /> 音声 (M4A)
            </button>
          </div>

          <div className="video-modal-frame-row">
            <input
              type="number"
              min={0}
              max={meta && meta.frames > 0 ? meta.frames - 1 : undefined}
              step={1}
              placeholder={meta ? `現在 ${currentFrame}` : 'フレーム番号'}
              value={frameNo}
              onChange={(e) => setFrameNo(e.target.value)}
              className="video-modal-frame-input"
            />
            <button
              type="button"
              className="video-modal-btn"
              onClick={() => triggerDownload(`/frame/${gen.id}?n=${frameToSave}`)}
            >
              <Download size={15} aria-hidden /> フレーム保存
            </button>
          </div>
          {meta && (
            <div className="video-modal-frame-hint">
              全 {meta.frames} フレーム · {meta.fps.toFixed(0)} fps（空欄なら現在のフレームを保存）
            </div>
          )}
        </section>
      )}

      <div className="video-modal-meta">
        <span>ID: {gen.id}</span>
        <span>Task: {gen.task_id}</span>
        <span>{gen._source}</span>
      </div>
    </aside>
  );
}
