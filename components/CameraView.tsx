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
  onStateChange?: (state: CameraState) => void
}

const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(
  ({ state, errorMessage, onRetry, onStateChange }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const [internalError, setInternalError] = useState<string | null>(null)
    const [isMirrored, setIsMirrored] = useState(false)

    // Detect iOS for special handling
    const isIOS = typeof navigator !== 'undefined' &&
      /iPad|iPhone|iPod/.test(navigator.userAgent)

    // Stop all camera tracks
    const stopCamera = useCallback(() => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }, [])

    // Initialize camera with mobile-optimized constraints
    const startCamera = useCallback(async () => {
      stopCamera()
      setInternalError(null)

      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setInternalError('Camera API not supported in this browser. Please use Chrome or Safari.')
        onStateChange?.('error')
        return
      }

      // Mobile-optimized constraints - try back camera first
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' }, // Back camera on mobile
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream

          // iOS Safari requires these attributes set programmatically too
          videoRef.current.setAttribute('autoplay', '')
          videoRef.current.setAttribute('playsinline', '')
          videoRef.current.setAttribute('muted', '')

          // Detect if front camera (mirror it)
          const videoTrack = stream.getVideoTracks()[0]
          const settings = videoTrack?.getSettings()
          setIsMirrored(settings?.facingMode === 'user')

          // Use a promise-based play with fallback
          try {
            await videoRef.current.play()
          } catch {
            // iOS sometimes needs a user gesture — the video will autoplay on interaction
          }
        }

        onStateChange?.('ready')
      } catch (err: unknown) {
        const error = err as DOMException
        let msg = 'Could not access the camera. Please check your device.'

        if (
          error.name === 'NotAllowedError' ||
          error.name === 'PermissionDeniedError'
        ) {
          msg = isIOS
            ? 'Camera access denied. Go to Settings → Safari → Camera and allow access.'
            : 'Camera permission was denied. Tap the camera icon in the browser address bar to allow access.'
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          msg = 'No camera found on this device.'
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
          msg = 'Camera is in use by another app. Please close it and try again.'
        } else if (error.name === 'OverconstrainedError') {
          // Try again with relaxed constraints
          try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
            streamRef.current = fallbackStream
            if (videoRef.current) {
              videoRef.current.srcObject = fallbackStream
              videoRef.current.setAttribute('playsinline', '')
              await videoRef.current.play().catch(() => {})
            }
            onStateChange?.('ready')
            return
          } catch {
            msg = 'Camera constraints not supported. Please try a different browser.'
          }
        }

        setInternalError(msg)
        onStateChange?.('error')
      }
    }, [stopCamera, isIOS, onStateChange])

    // Expose capture method to parent
    useImperativeHandle(ref, () => ({
      capture: async (): Promise<string | null> => {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas || video.readyState < 2) return null

        const w = video.videoWidth || 1280
        const h = video.videoHeight || 720
        canvas.width = w
        canvas.height = h

        const ctx = canvas.getContext('2d')
        if (!ctx) return null

        // If mirrored (front camera), flip the canvas
        if (isMirrored) {
          ctx.translate(w, 0)
          ctx.scale(-1, 1)
        }

        ctx.drawImage(video, 0, 0, w, h)
        return canvas.toDataURL('image/jpeg', 0.88)
      },
    }))

    // Start camera on mount / when needed
    useEffect(() => {
      if (
        state === 'loading' ||
        state === 'ready' ||
        state === 'scanning' ||
        state === 'processing'
      ) {
        startCamera()
      }
      return () => {
        stopCamera()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Cleanup when component unmounts or state becomes error/idle
    useEffect(() => {
      if (state === 'idle' || state === 'error') {
        // Keep stream alive during error display so retry works
      }
    }, [state])

    // Handle page visibility change (background/foreground)
    useEffect(() => {
      const handleVisibility = () => {
        if (document.hidden) {
          stopCamera()
        } else if (state === 'ready' || state === 'scanning' || state === 'processing') {
          startCamera()
        }
      }
      document.addEventListener('visibilitychange', handleVisibility)
      return () => document.removeEventListener('visibilitychange', handleVisibility)
    }, [state, startCamera, stopCamera])

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

    const displayError = internalError || errorMessage

    if (state === 'error' || displayError) {
      return (
        <div className="camera-container" style={{ display: 'flex' }}>
          <div className="camera-error">
            <div className="camera-error-icon">📷</div>
            <h3>Camera Unavailable</h3>
            <p>
              {displayError ||
                'Camera access was denied. Please allow camera permissions in your browser settings and try again.'}
            </p>
            {isIOS && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                iOS: Settings → Safari → Camera → Allow
              </p>
            )}
            {onRetry && (
              <button
                id="btn-camera-retry"
                className="btn-verify"
                onClick={() => {
                  setInternalError(null)
                  onRetry()
                }}
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
          playsInline  // CRITICAL for iOS Safari — prevents fullscreen takeover
          muted
          disablePictureInPicture
          aria-label="Camera viewfinder"
          style={isMirrored ? { transform: 'scaleX(-1)' } : undefined}
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
