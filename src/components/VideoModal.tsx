import { useRef } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import type { Generation } from '../types'

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

export function VideoModal({ selected, onClose }: { selected: Generation | null; onClose: () => void }) {
  return (
    <ModalOverlay
      isOpen={selected !== null}
      onOpenChange={(open) => { if (!open) onClose() }}
      isDismissable
      className="modal-overlay"
    >
      <Modal className="modal-wrapper">
        <Dialog className="modal-dialog">
          {selected && <VideoModalContent gen={selected} />}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
