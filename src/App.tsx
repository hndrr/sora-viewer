import {
  ChevronDown,
  ChevronUp,
  Clapperboard,
  GalleryVerticalEnd,
  LayoutGrid,
  Play,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Switch } from 'react-aria-components';
import { clampedHeightRatio, MasonryGrid } from './components/MasonryGrid';
import { PlaylistPlayer } from './components/PlaylistPlayer';
import { Setup } from './components/Setup';
import { VerticalFeed } from './components/VerticalFeed';
import { VideoCard } from './components/VideoCard';
import { resolveViewerMode } from './dataSources/mode';
import { createServerDataSource } from './dataSources/serverDataSource';
import type { ViewerDataSource } from './dataSources/types';
import { createZipDataSource } from './dataSources/zipDataSource';
import type { Generation } from './types';
import { extractAvatars } from './utils/avatars';

const S = {
  header: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
    background: '#161616',
    borderBottom: '1px solid #222',
    padding: '10px 18px',
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  h1: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 15,
    fontWeight: 700,
    color: '#fff',
    whiteSpace: 'nowrap' as const,
  },
  search: {
    flex: 1,
    minWidth: 180,
    background: '#1d1d1d',
    border: '1px solid #333',
    borderRadius: 999,
    color: '#ddd',
    padding: '7px 15px',
    fontSize: 13,
    outline: 'none',
  },
  viewSeg: {
    display: 'inline-flex',
    border: '1px solid #333',
    borderRadius: 14,
    overflow: 'hidden',
    background: '#1d1d1d',
  },
  viewSegBtn: {
    font: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: 0,
    background: 'transparent',
    color: '#777',
    padding: '4px 11px',
    fontSize: 11,
    cursor: 'pointer',
    transition: 'all .12s',
    whiteSpace: 'nowrap' as const,
  },
  viewSegBtnActive: {
    background: '#2a3650',
    color: '#c9dcff',
  },
  count: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: '1px solid #2f2f2f',
    borderRadius: 14,
    background: '#1d1d1d',
    padding: '3px 10px',
    fontSize: 11,
    color: '#777',
    whiteSpace: 'nowrap' as const,
  },
  countStrong: { color: '#ddd', fontSize: 12, fontWeight: 700 },
  countDivider: { width: 1, height: 12, background: '#333' },
  empty: { textAlign: 'center' as const, padding: 80, color: '#444', fontSize: 16 },
  filterBar: {
    padding: '8px 18px',
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    borderBottom: '1px solid #1e1e1e',
    background: '#161616',
    position: 'sticky' as const,
    top: 44,
    zIndex: 99,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    background: '#222',
    border: '1px solid #333',
    borderRadius: 14,
    padding: '3px 10px',
    fontSize: 11,
    color: '#888',
    cursor: 'pointer',
    transition: 'all .12s',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },
  chipActive: {
    background: '#2d4a2d',
    border: '1px solid #4a7a4a',
    color: '#afd6af',
  },
  soundToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    border: 0,
    borderRadius: 0,
    padding: 0,
    fontSize: 11,
    color: '#888',
    cursor: 'pointer',
    transition: 'all .12s',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },
  soundToggleOn: {
    color: '#c9dcff',
  },
  switchTrack: {
    position: 'relative' as const,
    width: 26,
    height: 14,
    borderRadius: 999,
    background: '#444',
    transition: 'background .12s',
    flex: '0 0 auto',
  },
  switchTrackOn: {
    background: '#5f8ee8',
  },
  switchThumb: {
    position: 'absolute' as const,
    top: 2,
    left: 2,
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#bbb',
    transition: 'transform .12s, background .12s',
  },
  switchThumbOn: {
    background: '#fff',
    transform: 'translateX(12px)',
  },
  chipCount: { fontSize: 10, color: '#555', marginLeft: 4 },
};

const PAGE_SIZE = 60;
const SOUND_STORAGE_KEY = 'sora-viewer:sound-enabled';
const VIEW_STORAGE_KEY = 'sora-viewer:view-mode';

type ViewMode = 'grid' | 'feed';

function loadSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'feed' ? 'feed' : 'grid';
  } catch {
    return 'grid';
  }
}

function createDataSource(): ViewerDataSource {
  const mode = resolveViewerMode();
  return mode === 'browser-zip' ? createZipDataSource() : createServerDataSource();
}

