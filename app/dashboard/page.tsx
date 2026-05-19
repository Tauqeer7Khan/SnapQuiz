'use client'

export const dynamic = 'force-dynamic'


import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import CameraView, { CameraState, CameraViewHandle } from '@/components/CameraView'
import AnswerList, { Answer } from '@/components/AnswerList'
import { ToastContainer, useToasts } from '@/components/Toast'
import type { User } from '@supabase/supabase-js'

const MAX_QUESTIONS = 10

export default function DashboardPage() {
  const router = useRouter()
  const supabaseRef = useRef<SupabaseClient | null>(null)
  const getSupabase = () => {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }

  // Auth
  const [user, setUser] = useState<User | null>(null)

  // Session
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionVerified, setSessionVerified] = useState(false)

  // Camera
  const cameraRef = useRef<CameraViewHandle>(null)
  const [cameraState, setCameraState] = useState<CameraState>('loading')
  const [cameraError, setCameraError] = useState<string>('')

  // Answers
  const [answers, setAnswers] = useState<Answer[]>([])
  const [currentQuestion, setCurrentQuestion] = useState(1)

  // UI state
  const [isCapturing, setIsCapturing] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)

  const { toasts, addToast, removeToast } = useToasts()

  // ── Auth ───────────────────────────────────────────────
  useEffect(() => {
    const supabase = getSupabase()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace('/')
        return
      }
      setUser(user)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') router.replace('/')
      if (session?.user) setUser(session.user)
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Camera Init ────────────────────────────────────────
  useEffect(() => {
    if (!user) return

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        stream.getTracks().forEach((track) => track.stop())
        setCameraState('ready')
      } catch (err: unknown) {
        const error = err as Error
        setCameraState('error')
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          setCameraError('Camera permission was denied. Please allow camera access in your browser settings.')
        } else if (error.name === 'NotFoundError') {
          setCameraError('No camera found on this device.')
        } else {
          setCameraError('Could not access the camera. Please check your device.')
        }
      }
    }

    initCamera()
  }, [user])

  // ── Session Management ─────────────────────────────────
  const createSession = useCallback(async (): Promise<string | null> => {
    if (!user) return null
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('sessions')
      .insert({ user_id: user.id })
      .select('id')
      .single()
    if (error || !data) {
      addToast('Failed to create session. Check database connection.', 'error')
      return null
    }
    return data.id
  }, [user, addToast])

  const startNewSession = useCallback(async () => {
    setAnswers([])
    setCurrentQuestion(1)
    setSessionVerified(false)
    setCameraState('ready')
    const id = await createSession()
    setSessionId(id)
    if (id) addToast('New session started — ready to scan!', 'info')
  }, [createSession, addToast])

  // Create initial session once user is set
  useEffect(() => {
    if (user && !sessionId) {
      createSession().then((id) => setSessionId(id))
    }
  }, [user])

  // ── Capture & Solve ────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing || cameraState !== 'ready') return
    if (currentQuestion > MAX_QUESTIONS) {
      addToast(`Maximum ${MAX_QUESTIONS} questions per session. Start a new session.`, 'info')
      return
    }
    if (!sessionId) {
      addToast('No active session. Please wait or refresh.', 'error')
      return
    }

    try {
      setIsCapturing(true)
      setCameraState('scanning')

      // Capture frame from video
      const imageData = await cameraRef.current.capture()
      if (!imageData) {
        addToast('Failed to capture image from camera.', 'error')
        setCameraState('ready')
        setIsCapturing(false)
        return
      }

      setCameraState('processing')

      // Send to API
      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageData,
          sessionId,
          questionNumber: currentQuestion,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        addToast(result.error || 'Failed to process question.', 'error')
        setCameraState('ready')
        setIsCapturing(false)
        return
      }

      // Add to local state
      const newAnswer: Answer = {
        id: result.answer.id,
        questionNumber: result.answer.questionNumber,
        option: result.answer.option,
        explanation: result.answer.explanation,
      }

      setAnswers((prev) => {
        const exists = prev.findIndex((a) => a.questionNumber === newAnswer.questionNumber)
        if (exists >= 0) {
          const updated = [...prev]
          updated[exists] = newAnswer
          return updated
        }
        return [...prev, newAnswer].sort((a, b) => a.questionNumber - b.questionNumber)
      })

      setCurrentQuestion((prev) => prev + 1)
      addToast(`Q${result.answer.questionNumber} → ${result.answer.option} saved!`, 'success')
      setCameraState('ready')
    } catch {
      addToast('Network error. Please check your connection and try again.', 'error')
      setCameraState('ready')
    } finally {
      setIsCapturing(false)
    }
  }, [cameraRef, isCapturing, cameraState, currentQuestion, sessionId, addToast])

  // ── Verify Answers ─────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (!sessionId || answers.length === 0 || isVerifying) return

    try {
      setIsVerifying(true)
      addToast('Running AI accuracy check on all answers...', 'info', 6000)

      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      const result = await response.json()

      if (!response.ok) {
        addToast(result.error || 'Verification failed.', 'error')
        return
      }

      // Update local answers with verified data
      setAnswers((prev) =>
        prev.map((a) => {
          const verified = result.results.find(
            (r: { questionNumber: number; option: string; explanation: string }) =>
              r.questionNumber === a.questionNumber
          )
          if (!verified) return a
          return {
            ...a,
            verifiedOption: verified.option,
            verifiedExplanation: verified.explanation,
            isVerified: true,
          }
        })
      )

      setSessionVerified(true)
      addToast(
        `Verified ${result.verifiedCount} answer${result.verifiedCount !== 1 ? 's' : ''}. Session complete!`,
        'success',
        6000
      )
    } catch {
      addToast('Verification failed due to a network error.', 'error')
    } finally {
      setIsVerifying(false)
    }
  }, [sessionId, answers, isVerifying, addToast])

  // ── Sign Out ───────────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    await getSupabase().auth.signOut()
  }, [])

  // ── Keyboard shortcut: Space = capture ────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        handleCapture()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleCapture])

  const canCapture =
    cameraState === 'ready' &&
    !isCapturing &&
    currentQuestion <= MAX_QUESTIONS &&
    !!sessionId

  const canVerify =
    answers.length > 0 &&
    !isVerifying &&
    !sessionVerified &&
    !!sessionId

  const avatarLetter = user?.user_metadata?.name?.[0]?.toUpperCase() ||
    user?.email?.[0]?.toUpperCase() || '?'

  return (
    <>
      <div className="dashboard">
        {/* ── Header ───────────────────────────────── */}
        <header className="header">
          <div className="header-left">
            <div className="header-logo" aria-hidden="true">🔍</div>
            <span className="header-title">MCQ Scanner</span>
          </div>

          <div className="header-right">
            <div className="user-avatar" title={user?.email || ''} aria-label={`Signed in as ${user?.email}`}>
              {avatarLetter}
            </div>
            <button
              id="btn-sign-out"
              className="btn-ghost"
              onClick={handleSignOut}
              aria-label="Sign out"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* ── Camera Panel ─────────────────────────── */}
        <main className="camera-panel" aria-label="Camera view">
          <CameraView
            ref={cameraRef}
            state={cameraState}
            errorMessage={cameraError}
            onRetry={() => {
              setCameraState('loading')
              setCameraError('')
              window.location.reload()
            }}
          />

          {/* Controls */}
          <div className="camera-controls">
            {/* Question counter */}
            <div className="question-badge">
              <span>Question</span>
              <span className="question-num" aria-live="polite" aria-label={`Question ${currentQuestion} of ${MAX_QUESTIONS}`}>
                {currentQuestion > MAX_QUESTIONS ? MAX_QUESTIONS : currentQuestion}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  &nbsp;/&nbsp;{MAX_QUESTIONS}
                </span>
              </span>
            </div>

            {/* Capture button */}
            <button
              id="btn-capture"
              className="btn-capture"
              onClick={handleCapture}
              disabled={!canCapture}
              aria-label={isCapturing ? 'Processing...' : 'Capture question (Space)'}
              title="Capture question (Space)"
            >
              {isCapturing ? (
                <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
              ) : (
                <span aria-hidden="true">📸</span>
              )}
            </button>

            {/* New session */}
            <button
              id="btn-new-session"
              className="btn-new-session"
              onClick={startNewSession}
              aria-label="Start a new session"
            >
              ↺ New
            </button>
          </div>
        </main>

        {/* ── Sidebar ──────────────────────────────── */}
        <aside className="sidebar" aria-label="Answer list">
          <div className="sidebar-header">
            <h2>Answers</h2>
            <span className={`session-badge ${sessionVerified ? 'verified' : ''}`}>
              {sessionVerified ? '✓ Verified' : `${answers.length} / ${MAX_QUESTIONS}`}
            </span>
          </div>

          <div className="sidebar-scroll" role="list" aria-label="Scanned answers">
            <AnswerList answers={answers} sessionVerified={sessionVerified} />
          </div>

          <div className="sidebar-footer">
            <button
              id="btn-verify"
              className="btn-verify"
              onClick={handleVerify}
              disabled={!canVerify}
              aria-label="Verify all answers with AI"
            >
              {isVerifying ? (
                <>
                  <span className="spinner" />
                  Verifying...
                </>
              ) : (
                <>
                  <span aria-hidden="true">✓</span>
                  Verify Answers
                </>
              )}
            </button>

            {sessionVerified && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                Session finalized. Start a new session to scan more.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  )
}
