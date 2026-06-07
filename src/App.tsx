import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogTrigger, Modal, ModalOverlay } from 'react-aria-components'
import type { Generation } from './types'

// ── styles ────────────────────────────────────────────────────────────────
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
  card: {
    background: '#181818', borderRadius: 10, overflow: 'hidden',
    border: '1px solid #242424', transition: 'border-color .15s',
    cursor: 'pointer',
  },
  cardHover: { borderColor: '#444' },
  vwrap: { position: 'relative' as const, background: '#000', overflow: 'hidden' },
  thumb: { width: '100%', height: '100%', objectFit: 'contain' as const, display: 'block' },
  badge: {
    position: 'absolute' as const, top: 7, right: 7,
    background: 'rgba(0,0,0,.65)', borderRadius: 4,
    fontSize: 10, padding: '2px 6px', color: '#888',
  },
  playIcon: {
    position: 'absolute' as const, inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,.3)', opacity: 0,
    transition: 'opacity .15s', pointerEvents: 'none' as const,
  },
  meta: { padding: '10px 13px 13px' },
  row: { display: 'flex', justifyContent: 'space-between', marginBottom: 5 },
  small: { fontSize: 10, color: '#555', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  prompt: { fontSize: 12, color: '#bbb', lineHeight: 1.6, whiteSpace: 'pre-wrap' as const },
  more: {
    fontSize: 11, color: '#666', cursor: 'pointer', background: 'none',
    border: 'none', padding: '3px 0 0', textDecoration: 'underline',
  },
  empty: { textAlign: 'center' as const, padding: 80, color: '#444', fontSize: 16 },

}

function aspectRatio(w: number, h: number) {
  const r = w / h
  if (r > 1.3) return '16/9'
  if (r < 0.8) return '9/16'
  return '1/1'
}

// ── VideoCard（サムネイル表示 + クリックでモーダル）───────────────────────
function VideoCard({ gen, onSelect }: { gen: Generation; onSelect: (g: Generation) => void }) {
  const [hovered, setHovered] = useState(false)
  const [thumbError, setThumbError] = useState(false)

  const thumbSrc = gen._local ? `/thumbnail/${gen.id}` : undefined
  const prompt = gen.prompt?.trim() ?? ''
  const title = (gen.title && gen.title !== 'New Video') ? gen.title : ''

  return (
    <div
      style={{ ...S.card, ...(hovered ? S.cardHover : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(gen)}
    >
      <div style={{ ...S.vwrap, aspectRatio: aspectRatio(gen.width, gen.height) }}>
        {thumbSrc && !thumbError ? (
          <img
            src={thumbSrc}
            alt=""
            style={S.thumb}
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 12 }}>
            {gen._local ? '▶' : 'URL'}
          </div>
        )}
        {/* ホバー時の再生アイコン */}
        <div style={{ ...S.playIcon, opacity: hovered ? 1 : 0 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="23" fill="rgba(0,0,0,.5)" stroke="rgba(255,255,255,.4)" strokeWidth="2" />
            <polygon points="19,14 19,34 36,24" fill="rgba(255,255,255,.9)" />
          </svg>
        </div>
        {!gen._local && <span style={S.badge}>URL</span>}
      </div>

      <div style={S.meta}>
        {title && (
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            {title}
          </div>
        )}
        <div style={S.row}>
          <span style={{ ...S.small, maxWidth: '60%' }}>{gen._source}</span>
          <span style={S.small}>{gen.width}×{gen.height}</span>
        </div>
        {prompt ? (
          <p style={{
            ...S.prompt,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }}>
            {prompt}
          </p>
        ) : (
          <p style={{ ...S.prompt, color: '#444', fontStyle: 'italic' }}>(プロンプトなし)</p>
        )}
        <div style={{ ...S.small, marginTop: 4 }}>{gen.id}</div>
      </div>
    </div>
  )
}

// ── VideoModalContent ─────────────────────────────────────────────────────
function VideoModalContent({ gen }: { gen: Generation }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const src = gen._local ? `/video/${gen.id}` : gen.url
  const prompt = gen.prompt?.trim() ?? ''
  const title = (gen.title && gen.title !== 'New Video') ? gen.title : ''

  return (
    <>
      {src ? (
        <video
          ref={videoRef}
          style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 12, background: '#000' }}
          src={src}
          controls
          autoPlay
          loop
          playsInline
        />
      ) : (
        <div style={{ color: '#555', fontSize: 16, padding: 60 }}>動画なし</div>
      )}
      <div style={{ marginTop: 14, maxWidth: 800, width: '100%', padding: '0 16px' }}>
        {title && (
          <p style={{ fontSize: 16, fontWeight: 700, color: '#eee', textAlign: 'center', marginBottom: 8 }}>
            {title}
          </p>
        )}
        {prompt ? (
          <p style={{ fontSize: 14, color: '#ccc', lineHeight: 1.7, whiteSpace: 'pre-wrap', textAlign: 'center' }}>
            {prompt}
          </p>
        ) : (
          <p style={{ fontSize: 14, color: '#555', fontStyle: 'italic', textAlign: 'center' }}>
            (プロンプトなし)
          </p>
        )}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#555', fontFamily: 'monospace' }}>{gen.width}×{gen.height}</span>
          <span style={{ fontSize: 11, color: '#555', fontFamily: 'monospace' }}>ID: {gen.id}</span>
          <span style={{ fontSize: 11, color: '#555', fontFamily: 'monospace' }}>Task: {gen.task_id}</span>
          <span style={{ fontSize: 11, color: '#555', fontFamily: 'monospace' }}>{gen._source}</span>
        </div>
      </div>
    </>
  )
}

// ── 無限スクロールの1ページあたりの件数 ──────────────────────────────────
const PAGE_SIZE = 60

// ── App ───────────────────────────────────────────────────────────────────
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

  // 検索変更時はvisibleCountをリセット
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query])

  // 無限スクロール
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

      {/* React Aria Modal */}
      <ModalOverlay
        isOpen={selected !== null}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        isDismissable
        className="modal-overlay"
      >
        <Modal className="modal-wrapper">
          <Dialog className="modal-dialog">
            {selected && <VideoModalContent gen={selected} />}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  )
}
