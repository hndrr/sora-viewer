import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ViewerDataSource } from '../dataSources/types';
import type { Generation } from '../types';

const S = {
  card: {
    position: 'relative' as const,
    height: '100%',
    background: '#181818',
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid #242424',
    transition: 'border-color .15s',
    cursor: 'pointer',
  },
  cardHover: { borderColor: '#4a4a4a' },
  vwrap: {
    position: 'relative' as const,
    height: '100%',
    background: '#000',
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' },
  previewVideo: {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    background: '#000',
    opacity: 0,
    transition: 'opacity .12s',
  },
  badge: {
    position: 'absolute' as const,
    top: 7,
    right: 7,
    background: 'rgba(0,0,0,.65)',
    borderRadius: 4,
    fontSize: 10,
    padding: '2px 6px',
    color: '#888',
  },
  playIcon: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,.3)',
    opacity: 0,
    transition: 'opacity .15s',
    pointerEvents: 'none' as const,
  },
  // ホバー時のみ下部に重ねるキャプション（Sora Web 風）。
  // カード高 = メディア高に保つため、メタ情報は常設ではなくオーバーレイで出す。
  caption: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    padding: '38px 13px 12px',
    background: 'linear-gradient(to top, rgba(0,0,0,.8) 0%, rgba(0,0,0,.45) 60%, transparent 100%)',
    opacity: 0,
    transition: 'opacity .18s',
    pointerEvents: 'none' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  captionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  captionPrompt: {
    fontSize: 11.5,
    color: 'rgba(255,255,255,.85)',
    lineHeight: 1.55,
    margin: 0,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  },
  captionMeta: {
    fontSize: 10,
    color: 'rgba(255,255,255,.55)',
    fontFamily: 'monospace',
  },
};

export function VideoCard({
  gen,
  dataSource,
  onSelect,
  previewSoundEnabled,
  onSoundBlocked,
}: {
  gen: Generation;
  dataSource: ViewerDataSource;
  onSelect: (g: Generation) => void;
  previewSoundEnabled: boolean;
  onSoundBlocked: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverActiveRef = useRef(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewHeldRef = useRef(false);

  const prompt = gen.prompt?.trim() ?? '';
  const title = gen.title && gen.title !== 'New Video' ? gen.title : '';
  const playable = dataSource.canPlay(gen);
  const showPreview = previewActive && previewSrc;
  const stopPreview = () => {
    if (previewVideoRef.current) {
      previewVideoRef.current.pause();
      previewVideoRef.current.currentTime = 0;
    }
    setPreviewActive(false);
    setPreviewReady(false);
    if (previewHeldRef.current) {
      // ホバーで生成した Blob URL を解放しないと、カードを次々ホバーするだけで mp4 が溜まる
      dataSource.releaseVideoSrc?.(gen);
      previewHeldRef.current = false;
      setPreviewSrc(null);
    }
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };
  const startPreviewPlayback = (video: HTMLVideoElement) => {
    video.muted = !previewSoundEnabled;
    video.volume = 0.8;

    const playPromise = video.play();
    if (playPromise) {
      playPromise
        .then(() => setPreviewReady(true))
        .catch(() => {
          video.muted = true;
          if (previewSoundEnabled) onSoundBlocked();
          video.play().finally(() => setPreviewReady(true));
        });
    } else {
      setPreviewReady(true);
    }
  };

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (previewHeldRef.current) {
        dataSource.releaseVideoSrc?.(gen);
        previewHeldRef.current = false;
      }
    };
  }, [dataSource, gen]);

  useEffect(() => {
    let cancelled = false;
    setThumbError(false);
    setThumbSrc(null);
    dataSource
      .getThumbnailSrc(gen)
      .then((src) => {
        if (!cancelled) setThumbSrc(src);
      })
      .catch(() => {
        if (!cancelled) setThumbError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, gen]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;

    video.muted = !previewSoundEnabled;
    if (previewSoundEnabled) {
      video.volume = 0.8;
      video.play().catch(() => {
        video.muted = true;
        onSoundBlocked();
      });
    }
  }, [onSoundBlocked, previewSoundEnabled]);

  return (
    <div
      style={{ ...S.card, ...(hovered ? S.cardHover : {}) }}
      onMouseEnter={() => {
        setHovered(true);
        hoverActiveRef.current = true;
        if (!playable) return;
        hoverTimerRef.current = setTimeout(() => {
          dataSource
            .getVideoSrc(gen)
            .then((src) => {
              if (!src || !hoverActiveRef.current) return;
              previewHeldRef.current = true;
              setPreviewSrc(src);
              setPreviewActive(true);
            })
            .catch(() => {});
        }, 260);
      }}
      onMouseLeave={() => {
        setHovered(false);
        hoverActiveRef.current = false;
        stopPreview();
      }}
      onClick={() => {
        stopPreview();
        onSelect(gen);
      }}
    >
      <div style={S.vwrap}>
        {thumbSrc && !thumbError ? (
          <img
            src={thumbSrc}
            alt=""
            style={S.thumb}
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#333',
              fontSize: 12,
            }}
          >
            {playable ? <Play size={20} aria-hidden /> : 'なし'}
          </div>
        )}

        {showPreview && (
          <video
            ref={previewVideoRef}
            src={previewSrc}
            style={{ ...S.previewVideo, opacity: previewReady ? 1 : 0 }}
            autoPlay
            loop
            muted={!previewSoundEnabled}
            playsInline
            preload="metadata"
            onCanPlay={(e) => startPreviewPlayback(e.currentTarget)}
          />
        )}

        <div style={{ ...S.playIcon, opacity: hovered && !previewReady ? 1 : 0 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle
              cx="24"
              cy="24"
              r="23"
              fill="rgba(0,0,0,.5)"
              stroke="rgba(255,255,255,.4)"
              strokeWidth="2"
            />
            <polygon points="19,14 19,34 36,24" fill="rgba(255,255,255,.9)" />
          </svg>
        </div>
        {gen.mediaKind === 'remote-url' && <span style={S.badge}>URL</span>}
        {gen.mediaKind === 'missing' && <span style={S.badge}>NO MP4</span>}

        <div style={{ ...S.caption, opacity: hovered ? 1 : 0 }}>
          {title && <div style={S.captionTitle}>{title}</div>}
          {prompt ? (
            <p style={S.captionPrompt}>{prompt}</p>
          ) : (
            <p style={{ ...S.captionPrompt, color: 'rgba(255,255,255,.4)', fontStyle: 'italic' }}>
              (プロンプトなし)
            </p>
          )}
          <span style={S.captionMeta}>
            {gen.width}×{gen.height}
          </span>
        </div>
      </div>
    </div>
  );
}
