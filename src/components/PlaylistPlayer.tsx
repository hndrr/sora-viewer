import {
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
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Generation } from '../types';

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

export function PlaylistPlayer({
  playlist,
  startIndex,
  initialShuffle,
  soundEnabled,
  onSoundChange,
  onClose,
}: {
  playlist: Generation[];
  startIndex: number;
  initialShuffle: boolean;
  soundEnabled: boolean;
  onSoundChange: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const total = playlist.length;

  const [shuffle, setShuffle] = useState(initialShuffle);
  // 現在の1本を繰り返すか。OFF時は末尾まで来たら先頭へ戻る（全体ループは本機能の前提）。
  const [repeatOne, setRepeatOne] = useState(false);
  // order: playlist の index を並べた再生順。pos: order 内の現在位置。
  const [order, setOrder] = useState<number[]>(() =>
    initialShuffle ? shuffleIndices(total, startIndex) : sequentialIndices(total),
  );
  const [pos, setPos] = useState(() =>
    initialShuffle ? 0 : Math.min(Math.max(startIndex, 0), Math.max(total - 1, 0)),
  );
  const [paused, setPaused] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = playlist[order[pos]] as Generation | undefined;
  const src = current ? (current._local ? `/video/${current.id}` : current.url) : '';
  const title = current && current.title && current.title !== 'New Video' ? current.title : '';
  const prompt = current?.prompt?.trim() ?? '';

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

  // ── キーボード操作 ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, togglePlay, onClose, toggleShuffle, toggleRepeatOne]);

  // ── コントロールバーの auto-hide（再生中のみ隠す）──────────────────────
  const showBar = useCallback(() => {
    setBarVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused) setBarVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    showBar();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [showBar]);

  return (
    <div className={`playlist-player${barVisible ? '' : ' bar-hidden'}`} onMouseMove={showBar}>
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

      <div className={`playlist-info${barVisible ? '' : ' hidden'}`}>
        {title && <div className="playlist-info-title">{title}</div>}
        {prompt && <div className="playlist-info-prompt">{prompt}</div>}
      </div>

      <div
        className={`playlist-bar${barVisible ? '' : ' hidden'}`}
        role="toolbar"
        aria-label="再生コントロール"
      >
        <button className="playlist-bar-btn" onClick={prev} title="前へ (←)" aria-label="前へ">
          <SkipBack size={20} aria-hidden />
        </button>
        <button
          className="playlist-bar-btn playlist-bar-play"
          onClick={togglePlay}
          title="再生 / 一時停止 (Space)"
          aria-label={paused ? '再生' : '一時停止'}
        >
          {paused ? <Play size={22} aria-hidden /> : <Pause size={22} aria-hidden />}
        </button>
        <button className="playlist-bar-btn" onClick={next} title="次へ (→)" aria-label="次へ">
          <SkipForward size={20} aria-hidden />
        </button>

        <span className="playlist-bar-index">
          {total === 0 ? 0 : pos + 1} / {total}
        </span>

        <span className="playlist-bar-divider" />

        <button
          className={`playlist-bar-btn${shuffle ? ' active' : ''}`}
          onClick={toggleShuffle}
          title="ランダム (S)"
          aria-pressed={shuffle}
          aria-label="ランダム再生"
        >
          <Shuffle size={18} aria-hidden />
        </button>
        <button
          className={`playlist-bar-btn${repeatOne ? ' active' : ''}`}
          onClick={toggleRepeatOne}
          title={repeatOne ? '1本リピート: ON (R)' : '1本リピート: OFF (R)'}
          aria-pressed={repeatOne}
          aria-label="1本リピート"
        >
          <Repeat1 size={18} aria-hidden />
        </button>
        <button
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
          className="playlist-bar-btn"
          onClick={onClose}
          title="閉じる (Esc)"
          aria-label="閉じる"
        >
          <X size={20} aria-hidden />
        </button>
      </div>
    </div>
  );
}
