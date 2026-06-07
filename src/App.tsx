import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Switch } from 'react-aria-components';
import { PlaylistPlayer } from './components/PlaylistPlayer';
import { Setup } from './components/Setup';
import { VideoCard } from './components/VideoCard';
import { VideoModal } from './components/VideoModal';
import type { Generation } from './types';

// ── Prompt 内の @avatar を抽出 ───────────────────────────────────────────
function extractAvatars(prompt: string): string[] {
  return [...new Set((prompt.match(/@[\w_.]+/g) ?? []).map((m) => m.toLowerCase()))];
}

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
  h1: { fontSize: 15, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' as const },
  search: {
    flex: 1,
    minWidth: 180,
    background: '#222',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#ddd',
    padding: '7px 13px',
    fontSize: 14,
    outline: 'none',
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 14,
    padding: 18,
  },
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

function loadSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'setup' | 'app'>('loading');
  const [all, setAll] = useState<Generation[]>([]);
  const [query, setQuery] = useState('');
  const [selectedAvatars, setSelectedAvatars] = useState<Set<string>>(new Set());
  const [showAvatars, setShowAvatars] = useState(false);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Generation | null>(null);
  const [previewSoundEnabled, setPreviewSoundEnabled] = useState(loadSoundEnabled);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerStartIndex, setPlayerStartIndex] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadManifestData = useCallback(() => {
    setLoading(true);
    fetch('/api/manifest')
      .then((r) => r.json())
      .then((data: Generation[]) => {
        setAll(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, String(previewSoundEnabled));
    } catch {
      // Ignore storage failures; the switch should still work for this session.
    }
  }, [previewSoundEnabled]);

  const handleSoundBlocked = useCallback(() => {
    setPreviewSoundEnabled(false);
  }, []);

  useEffect(() => {
    const forceSetup = new URLSearchParams(location.search).get('setup') === '1';
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg: { configured: boolean }) => {
        if (cfg.configured && !forceSetup) {
          setPhase('app');
          loadManifestData();
        } else {
          setPhase('setup');
        }
      })
      .catch(() => setPhase('setup'));
  }, [loadManifestData]);

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
    setVisibleCount(PAGE_SIZE);
  }, [query, selectedAvatars]);

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
  const playable = useMemo(() => filtered.filter((g) => g._local || g.url), [filtered]);

  const startPlayback = () => {
    setPlayerStartIndex(0);
    setPlayerOpen(true);
  };

  if (phase === 'loading') return <div style={S.empty}>Loading…</div>;
  if (phase === 'setup') return <Setup onDone={handleSetupDone} />;

  return (
    <>
      <header style={S.header}>
        <span style={S.h1}>🎬 Sora Viewer</span>
        <button
          style={{ ...S.chip, display: 'inline-flex', gap: 4 }}
          onClick={() => setPhase('setup')}
          title="データ設定"
        >
          ⚙
        </button>
        {avatarList.length > 0 && (
          <button
            style={{
              ...S.chip,
              ...(selectedAvatars.size > 0 || showAvatars ? S.chipActive : {}),
              display: 'inline-flex',
              gap: 4,
            }}
            onClick={() => setShowAvatars((v) => !v)}
          >
            👤 Avatar{selectedAvatars.size > 0 && ` (${selectedAvatars.size})`}
            <span style={{ fontSize: 9 }}>{showAvatars ? '▲' : '▼'}</span>
          </button>
        )}
        {!loading && playable.length > 0 && (
          <button
            style={{ ...S.chip, display: 'inline-flex', gap: 4 }}
            onClick={startPlayback}
            title="絞り込み結果をフルスクリーンで連続再生（ランダムは再生画面で切替）"
          >
            ▶ フルスクリーン再生
          </button>
        )}
        <input
          style={S.search}
          type="text"
          placeholder="プロンプトで検索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
              }}
              onClick={() => setSelectedAvatars(new Set())}
            >
              ✕ クリア
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
        <div style={S.grid}>
          {visible.map((g) => (
            <VideoCard
              key={g.id}
              gen={g}
              onSelect={setSelected}
              previewSoundEnabled={previewSoundEnabled}
              onSoundBlocked={handleSoundBlocked}
            />
          ))}
        </div>
      )}

      {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}

      <VideoModal
        selected={selected}
        onClose={() => setSelected(null)}
        soundEnabled={previewSoundEnabled}
        onSoundChange={setPreviewSoundEnabled}
      />

      {playerOpen && playable.length > 0 && (
        <PlaylistPlayer
          playlist={playable}
          startIndex={playerStartIndex}
          initialShuffle={false}
          soundEnabled={previewSoundEnabled}
          onSoundChange={setPreviewSoundEnabled}
          onClose={() => setPlayerOpen(false)}
        />
      )}
    </>
  );
}
