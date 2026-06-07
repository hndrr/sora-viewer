import { useEffect, useMemo, useRef, useState } from 'react'
import type { Generation } from './types'
import { VideoCard } from './components/VideoCard'
import { VideoModal } from './components/VideoModal'

// ── Prompt 内の @avatar を抽出 ───────────────────────────────────────────
function extractAvatars(prompt: string): string[] {
  return [...new Set((prompt.match(/@[\w_.]+/g) ?? []).map(m => m.toLowerCase()))]
}

const S = {
  header: {
    position: 'sticky' as const, top: 0, zIndex: 100,
    background: '#161616', borderBottom: '1px solid #222',
    padding: '10px 18px', display: 'flex', gap: 10, alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  h1: { fontSize: 15, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' as const },
  search: {
    flex: 1, minWidth: 180, background: '#222', border: '1px solid #333', borderRadius: 8,
    color: '#ddd', padding: '7px 13px', fontSize: 14, outline: 'none',
  },
  count: { fontSize: 12, color: '#555', whiteSpace: 'nowrap' as const },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 14, padding: 18,
  },
  empty: { textAlign: 'center' as const, padding: 80, color: '#444', fontSize: 16 },
  filterBar: {
    padding: '8px 18px', display: 'flex', gap: 6, flexWrap: 'wrap' as const,
    alignItems: 'center', borderBottom: '1px solid #1e1e1e',
    background: '#161616', position: 'sticky' as const, top: 44, zIndex: 99,
  },
  chip: {
    display: 'inline-flex', alignItems: 'center',
    background: '#222', border: '1px solid #333', borderRadius: 14,
    padding: '3px 10px', fontSize: 11, color: '#888',
    cursor: 'pointer', transition: 'all .12s', userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },
  chipActive: {
    background: '#2d4a2d', border: '1px solid #4a7a4a', color: '#afd6af',
  },
  chipCount: { fontSize: 10, color: '#555', marginLeft: 4 },
}

const PAGE_SIZE = 60

export default function App() {
  const [all, setAll] = useState<Generation[]>([])
  const [query, setQuery] = useState('')
  const [selectedAvatars, setSelectedAvatars] = useState<Set<string>>(new Set())
  const [showAvatars, setShowAvatars] = useState(false)
  const [loading, setLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<Generation | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/manifest')
      .then(r => r.json())
      .then((data: Generation[]) => { setAll(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // アバターリストを集計（件数順）
  const avatarList = useMemo(() => {
    const counts = new Map<string, number>()
    for (const g of all) {
      for (const a of extractAvatars(g.prompt ?? '')) {
        counts.set(a, (counts.get(a) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }, [all])

  const toggleAvatar = (name: string) => {
    setSelectedAvatars(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const filtered = useMemo(() => {
    let result = all
    if (selectedAvatars.size > 0) {
      result = result.filter(g => {
        const avatars = extractAvatars(g.prompt ?? '')
        return avatars.some(a => selectedAvatars.has(a))
      })
    }
    if (query) {
      const q = query.toLowerCase()
      result = result.filter(g => (g.prompt ?? '').toLowerCase().includes(q))
    }
    return result
  }, [all, query, selectedAvatars])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, selectedAvatars])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filtered.length))
        }
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [filtered.length])

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = visibleCount < filtered.length

  return (
    <>
      <header style={S.header}>
        <span style={S.h1}>🎬 Sora Viewer</span>
        {avatarList.length > 0 && (
          <button
            style={{
              ...S.chip,
              ...(selectedAvatars.size > 0 || showAvatars ? S.chipActive : {}),
              display: 'inline-flex', gap: 4,
            }}
            onClick={() => setShowAvatars(v => !v)}
          >
            👤 Avatar{selectedAvatars.size > 0 && ` (${selectedAvatars.size})`}
            <span style={{ fontSize: 9 }}>{showAvatars ? '▲' : '▼'}</span>
          </button>
        )}
        <input
          style={S.search}
          type="text"
          placeholder="プロンプトで検索…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <span style={S.count}>
          {loading ? '読込中…' : `${filtered.length} 件`}
          {!loading && hasMore && ` (表示: ${visibleCount})`}
        </span>
      </header>

      {showAvatars && avatarList.length > 0 && (
        <div style={S.filterBar}>
          {selectedAvatars.size > 0 && (
            <span
              style={{ ...S.chip, color: '#f88', borderColor: '#633', background: '#2a1a1a', marginRight: 4 }}
              onClick={() => setSelectedAvatars(new Set())}
            >
              ✕ クリア
            </span>
          )}
          {avatarList.map(a => (
            <span
              key={a.name}
              style={{ ...S.chip, ...(selectedAvatars.has(a.name) ? S.chipActive : {}) }}
              onClick={() => toggleAvatar(a.name)}
            >
              {a.name}
              <span style={{ ...S.chipCount, ...(selectedAvatars.has(a.name) ? { color: '#7ab87a' } : {}) }}>
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
          {visible.map(g => (
            <VideoCard key={g.id} gen={g} onSelect={setSelected} />
          ))}
        </div>
      )}

      {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}

      <VideoModal selected={selected} onClose={() => setSelected(null)} />
    </>
  )
}
