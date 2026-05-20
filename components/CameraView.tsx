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

    // Initialize camera with robust progressive fallback constraints
    const startCamera = useCallback(async () => {
      stopCamera()
      setInternalError(null)

      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setInternalError('Camera API not supported in this browser. Please use Chrome or Safari.')
        onStateChange?.('error')
        return
      }

      // Progressive fallback constraints
      const constraintsList: MediaStreamConstraints[] = [
        // 1. Ultra-wide back camera (if supported)
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            // Request wide-angle using standard constraint (cast to any to avoid TS errors)
            zoom: { ideal: 0.5 }
          } as any,
        },
        // 2. Back camera high resolution
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        // 2. Back camera lower resolution
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        },
        // 3. Back camera no resolution constraints
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
          },
        },
        // 4. Any video camera (basic fallback)
        {
          audio: false,
          video: true,
        },
      ]

      let stream: MediaStream | null = null
      let lastError: DOMException | null = null

      for (let i = 0; i < constraintsList.length; i++) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraintsList[i])
          break // Found a working stream!
        } catch (err: unknown) {
          const error = err as DOMException
          lastError = error
          // If the user denied permissions, stop immediately and don't try simpler constraints
          if (
            error.name === 'NotAllowedError' ||
            error.name === 'PermissionDeniedError'
          ) {
            break
          }
        }
      }

      if (!stream) {
        let msg = 'Could not access the camera. Please check your device.'
        if (lastError) {
          if (
            lastError.name === 'NotAllowedError' ||
            lastError.name === 'PermissionDeniedError'
          ) {
            msg = isIOS
              ? 'Camera access denied. Go to Settings → Safari → Camera and allow access.'
              : 'Camera permission was denied. Tap the camera icon in the browser address bar to allow access.'
          } else if (
            lastError.name === 'NotFoundError' ||
            lastError.name === 'DevicesNotFoundError'
          ) {
            msg = 'No camera found on this device.'
          } else if (
            lastError.name === 'NotReadableError' ||
            lastError.name === 'TrackStartError'
          ) {
            msg = 'Camera is in use by another app or browser tab. Please close other camera apps and refresh.'
          }
        }
        setInternalError(msg)
        onStateChange?.('error')
        return
      }

      try {
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
            // iOS sometimes needs a user gesture — the video will autoplay on interaction or tap
          }
        }

        onStateChange?.('ready')
      } catch (err: unknown) {
        console.error('Error starting video playback:', err)
        setInternalError('Could not initialize video player. Tap screen or refresh.')
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

    // Start camera when needed
    useEffect(() => {
      if (state === 'loading') {
        startCamera()
      } else if (
        (state === 'ready' || state === 'scanning' || state === 'processing') &&
        !streamRef.current
      ) {
        startCamera()
      }
    }, [state, startCamera])

    // Cleanup when component unmounts
    useEffect(() => {
      return () => {
        stopCamera()
      }
    }, [stopCamera])

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
          onClick={() => {
            if (videoRef.current && videoRef.current.paused) {
              videoRef.current.play().catch(() => {})
            }
          }}
          onTouchStart={() => {
            if (videoRef.current && videoRef.current.paused) {
              videoRef.current.play().catch(() => {})
            }
          }}
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
