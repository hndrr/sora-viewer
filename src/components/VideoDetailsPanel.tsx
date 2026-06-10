import { Check, Copy, Download } from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import type { ViewerDataSource } from '../dataSources/types';
import type { Generation } from '../types';

// 動画の再生メタ情報（実解像度・fps/総フレーム・現在フレーム）を追跡する共通フック。
// PlaylistPlayer / VerticalFeed の両方で使う。
// videoEl は ref ではなく要素そのものを受け取る（要素の差し替え時にリスナーを張り直すため）。
export function useVideoPlaybackMeta(
  videoEl: HTMLVideoElement | null,
  gen: Generation | null,
  dataSource: ViewerDataSource,
) {
  // manifest(JSON)の width/height は実体とズレる場合があるので実解像度を優先する
  const [actualDim, setActualDim] = useState<{ w: number; h: number } | null>(null);
  // fps はフレーム番号 ⇔ 再生時間の変換に必要（ffprobe からサーバー経由で取得）
  const [meta, setMeta] = useState<{ fps: number; frames: number } | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);

  // src(genId) や video 要素が変わったら実解像度をリセットし、読込済み/読込時に反映
  useEffect(() => {
    if (!gen?.id || !videoEl) {
      setActualDim(null);
      return;
    }
    const v = videoEl;
    setActualDim(v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null);
    const onLoaded = () => setActualDim({ w: v.videoWidth, h: v.videoHeight });
    v.addEventListener('loadedmetadata', onLoaded);
    return () => v.removeEventListener('loadedmetadata', onLoaded);
  }, [gen?.id, videoEl]);

  // fps / 総フレーム数を data source から取得（server=ffprobe、browser-zip=Mediabunny）
  useEffect(() => {
    setMeta(null);
    setCurrentFrame(0);
    if (!gen?.id) return;
    let cancelled = false;
    dataSource
      .getVideoMeta(gen)
      .then((m) => {
        if (!cancelled && m?.fps) setMeta({ fps: m.fps, frames: m.frames });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gen, dataSource]);

  // 現在表示中フレーム番号を追跡（requestVideoFrameCallback 優先、無ければ timeupdate）
  useEffect(() => {
    const video = videoEl;
    if (!video || !meta?.fps) return;
    const toFrame = (t: number) => setCurrentFrame(Math.round(t * meta.fps));
    toFrame(video.currentTime);

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
  }, [meta, videoEl]);

  return { actualDim, meta, currentFrame };
}

// 動画の詳細情報＋エクスポート操作パネル。再生用の <video> は持たない（純粋な情報UI）。
export function VideoDetailsPanel({
  gen,
  currentFrame,
  meta,
  actualDim,
  className,
  dataSource,
  videoRef,
}: {
  gen: Generation;
  currentFrame: number;
  meta: { fps: number; frames: number } | null;
  actualDim: { w: number; h: number } | null;
  className?: string;
  dataSource: ViewerDataSource;
  videoRef?: RefObject<HTMLVideoElement | null>;
}) {
  const [frameNo, setFrameNo] = useState('');
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState('');
  const copyTimer = useRef<number | undefined>(undefined);
  const prompt = gen.prompt?.trim() ?? '';
  const title = gen.title && gen.title !== 'New Video' ? gen.title : '';

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード非対応/権限なしは無視
    }
  };

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  // 入力が空なら現在のフレーム、数値が入っていればその番号を保存対象にする
  const frameToSave =
    frameNo.trim() === '' ? currentFrame : Math.max(0, Math.floor(Number(frameNo) || 0));
  const exportActions = dataSource.getExportActions(gen);
  const frameAction =
    dataSource.getFrameExportAction?.(gen, frameToSave, videoRef?.current) ?? null;
  const canExport = exportActions.length > 0 || !!frameAction;

  const runExportAction = async (run: () => Promise<void> | void) => {
    setExportError('');
    try {
      await run();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : '書き出しに失敗しました');
    }
  };

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
            {exportActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="video-modal-btn"
                onClick={() => runExportAction(action.run)}
              >
                <Download size={15} aria-hidden /> {action.label}
              </button>
            ))}
          </div>

          {frameAction && (
            <>
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
                  onClick={() => runExportAction(frameAction.run)}
                >
                  <Download size={15} aria-hidden /> {frameAction.label}
                </button>
              </div>
              {meta && (
                <div className="video-modal-frame-hint">
                  全 {meta.frames} フレーム · {meta.fps.toFixed(0)}{' '}
                  fps（空欄なら現在のフレームを保存）
                </div>
              )}
            </>
          )}
          {dataSource.mode === 'browser-zip' && (
            <div className="video-modal-frame-hint">
              フレーム保存は現在表示中の映像を PNG として保存します。MP3 変換は未対応です
            </div>
          )}
          {exportError && <div className="video-modal-frame-hint">{exportError}</div>}
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
