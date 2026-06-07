import { useEffect, useRef, useState } from 'react'
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
  const [frameNo, setFrameNo] = useState('')
  // manifest(JSON)の width/height は実体とズレる場合があるので、
  // 実際に読み込んだ動画の解像度を優先表示する
  const [actualDim, setActualDim] = useState<{ w: number; h: number } | null>(null)
  // fps はフレーム番号 ⇔ 再生時間の変換に必要（ffprobe からサーバー経由で取得）
  const [meta, setMeta] = useState<{ fps: number; frames: number } | null>(null)
  const [currentFrame, setCurrentFrame] = useState(0)
  const src = gen._local ? `/video/${gen.id}` : gen.url
  const prompt = gen.prompt?.trim() ?? ''
  const title = (gen.title && gen.title !== 'New Video') ? gen.title : ''
  const canExport = gen._local

  // サーバーが Content-Disposition を返すので <a> クリックでダウンロードされる
  const triggerDownload = (href: string) => {
    const a = document.createElement('a')
    a.href = href
    a.click()
  }

  // 入力が空なら現在のフレーム、数値が入っていればその番号を保存対象にする
  const frameToSave = frameNo.trim() === ''
    ? currentFrame
    : Math.max(0, Math.floor(Number(frameNo) || 0))

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    // src が変わったら実解像度をリセットし、読込済みなら即反映
    setActualDim(video.videoWidth ? { w: video.videoWidth, h: video.videoHeight } : null)

    video.muted = !soundEnabled
    if (soundEnabled) video.volume = 0.8

    video.play().catch(() => {
      video.muted = true
      if (soundEnabled) onSoundChange(false)
      video.play().catch(() => {})
    })
  }, [onSoundChange, src, soundEnabled])

  // fps / 総フレーム数を ffprobe から取得（ローカルのみ）
  useEffect(() => {
    setMeta(null)
    setCurrentFrame(0)
    if (!canExport) return
    let cancelled = false
    fetch(`/meta/${gen.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!cancelled && m?.fps) setMeta({ fps: m.fps, frames: m.frames })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [gen.id, canExport])

  // 現在表示中フレーム番号を追跡（requestVideoFrameCallback 優先、無ければ timeupdate）
  useEffect(() => {
    const video = videoRef.current
    if (!video || !meta?.fps) return
    const toFrame = (t: number) => setCurrentFrame(Math.round(t * meta.fps))

    if (typeof video.requestVideoFrameCallback === 'function') {
      let handle = 0
      const tick = (_now: number, md: VideoFrameCallbackMetadata) => {
        toFrame(md.mediaTime)
        handle = video.requestVideoFrameCallback(tick)
      }
      handle = video.requestVideoFrameCallback(tick)
      return () => video.cancelVideoFrameCallback(handle)
    }

    const onUpdate = () => toFrame(video.currentTime)
    video.addEventListener('timeupdate', onUpdate)
    video.addEventListener('seeked', onUpdate)
    return () => {
      video.removeEventListener('timeupdate', onUpdate)
      video.removeEventListener('seeked', onUpdate)
    }
  }, [meta])

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
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              setActualDim({ w: v.videoWidth, h: v.videoHeight })
            }}
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
          <span className="video-modal-resolution-value">
            {actualDim ? `${actualDim.w} × ${actualDim.h}` : `${gen.width} × ${gen.height}`}
          </span>
        </div>

        {canExport && (
          <section className="video-modal-export" aria-label="Export options">
            <div className="video-modal-section-label">Export</div>

            <div className="video-modal-export-row">
              <button
                type="button"
                className="video-modal-btn"
                onClick={() => triggerDownload(`/audio/${gen.id}?format=mp3`)}
              >
                音声 (MP3)
              </button>
              <button
                type="button"
                className="video-modal-btn"
                onClick={() => triggerDownload(`/audio/${gen.id}?format=m4a`)}
              >
                音声 (M4A)
              </button>
            </div>

            <div className="video-modal-frame-row">
              <input
                type="number"
                min={0}
                max={meta && meta.frames > 0 ? meta.frames - 1 : undefined}
                step={1}
                placeholder={meta ? `現在 ${currentFrame}` : 'フレーム番号'}
                value={frameNo}
                onChange={(e) => setFrameNo(e.target.value)}
                className="video-modal-frame-input"
              />
              <button
                type="button"
                className="video-modal-btn"
                onClick={() => triggerDownload(`/frame/${gen.id}?n=${frameToSave}`)}
              >
                フレームを保存
              </button>
            </div>
            {meta && (
              <div className="video-modal-frame-hint">
                全 {meta.frames} フレーム · {meta.fps.toFixed(0)} fps（空欄なら現在のフレームを保存）
              </div>
            )}
          </section>
        )}

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
