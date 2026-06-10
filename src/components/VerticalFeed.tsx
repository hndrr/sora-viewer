import { ChevronDown, ChevronLeft, ChevronUp, Info, Play, Volume2, VolumeX, X } from 'lucide-react';
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ViewerDataSource } from '../dataSources/types';
import type { Generation } from '../types';
import { extractAvatars } from '../utils/avatars';
import { useVideoPlaybackMeta, VideoDetailsPanel } from './VideoDetailsPanel';

// <video> を実マウントするのは activeIndex ± VIDEO_WINDOW のみ。
// それより外側 ± POSTER_WINDOW まではサムネイルを敷いてスクロール時の黒画面を防ぐ。
const VIDEO_WINDOW = 1;
const POSTER_WINDOW = 3;
const PAGE = 20;

function FeedItem({
  gen,
  index,
  isActive,
  mountVideo,
  mountPoster,
  soundEnabled,
  dataSource,
  onSoundChange,
  onActiveVideo,
  registerItem,
}: {
  gen: Generation;
  index: number;
  isActive: boolean;
  mountVideo: boolean;
  mountPoster: boolean;
  soundEnabled: boolean;
  dataSource: ViewerDataSource;
  onSoundChange: (enabled: boolean) => void;
  onActiveVideo: (video: HTMLVideoElement | null) => void;
  registerItem: (index: number, el: HTMLElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [progress, setProgress] = useState(0);

  const prompt = gen.prompt?.trim() ?? '';
  const title = gen.title && gen.title !== 'New Video' ? gen.title : '';
  const avatars = extractAvatars(prompt);
  // メディアカードの枠は manifest の縦横比で先に確保し、読み込み中のガタつきを防ぐ
  const mediaRatio = gen.width > 0 && gen.height > 0 ? `${gen.width} / ${gen.height}` : '9 / 16';

  useEffect(() => {
    if (!mountVideo || src) return;
    let cancelled = false;
    dataSource
      .getVideoSrc(gen)
      .then((s) => {
        if (!cancelled) setSrc(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mountVideo, src, gen, dataSource]);

  // ±1 ウィンドウから外れたら src を手放し、Blob URL を解放する（zip モードのメモリ対策）。
  // <video> は mountVideo=false の時点でアンマウント済みなので revoke しても安全。
  useEffect(() => {
    if (mountVideo || !src) return;
    setSrc(null);
    dataSource.releaseVideoSrc?.(gen);
  }, [mountVideo, src, gen, dataSource]);

  // フィードを閉じたとき（アンマウント時）も保持中の Blob URL を解放する
  const releaseOnUnmountRef = useRef<() => void>(() => {});
  releaseOnUnmountRef.current = () => {
    if (src) dataSource.releaseVideoSrc?.(gen);
  };
  useEffect(() => () => releaseOnUnmountRef.current(), []);

  useEffect(() => {
    if (!mountPoster || poster) return;
    let cancelled = false;
    dataSource
      .getThumbnailSrc(gen)
      .then((s) => {
        if (!cancelled) setPoster(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mountPoster, poster, gen, dataSource]);

  // アクティブになったら再生、外れたら停止して先頭へ戻す
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    if (isActive) {
      onActiveVideo(v);
      v.muted = !soundEnabled;
      if (soundEnabled) v.volume = 0.8;
      v.play().catch(() => {
        v.muted = true;
        if (soundEnabled) onSoundChange(false);
        v.play().catch(() => {});
      });
    } else {
      v.pause();
      v.currentTime = 0;
      setProgress(0);
      setPromptExpanded(false);
    }
  }, [isActive, src, soundEnabled, onSoundChange, onActiveVideo]);

  // シークバー用の再生位置追跡（アクティブな1本だけ）
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src || !isActive) return;
    const onTime = () => setProgress(v.duration > 0 ? v.currentTime / v.duration : 0);
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [isActive, src]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seek = (e: ReactMouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    v.currentTime = ratio * v.duration;
    setProgress(ratio);
  };

  return (
    <section
      className="vfeed-item"
      data-index={index}
      ref={(el) => registerItem(index, el)}
      aria-label={title || gen.id}
    >
      {mountVideo && poster && (
        <div className="vfeed-ambient" style={{ backgroundImage: `url(${poster})` }} />
      )}

      <div className="vfeed-media" style={{ '--vfeed-ar': mediaRatio } as React.CSSProperties}>
        {mountVideo && src ? (
          <video
            ref={videoRef}
            className="vfeed-video"
            src={src}
            poster={poster ?? undefined}
            loop
            playsInline
            muted={!soundEnabled}
            preload="auto"
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onClick={togglePlay}
          />
        ) : mountPoster && poster ? (
          <img className="vfeed-poster" src={poster} alt="" />
        ) : (
          <div className="vfeed-poster" />
        )}

        {isActive && paused && (
          <div className="vfeed-pause-icon">
            <span className="vfeed-pause-badge">
              <Play size={34} aria-hidden />
            </span>
          </div>
        )}

        {(title || prompt || avatars.length > 0) && (
          <div className="vfeed-overlay">
            {title && <div className="vfeed-title">{title}</div>}
            {avatars.length > 0 && (
              <div className="vfeed-avatars">
                {avatars.map((a) => (
                  <span key={a} className="vfeed-chip">
                    {a}
                  </span>
                ))}
              </div>
            )}
            {prompt && (
              <p
                className={`vfeed-prompt${promptExpanded ? ' expanded' : ''}`}
                title={promptExpanded ? 'タップで折りたたむ' : 'タップで全文を表示'}
                onClick={() => setPromptExpanded((v) => !v)}
              >
                {prompt}
              </p>
            )}
          </div>
        )}

        {isActive && src && (
          <div
            className="vfeed-progress"
            onClick={seek}
            role="slider"
            tabIndex={0}
            aria-label="シーク"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="vfeed-progress-track">
              <div className="vfeed-progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function VerticalFeed({
  playlist,
  startIndex,
  soundEnabled,
  dataSource,
  onSoundChange,
  onClose,
}: {
  playlist: Generation[];
  startIndex: number;
  soundEnabled: boolean;
  dataSource: ViewerDataSource;
  onSoundChange: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const total = playlist.length;
  const clampIndex = useCallback(
    (i: number) => Math.max(0, Math.min(i, Math.max(total - 1, 0))),
    [total],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLElement>());
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(() => clampIndex(startIndex));
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(total, Math.max(PAGE, clampIndex(startIndex) + PAGE)),
  );
  const [showDetails, setShowDetails] = useState(false);

  // ref に加えて state でも要素を持ち、アクティブ動画の差し替え時に
  // useVideoPlaybackMeta がリスナーを張り直せるようにする
  const [activeVideoEl, setActiveVideoEl] = useState<HTMLVideoElement | null>(null);

  const current = playlist[activeIndex] ?? null;
  const { actualDim, meta, currentFrame } = useVideoPlaybackMeta(
    activeVideoEl,
    current,
    dataSource,
  );

  const registerItem = useCallback((index: number, el: HTMLElement | null) => {
    if (el) itemRefs.current.set(index, el);
    else itemRefs.current.delete(index);
  }, []);

  const onActiveVideo = useCallback((video: HTMLVideoElement | null) => {
    activeVideoRef.current = video;
    setActiveVideoEl(video);
  }, []);

  // 初期表示位置（カードクリックで開いた動画）までジャンプ
  // biome-ignore lint/correctness/useExhaustiveDependencies: 初回マウント時のみジャンプする
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    root.scrollTop = clampIndex(startIndex) * root.clientHeight;
  }, []);

  // スクロールスナップ位置からアクティブな動画を判定
  // biome-ignore lint/correctness/useExhaustiveDependencies: 描画アイテムが増えたら observe し直す
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset.index);
          if (Number.isFinite(idx)) setActiveIndex(idx);
        }
      },
      { root, threshold: 0.6 },
    );
    for (const el of itemRefs.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, playlist]);

  // 末尾が近づいたら描画範囲を広げる（グリッドの無限スクロールと同じ発想）
  useEffect(() => {
    if (activeIndex >= visibleCount - 3 && visibleCount < total) {
      setVisibleCount((prev) => Math.min(prev + PAGE, total));
    }
  }, [activeIndex, visibleCount, total]);

  // フィルタ変更などで playlist が縮んだときの安全弁
  useEffect(() => {
    if (activeIndex > total - 1) setActiveIndex(clampIndex(activeIndex));
  }, [activeIndex, total, clampIndex]);

  const scrollToIndex = useCallback(
    (i: number) => {
      const root = scrollRef.current;
      if (!root) return;
      const target = clampIndex(i);
      root.scrollTo({ top: target * root.clientHeight, behavior: 'smooth' });
    },
    [clampIndex],
  );

  const togglePlay = useCallback(() => {
    const v = activeVideoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleSound = useCallback(() => {
    const nextEnabled = !soundEnabled;
    onSoundChange(nextEnabled);
    const v = activeVideoRef.current;
    if (v) {
      v.muted = !nextEnabled;
      if (nextEnabled) {
        v.volume = 0.8;
        v.play().catch(() => {});
      }
    }
  }, [soundEnabled, onSoundChange]);

  // ── キーボード操作（PlaylistPlayer のパターンを踏襲）──────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          e.preventDefault();
          scrollToIndex(activeIndex + 1);
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          e.preventDefault();
          scrollToIndex(activeIndex - 1);
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'm':
        case 'M':
          toggleSound();
          break;
        case 'i':
        case 'I':
          setShowDetails((v) => !v);
          break;
        case 'Escape':
          e.preventDefault();
          if (showDetails) setShowDetails(false);
          else onClose();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, scrollToIndex, togglePlay, toggleSound, showDetails, onClose]);

  if (total === 0) return null;

  return (
    <div className={`vertical-feed${showDetails ? ' with-details' : ''}`}>
      <div className="vfeed-stage">
        <div ref={scrollRef} className="vfeed-scroll">
          {playlist.slice(0, visibleCount).map((gen, i) => (
            <FeedItem
              key={gen.id}
              gen={gen}
              index={i}
              isActive={i === activeIndex}
              mountVideo={Math.abs(i - activeIndex) <= VIDEO_WINDOW}
              mountPoster={Math.abs(i - activeIndex) <= POSTER_WINDOW}
              soundEnabled={soundEnabled}
              dataSource={dataSource}
              onSoundChange={onSoundChange}
              onActiveVideo={onActiveVideo}
              registerItem={registerItem}
            />
          ))}
        </div>

        <div className="vfeed-top">
          <button
            type="button"
            className="vfeed-back"
            onClick={onClose}
            title="一覧へ戻る (Esc)"
            aria-label="一覧へ戻る"
          >
            <ChevronLeft size={22} aria-hidden />
          </button>
          <span className="vfeed-index">
            {activeIndex + 1} / {total}
          </span>
        </div>

        <div className="vfeed-rail">
          <button
            type="button"
            className="vfeed-rail-btn"
            onClick={() => scrollToIndex(activeIndex - 1)}
            disabled={activeIndex === 0}
            title="前へ (↑)"
            aria-label="前の動画へ"
          >
            <ChevronUp size={22} aria-hidden />
          </button>
          <button
            type="button"
            className="vfeed-rail-btn"
            onClick={() => scrollToIndex(activeIndex + 1)}
            disabled={activeIndex >= total - 1}
            title="次へ (↓)"
            aria-label="次の動画へ"
          >
            <ChevronDown size={22} aria-hidden />
          </button>

          <span className="vfeed-rail-gap" />

          <button
            type="button"
            className={`vfeed-rail-btn${soundEnabled ? ' active' : ''}`}
            onClick={toggleSound}
            title="音声 (M)"
            aria-pressed={soundEnabled}
            aria-label="音声切替"
          >
            {soundEnabled ? <Volume2 size={20} aria-hidden /> : <VolumeX size={20} aria-hidden />}
          </button>
          <button
            type="button"
            className={`vfeed-rail-btn${showDetails ? ' active' : ''}`}
            onClick={() => setShowDetails((v) => !v)}
            title="詳細 (I)"
            aria-pressed={showDetails}
            aria-label="詳細"
          >
            <Info size={20} aria-hidden />
          </button>
        </div>
      </div>

      {showDetails && current && (
        <div className="playlist-details-panel">
          <button
            type="button"
            className="playlist-details-close"
            onClick={() => setShowDetails(false)}
            aria-label="詳細を閉じる"
            title="閉じる"
          >
            <X size={18} aria-hidden />
          </button>
          <VideoDetailsPanel
            gen={current}
            currentFrame={currentFrame}
            meta={meta}
            actualDim={actualDim}
            dataSource={dataSource}
            videoRef={activeVideoRef}
          />
        </div>
      )}
    </div>
  );
}
