import { useCallback, useEffect, useState } from 'react';

interface BrowseEntry {
  name: string;
  path: string;
}
interface BrowseData {
  path: string;
  parent: string | null;
  home: string;
  entries: BrowseEntry[];
}

interface Props {
  title: string;
  initialPath?: string | null;
  onSelect: (dir: string) => void;
  onClose: () => void;
}

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  panel: {
    width: 'min(640px, 92vw)',
    height: 'min(560px, 88vh)',
    background: '#1b1b1b',
    border: '1px solid #333',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    color: '#ddd',
    fontFamily: 'inherit',
  },
  head: { padding: '14px 16px', borderBottom: '1px solid #2a2a2a' },
  title: { fontSize: 14, fontWeight: 700, color: '#fff', margin: 0 },
  pathRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    padding: '10px 16px',
    borderBottom: '1px solid #222',
    background: '#161616',
  },
  pathBox: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    color: '#9db',
    background: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: '6px 10px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    direction: 'rtl' as const,
    textAlign: 'left' as const,
  },
  smallBtn: {
    font: 'inherit',
    cursor: 'pointer',
    borderRadius: 6,
    border: '1px solid #3a3a3a',
    background: '#2a2a2a',
    color: '#ddd',
    padding: '6px 11px',
    fontSize: 12,
    whiteSpace: 'nowrap' as const,
  },
  list: { flex: 1, overflowY: 'auto' as const, padding: '6px 8px' },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 7,
    cursor: 'pointer',
    fontSize: 13,
    color: '#ccc',
    userSelect: 'none' as const,
  },
  empty: { padding: 24, textAlign: 'center' as const, color: '#666', fontSize: 13 },
  foot: {
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: '12px 16px',
    borderTop: '1px solid #2a2a2a',
  },
  pick: {
    font: 'inherit',
    cursor: 'pointer',
    borderRadius: 8,
    border: '1px solid #4a7a4a',
    background: '#2d4a2d',
    color: '#cfe9cf',
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 700,
  },
};

export function FolderBrowser({ title, initialPath, onSelect, onClose }: Props) {
  const [data, setData] = useState<BrowseData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback((p?: string | null) => {
    setError('');
    const q = p ? `?path=${encodeURIComponent(p)}` : '';
    fetch(`/api/browse${q}`)
      .then((r) => r.json())
      .then((d: BrowseData & { error?: string }) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load(initialPath ?? undefined);
  }, [load, initialPath]);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <p style={S.title}>{title}</p>
        </div>

        <div style={S.pathRow}>
          <button style={S.smallBtn} onClick={() => load(data?.home)} title="ホーム">
            🏠
          </button>
          <button
            style={{ ...S.smallBtn, opacity: data?.parent ? 1 : 0.4 }}
            onClick={() => data?.parent && load(data.parent)}
            disabled={!data?.parent}
            title="上の階層へ"
          >
            ↑ 上へ
          </button>
          <div style={S.pathBox} title={data?.path}>
            {data?.path ?? '…'}
          </div>
        </div>

        <div style={S.list}>
          {error && <div style={S.empty}>{error}</div>}
          {!error && data && data.entries.length === 0 && (
            <div style={S.empty}>サブフォルダはありません</div>
          )}
          {!error &&
            data?.entries.map((en) => (
              <div
                key={en.path}
                style={S.item}
                onClick={() => load(en.path)}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#262626')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span>📁</span>
                <span>{en.name}</span>
              </div>
            ))}
        </div>

        <div style={S.foot}>
          <button style={S.smallBtn} onClick={onClose}>
            キャンセル
          </button>
          <button
            style={{ ...S.pick, opacity: data ? 1 : 0.5 }}
            disabled={!data}
            onClick={() => data && onSelect(data.path)}
          >
            このフォルダを選択
          </button>
        </div>
      </div>
    </div>
  );
}
