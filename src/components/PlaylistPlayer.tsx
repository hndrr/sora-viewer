import {
  GripVertical,
  Info,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Generation } from '../types';
import { useVideoPlaybackMeta, VideoDetailsPanel } from './VideoDetailsPanel';

// Fisher-Yates シャッフル。fixedFirst を指定すると、その index を先頭に固定する。
function shuffleIndices(n: number, fixedFirst?: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (fixedFirst != null) {
    const idx = arr.indexOf(fixedFirst);
    if (idx > 0) {
      arr.splice(idx, 1);
      arr.unshift(fixedFirst);
    }
  }
  return arr;
}

function sequentialIndices(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

// 秒数を m:ss 形式に整形
function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function PlaylistPlayer({
  playlist,
  startIndex,
  initialShuffle,
  initialRepeatOne,
  initialShowDetails,
  soundEnabled,
  onSoundChange,
  onClose,
}: {
  playlist: Generation[];
  startIndex: number;
  initialShuffle: boolean;
  initialRepeatOne: boolean;
  initialShowDetails: boolean;
  soundEnabled: boolean;
  onSoundChange: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const total = playlist.length;

  const [shuffle, setShuffle] = useState(initialShuffle);
  // 現在の1本を繰り返すか。OFF時は末尾まで来たら先頭へ戻る（全体ループは本機能の前提）。
  const [repeatOne, setRepeatOne] = useState(initialRepeatOne);
  // order: playlist の index を並べた再生順。pos: order 内の現在位置。
  const [order, setOrder] = useState<number[]>(() =>
    initialShuffle ? shuffleIndices(total, startIndex) : sequentialIndices(total),
  );
  const [pos, setPos] = useState(() =>
    initialShuffle ? 0 : Math.min(Math.max(startIndex, 0), Math.max(total - 1, 0)),
  );
  const [paused, setPaused] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const [showDetails, setShowDetails] = useState(initialShowDetails);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // フローティングバーのドラッグ移動（ステージ基準の相対座標）
  const barElRef = useRef<HTMLDivElement>(null);
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const current = playlist[order[pos]] as Generation | undefined;
  const src = current ? (current._local ? `/video/${current.id}` : current.url) : '';
  const title = current && current.title && current.title !== 'New Video' ? current.title : '';
  const canExport = !!current?._local;
  const { actualDim, meta, currentFrame } = useVideoPlaybackMeta(
    videoRef,
    current?.id ?? '',
    canExport,
  );

  // コントロール（バー/上部情報/カーソル）の表示。詳細を開いている間は常に表示。
  const controlsVisible = barVisible || showDetails;

  // ── 前後移動（手動操作は repeat に関係なく端でラップ）──────────────────
  const go = useCallback(
    (delta: number) => {
      setPos((p) => (total === 0 ? 0 : (p + delta + total) % total));
    },
    [total],
  );
  const next = useCallback(() => go(1), [go]);
  const prev = useCallback(() => go(-1), [go]);

  const playFromStart = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }, []);

  // ── 1 本の再生が終わったときの遷移 ─────────────────────────────────────
  // 末尾まで来たら先頭へ戻る（全体ループは本機能の前提）。
  // repeatOne の時だけ現在の1本を繰り返す。
  const handleEnded = useCallback(() => {
    if (total === 0) return;
    if (repeatOne) {
      playFromStart();
      return;
    }
    if (pos + 1 < total) setPos(pos + 1);
    else if (total === 1) playFromStart();
    else setPos(0);
  }, [total, pos, repeatOne, playFromStart]);

  const toggleRepeatOne = useCallback(() => setRepeatOne((v) => !v), []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleShuffle = useCallback(() => {
    const nextShuffle = !shuffle;
    const currentReal = order[pos]; // 現在の playlist index を保持
    if (nextShuffle) {
      setOrder(shuffleIndices(total, currentReal));
      setPos(0);
    } else {
      setOrder(sequentialIndices(total));
      setPos(currentReal ?? 0);
    }
    setShuffle(nextShuffle);
  }, [shuffle, order, pos, total]);

  const toggleSound = useCallback(() => {
    const nextEnabled = !soundEnabled;
    onSoundChange(nextEnabled);
    const v = videoRef.current;
    if (v) {
      v.muted = !nextEnabled;
      if (nextEnabled) {
        v.volume = 0.8;
        v.play().catch(() => {});
      }
    }
  }, [soundEnabled, onSoundChange]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(t)) {
      v.currentTime = t;
      setCurrentTime(t);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      player.requestFullscreen().catch(() => {});
    }
  }, []);

  // ── src 変更時に自動再生＋音声適用（VideoModal のパターンを踏襲）────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    v.muted = !soundEnabled;
    if (soundEnabled) v.volume = 0.8;
    v.play().catch(() => {
      v.muted = true;
      if (soundEnabled) onSoundChange(false);
      v.play().catch(() => {});
    });
  }, [src, soundEnabled, onSoundChange]);

  // ── 再生位置/総時間の追跡（seekbar 用）──────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onMeta = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    setCurrentTime(v.currentTime || 0);
    setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
    };
  }, [src]);

  // ── キーボード操作 ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 入力欄（フレーム番号など）にフォーカス中はショートカットを無効化
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          next();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          prev();
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 's':
        case 'S':
          toggleShuffle();
          break;
        case 'r':
        case 'R':
          toggleRepeatOne();
          break;
        case 'i':
        case 'I':
          setShowDetails((v) => !v);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, togglePlay, onClose, toggleShuffle, toggleRepeatOne, toggleFullscreen]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === playerRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // ── コントロールバーの auto-hide（再生中のみ隠す）──────────────────────
  const showBar = useCallback(() => {
    setBarVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!paused) {
      hideTimer.current = setTimeout(() => {
        if (!dragRef.current) setBarVisible(false);
      }, 3000);
    }
  }, [paused]);

  // ── フローティングバーのドラッグ移動（グリップを掴んでステージ内に配置）──
  const onDragStart = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const bar = barElRef.current;
    const player = playerRef.current;
    if (!bar || !player) return;
    const rect = bar.getBoundingClientRect();
    const sr = player.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setBarPos({ x: rect.left - sr.left, y: rect.top - sr.top });
    e.currentTarget.setPointerCapture(e.pointerId);
    setBarVisible(true);
  }, []);

  const onDragMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    const bar = barElRef.current;
    const player = playerRef.current;
    if (!bar || !player) return;
    const sr = player.getBoundingClientRect();
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const x = Math.max(8, Math.min(e.clientX - dragRef.current.dx - sr.left, sr.width - w - 8));
    const y = Math.max(8, Math.min(e.clientY - dragRef.current.dy - sr.top, sr.height - h - 8));
    setBarPos({ x, y });
  }, []);

  const onBarPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const target = e.target;
      if (target instanceof Element && target.closest('button,input,a,select,textarea')) return;
      onDragStart(e);
    },
    [onDragStart],
  );

  const onDragEnd = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  useEffect(() => {
    showBar();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [showBar]);

  const seekPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={playerRef}
      className={`playlist-player${showDetails ? ' with-details' : ''}${controlsVisible ? '' : ' bar-hidden'}`}
      onMouseMove={showBar}
    >
      <div className="playlist-stage">
        {src ? (
          <video
            ref={videoRef}
            className="playlist-player-video"
            src={src}
            autoPlay
            playsInline
            muted={!soundEnabled}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onEnded={handleEnded}
            onClick={togglePlay}
          />
        ) : (
          <div className="playlist-player-empty">再生できる動画がありません</div>
        )}

        {title && (
          <div className={`playlist-topbar${controlsVisible ? '' : ' hidden'}`}>
            <span className="playlist-topbar-title">{title}</span>
          </div>
        )}
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
          />
        </div>
      )}

      <div
        ref={barElRef}
        className={`playlist-bar${controlsVisible ? '' : ' hidden'}`}
        style={
          barPos
            ? { left: barPos.x, top: barPos.y, right: 'auto', bottom: 'auto', transform: 'none' }
            : undefined
        }
        role="toolbar"
        aria-label="再生コントロール"
        onPointerDown={onBarPointerDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="playlist-seek-row">
          <span className="playlist-drag-handle" title="ドラッグで移動">
            <GripVertical size={16} aria-hidden />
          </span>
          <span className="playlist-time">{formatTime(currentTime)}</span>
          <input
            type="range"
            className="playlist-seek"
            min={0}
            max={duration || 0}
            step="any"
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right, #5f8ee8 ${seekPct}%, rgba(255,255,255,.2) ${seekPct}%)`,
            }}
            aria-label="シーク"
          />
          <span className="playlist-time">{formatTime(duration)}</span>
        </div>

        <div className="playlist-controls-row">
          <button
            type="button"
            className="playlist-bar-btn"
            onClick={prev}
            title="前へ (←)"
            aria-label="前へ"
          >
            <SkipBack size={20} aria-hidden />
          </button>
          <button
            type="button"
            className="playlist-bar-btn playlist-bar-play"
            onClick={togglePlay}
            title="再生 / 一時停止 (Space)"
            aria-label={paused ? '再生' : '一時停止'}
          >
            {paused ? <Play size={22} aria-hidden /> : <Pause size={22} aria-hidden />}
          </button>
          <button
            type="button"
            className="playlist-bar-btn"
            onClick={next}
            title="次へ (→)"
            aria-label="次へ"
          >
            <SkipForward size={20} aria-hidden />
          </button>

          <span className="playlist-bar-index">
            {total === 0 ? 0 : pos + 1} / {total}
          </span>

          <span className="playlist-bar-divider" />

          <button
            type="button"
            className={`playlist-bar-btn${shuffle ? ' active' : ''}`}
            onClick={toggleShuffle}
            title="ランダム (S)"
            aria-pressed={shuffle}
            aria-label="ランダム再生"
          >
            <Shuffle size={18} aria-hidden />
          </button>
          <button
            type="button"
            className={`playlist-bar-btn${repeatOne ? ' active' : ''}`}
            onClick={toggleRepeatOne}
            title={repeatOne ? '1本リピート: ON (R)' : '1本リピート: OFF (R)'}
            aria-pressed={repeatOne}
            aria-label="1本リピート"
          >
            <Repeat1 size={18} aria-hidden />
          </button>
          <button
            type="button"
            className={`playlist-bar-btn${soundEnabled ? ' active' : ''}`}
            onClick={toggleSound}
            title="音声"
            aria-pressed={soundEnabled}
            aria-label="音声切替"
          >
            {soundEnabled ? <Volume2 size={18} aria-hidden /> : <VolumeX size={18} aria-hidden />}
          </button>

          <span className="playlist-bar-divider" />

          <button
            type="button"
            className={`playlist-bar-btn${showDetails ? ' active' : ''}`}
            onClick={() => setShowDetails((v) => !v)}
            title="詳細 (I)"
            aria-pressed={showDetails}
            aria-label="詳細"
          >
            <Info size={18} aria-hidden />
          </button>
          <button
            type="button"
            className={`playlist-bar-btn${isFullscreen ? ' active' : ''}`}
            onClick={toggleFullscreen}
            title={isFullscreen ? 'フルスクリーン解除 (F)' : 'フルスクリーン (F)'}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? 'フルスクリーン解除' : 'フルスクリーン'}
          >
            {isFullscreen ? <Minimize2 size={18} aria-hidden /> : <Maximize2 size={18} aria-hidden />}
          </button>
          <button
            type="button"
            className="playlist-bar-btn"
            onClick={onClose}
            title="閉じる (Esc)"
            aria-label="閉じる"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
