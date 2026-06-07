import { useState } from 'react'
import type { Generation } from '../types'

const S = {
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
}

function aspectRatio(w: number, h: number) {
  const r = w / h
  if (r > 1.3) return '16/9'
  if (r < 0.8) return '9/16'
  return '1/1'
}

export function VideoCard({ gen, onSelect }: { gen: Generation; onSelect: (g: Generation) => void }) {
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
