import { useEffect, useMemo, useRef, useState } from 'react'
import type { Generation } from './types'
import { VideoCard } from './components/VideoCard'
import { VideoModal } from './components/VideoModal'

const S = {
  header: {
    position: 'sticky' as const, top: 0, zIndex: 100,
    background: '#161616', borderBottom: '1px solid #222',
    padding: '10px 18px', display: 'flex', gap: 12, alignItems: 'center',
  },
  h1: { fontSize: 15, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' as const },
  search: {
    flex: 1, background: '#222', border: '1px solid #333', borderRadius: 8,
    color: '#ddd', padding: '7px 13px', fontSize: 14, outline: 'none',
  },
  count: { fontSize: 12, color: '#555', whiteSpace: 'nowrap' as const },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 14, padding: 18,
  },
  empty: { textAlign: 'center' as const, padding: 80, color: '#444', fontSize: 16 },
}

const PAGE_SIZE = 60

export default function App() {
  const [all, setAll] = useState<Generation[]>([])
  const [query, setQuery] = useState('')
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

  const filtered = useMemo(() => {
    if (!query) return all
    const q = query.toLowerCase()
    return all.filter(g => (g.prompt ?? '').toLowerCase().includes(q))
  }, [all, query])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query])

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