export default function App() {
  const dataSource = useMemo(() => createDataSource(), []);
  const [phase, setPhase] = useState<'loading' | 'setup' | 'app'>('loading');
  const [all, setAll] = useState<Generation[]>([]);
  const [query, setQuery] = useState('');
  const [selectedAvatars, setSelectedAvatars] = useState<Set<string>>(new Set());
  const [showAvatars, setShowAvatars] = useState(false);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [previewSoundEnabled, setPreviewSoundEnabled] = useState(loadSoundEnabled);
  const [view, setView] = useState<ViewMode>(loadViewMode);
  // 再生プレーヤーの起動状態。カードクリックも「フルスクリーン再生」も同じプレーヤーで開く。
  const [player, setPlayer] = useState<{
    startIndex: number;
    shuffle: boolean;
    repeatOne: boolean;
    details: boolean;
  } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadManifestData = useCallback(() => {
    setLoading(true);
    dataSource
      .loadManifest()
      .then((data) => {
        setAll(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [dataSource]);

  useEffect(() => () => dataSource.dispose(), [dataSource]);

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, String(previewSoundEnabled));
    } catch {
      // Ignore storage failures; the switch should still work for this session.
    }
  }, [previewSoundEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Ignore storage failures; the toggle should still work for this session.
    }
  }, [view]);

  const handleSoundBlocked = useCallback(() => {
    setPreviewSoundEnabled(false);
  }, []);

  useEffect(() => {
    const forceSetup = new URLSearchParams(location.search).get('setup') === '1';
    dataSource
      .getConfig()
      .then((cfg: { configured: boolean }) => {
        if (cfg.configured && !forceSetup) {
          setPhase('app');
          loadManifestData();
        } else {
          setPhase('setup');
        }
      })
      .catch(() => setPhase('setup'));
  }, [dataSource, loadManifestData]);

  const handleSetupDone = useCallback(() => {
    // ?setup=1 を URL から消してから本体へ
    const url = new URL(location.href);
    url.searchParams.delete('setup');
    history.replaceState(null, '', url.toString());
    setPhase('app');
    loadManifestData();
  }, [loadManifestData]);

  // アバターリストを集計（件数順）
  const avatarList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of all) {
      for (const a of extractAvatars(g.prompt ?? '')) {
        counts.set(a, (counts.get(a) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [all]);

  const toggleAvatar = (name: string) => {
    setVisibleCount(PAGE_SIZE);
    setSelectedAvatars((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let result = all;
    if (selectedAvatars.size > 0) {
      result = result.filter((g) => {
        const avatars = extractAvatars(g.prompt ?? '');
        return avatars.some((a) => selectedAvatars.has(a));
      });
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter((g) => (g.prompt ?? '').toLowerCase().includes(q));
    }
    return result;
  }, [all, query, selectedAvatars]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length));
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filtered.length]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleCount < filtered.length;

  // 連続再生の対象（src を持つもの）。絞り込み結果をそのまま順序として使う。
  const playable = useMemo(
    () => filtered.filter((g) => dataSource.canPlay(g)),
    [dataSource, filtered],
  );

  // 「フルスクリーン再生」: 先頭から連続再生
  const startPlayback = () => {
    setPlayer({ startIndex: 0, shuffle: false, repeatOne: false, details: false });
  };

  // 動画カードクリック: その動画から開く（1本リピート・詳細を最初から表示）
  const openSingle = (g: Generation) => {
    const i = playable.findIndex((p) => p.id === g.id);
    setPlayer({ startIndex: Math.max(i, 0), shuffle: false, repeatOne: true, details: true });
  };

  if (phase === 'loading') return <div style={S.empty}>Loading…</div>;
  if (phase === 'setup') return <Setup dataSource={dataSource} onDone={handleSetupDone} />;

  return (
    <>
      <header style={S.header}>
        <span style={S.h1}>
          <Clapperboard size={16} aria-hidden />
          Sora Viewer
        </span>
        <button
          style={{ ...S.chip, display: 'inline-flex', gap: 4 }}
          onClick={() => setPhase('setup')}
          title="データ設定"
          aria-label="データ設定"
        >
          <Settings size={13} aria-hidden />
        </button>
        {avatarList.length > 0 && (
          <button
            style={{
              ...S.chip,
              ...(selectedAvatars.size > 0 || showAvatars ? S.chipActive : {}),
              display: 'inline-flex',
              gap: 5,
            }}
            onClick={() => setShowAvatars((v) => !v)}
          >
            <Users size={12} aria-hidden />
            Avatar{selectedAvatars.size > 0 && ` (${selectedAvatars.size})`}
            {showAvatars ? (
              <ChevronUp size={11} aria-hidden />
            ) : (
              <ChevronDown size={11} aria-hidden />
            )}
          </button>
        )}
        {!loading && playable.length > 0 && (
          <>
            <span style={S.viewSeg}>
              <button
                style={{ ...S.viewSegBtn, ...(view === 'grid' ? S.viewSegBtnActive : {}) }}
                onClick={() => setView('grid')}
                title="グリッド表示"
                aria-pressed={view === 'grid'}
              >
                <LayoutGrid size={13} aria-hidden />
                グリッド
              </button>
              <button
                style={{ ...S.viewSegBtn, ...(view === 'feed' ? S.viewSegBtnActive : {}) }}
                onClick={() => setView('feed')}
                title="縦フィード表示（スワイプ / ↑↓ で次の動画へ）"
                aria-pressed={view === 'feed'}
              >
                <GalleryVerticalEnd size={13} aria-hidden />
                フィード
              </button>
            </span>
            <button
              style={{ ...S.chip, display: 'inline-flex', gap: 5 }}
              onClick={startPlayback}
              title="絞り込み結果をフルスクリーンで連続再生（ランダムは再生画面で切替）"
            >
              <Play size={12} aria-hidden />
              フルスクリーン再生
            </button>
          </>
        )}
        <input
          style={S.search}
          type="text"
          placeholder="プロンプトで検索…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
        />
        <span style={S.count}>
          {loading ? (
            '読込中…'
          ) : (
            <>
              <span>全</span>
              <span style={S.countStrong}>{filtered.length}</span>
              <span>件</span>
              {hasMore && (
                <>
                  <span style={S.countDivider} />
                  <span>表示</span>
                  <span style={S.countStrong}>{visibleCount}</span>
                </>
              )}
            </>
          )}
        </span>
        <span title="動画の音声">
          <Switch
            style={{
              ...S.soundToggle,
              ...(previewSoundEnabled ? S.soundToggleOn : {}),
            }}
            isSelected={previewSoundEnabled}
            onChange={setPreviewSoundEnabled}
          >
            <span
              aria-hidden="true"
              style={{
                ...S.switchTrack,
                ...(previewSoundEnabled ? S.switchTrackOn : {}),
              }}
            >
              <span
                style={{
                  ...S.switchThumb,
                  ...(previewSoundEnabled ? S.switchThumbOn : {}),
                }}
              />
            </span>
            <span>{previewSoundEnabled ? 'Sound ON' : 'Sound OFF'}</span>
          </Switch>
        </span>
      </header>

      {showAvatars && avatarList.length > 0 && (
        <div style={S.filterBar}>
          {selectedAvatars.size > 0 && (
            <span
              style={{
                ...S.chip,
                color: '#f88',
                borderColor: '#633',
                background: '#2a1a1a',
                marginRight: 4,
                gap: 4,
              }}
              onClick={() => {
                setSelectedAvatars(new Set());
                setVisibleCount(PAGE_SIZE);
              }}
            >
              <X size={11} aria-hidden />
              クリア
            </span>
          )}
          {avatarList.map((a) => (
            <span
              key={a.name}
              style={{ ...S.chip, ...(selectedAvatars.has(a.name) ? S.chipActive : {}) }}
              onClick={() => toggleAvatar(a.name)}
            >
              {a.name}
              <span
                style={{
                  ...S.chipCount,
                  ...(selectedAvatars.has(a.name) ? { color: '#7ab87a' } : {}),
                }}
              >
                {a.count}
              </span>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div style={S.empty}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={S.empty}>該当なし</div>
      ) : (
        <MasonryGrid
          items={visible}
          keyOf={(g) => g.id}
          heightRatio={(g) => clampedHeightRatio(g.width, g.height)}
          renderItem={(g) => (
            <VideoCard
              gen={g}
              dataSource={dataSource}
              onSelect={openSingle}
              previewSoundEnabled={previewSoundEnabled}
              onSoundBlocked={handleSoundBlocked}
            />
          )}
        />
      )}

      {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}

      {view === 'feed' && !loading && playable.length > 0 && (
        <VerticalFeed
          playlist={playable}
          startIndex={0}
          soundEnabled={previewSoundEnabled}
          dataSource={dataSource}
          onSoundChange={setPreviewSoundEnabled}
          onClose={() => setView('grid')}
        />
      )}

      {player && playable.length > 0 && (
        <PlaylistPlayer
          playlist={playable}
          startIndex={player.startIndex}
          initialShuffle={player.shuffle}
          initialRepeatOne={player.repeatOne}
          initialShowDetails={player.details}
          soundEnabled={previewSoundEnabled}
          dataSource={dataSource}
          onSoundChange={setPreviewSoundEnabled}
          onClose={() => setPlayer(null)}
        />
      )}
    </>
  );
}
