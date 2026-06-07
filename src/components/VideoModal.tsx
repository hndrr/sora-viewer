import { useEffect, useRef } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import type { Generation } from '../types'

function VideoModalContent({
  gen,
  soundEnabled,
  onSoundChange,
}: {
  gen: Generation
  soundEnabled: boolean
  onSoundChange: (enabled: boolean) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const src = gen._local ? `/video/${gen.id}` : gen.url
  const prompt = gen.prompt?.trim() ?? ''
  const title = (gen.title && gen.title !== 'New Video') ? gen.title : ''

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    video.muted = !soundEnabled
    if (soundEnabled) video.volume = 0.8

    video.play().catch(() => {
      video.muted = true
      if (soundEnabled) onSoundChange(false)
      video.play().catch(() => {})
    })
  }, [onSoundChange, src, soundEnabled])

  return (
    <div className="video-modal-layout">
      <div className="video-modal-player">
        {src ? (
          <video
            ref={videoRef}
            className="video-modal-video"
            src={src}
            controls
            autoPlay
            loop
            muted={!soundEnabled}
            playsInline
            onVolumeChange={(e) => {
              const video = e.currentTarget
              onSoundChange(!video.muted && video.volume > 0)
            }}
          />
        ) : (
          <div className="video-modal-empty">動画なし</div>
        )}
      </div>

      <aside className="video-modal-details" aria-label="Video prompt and details">
        {title && (
          <h2 className="video-modal-title">
            {title}
          </h2>
        )}

        <div className="video-modal-section-label">Prompt</div>

        {prompt ? (
          <p className="video-modal-prompt">
            {prompt}
          </p>
        ) : (
          <p className="video-modal-prompt video-modal-prompt-empty">
            (プロンプトなし)
          </p>
        )}

        <div className="video-modal-resolution">
          <span className="video-modal-resolution-label">Resolution</span>
          <span className="video-modal-resolution-value">{gen.width} × {gen.height}</span>
        </div>

        <div className="video-modal-meta">
          <span>ID: {gen.id}</span>
          <span>Task: {gen.task_id}</span>
          <span>{gen._source}</span>
        </div>
      </aside>
    </div>
  )
}

export function VideoModal({
  selected,
  onClose,
  soundEnabled,
  onSoundChange,
}: {
  selected: Generation | null
  onClose: () => void
  soundEnabled: boolean
  onSoundChange: (enabled: boolean) => void
}) {
  return (
    <ModalOverlay
      isOpen={selected !== null}
      onOpenChange={(open) => { if (!open) onClose() }}
      isDismissable
      className="modal-overlay"
    >
      <Modal className="modal-wrapper">
        <Dialog className="modal-dialog">
          {selected && (
            <VideoModalContent
              gen={selected}
              soundEnabled={soundEnabled}
              onSoundChange={onSoundChange}
            />
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
