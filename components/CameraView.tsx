'use client'

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react'

export type CameraState = 'idle' | 'loading' | 'ready' | 'scanning' | 'processing' | 'error'

export interface CameraViewHandle {
  capture: () => Promise<string | null>
}

interface CameraViewProps {
  state: CameraState
  errorMessage?: string
  onRetry?: () => void
}

const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(
  ({ state, errorMessage, onRetry }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const streamRef = useRef<MediaStream | null>(null)

    // Initialize camera
    const startCamera = useCallback(async () => {
      try {
        // Stop any existing stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' }, // Back camera on mobile
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        })

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (err) {
        console.error('Camera error:', err)
        throw err
      }
    }, [])

    // Expose capture method to parent
    useImperativeHandle(ref, () => ({
      capture: async (): Promise<string | null> => {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas) return null

        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        const ctx = canvas.getContext('2d')
        if (!ctx) return null

        ctx.drawImage(video, 0, 0)
        return canvas.toDataURL('image/jpeg', 0.92)
      },
    }))

    useEffect(() => {
      if (state === 'loading' || state === 'ready' || state === 'scanning' || state === 'processing') {
        startCamera().catch(console.error)
      }
      return () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
        }
      }
    }, [])

    const containerClass = [
      'camera-container',
      state === 'scanning' ? 'scanning' : '',
      state === 'processing' ? 'processing' : '',
    ]
      .filter(Boolean)
      .join(' ')

    const statusText: Record<CameraState, string> = {
      idle: 'Initializing...',
      loading: 'Starting camera...',
      ready: '● Live',
      scanning: '◌ Scanning...',
      processing: '⟳ Processing...',
      error: '✕ Camera error',
    }

    const statusClass: Record<CameraState, string> = {
      idle: 'camera-status',
      loading: 'camera-status',
      ready: 'camera-status ready',
      scanning: 'camera-status scanning',
      processing: 'camera-status scanning',
      error: 'camera-status error',
    }

    if (state === 'error') {
      return (
        <div className="camera-container" style={{ display: 'flex' }}>
          <div className="camera-error">
            <div className="camera-error-icon">📷</div>
            <h3>Camera Unavailable</h3>
            <p>
              {errorMessage ||
                'Camera access was denied. Please allow camera permissions in your browser settings and try again.'}
            </p>
            {onRetry && (
              <button
                id="btn-camera-retry"
                className="btn-verify"
                onClick={onRetry}
                style={{ marginTop: '8px' }}
              >
                Try Again
              </button>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className={containerClass}>
        <video
          ref={videoRef}
          className="camera-video"
          autoPlay
          playsInline
          muted
          aria-label="Camera viewfinder"
        />

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />

        {/* Corner brackets overlay */}
        <div className="camera-overlay" aria-hidden="true">
          <div className="camera-corner-tr" />
          <div className="camera-corner-bl" />
          <div className="scan-line" />
        </div>

        <span className={statusClass[state]} role="status" aria-live="polite">
          {statusText[state]}
        </span>
      </div>
    )
  }
)

CameraView.displayName = 'CameraView'
export default CameraView
