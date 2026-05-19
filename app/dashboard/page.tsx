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
import Tesseract from 'tesseract.js'

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
  const [isScanning, setIsScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [autoScanMode, setAutoScanMode] = useState(true)

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
    // CameraView handles its own initialization and reports state via onStateChange
    // We just set loading to trigger CameraView to start
    setCameraState('loading')
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

  // ── Auto-Capture Loop ──────────────────────────────────
  const isProcessingRef = useRef(false)
  const autoScanInterval = useRef<NodeJS.Timeout | null>(null)

  const processFrame = useCallback(async (isManual = false) => {
    if (!cameraRef.current || isProcessingRef.current || cameraState !== 'ready') return
    if (currentQuestion > MAX_QUESTIONS || !sessionId || sessionVerified) return

    try {
      isProcessingRef.current = true
      setCameraState('scanning')
      setIsScanning(true)
      setScanProgress(0)

      // Capture frame from video
      const imageData = await cameraRef.current.capture()
      if (!imageData) {
        if (isManual) {
          addToast('Could not access camera feed. Please check permissions.', 'error')
        }
        setCameraState('ready')
        setIsScanning(false)
        isProcessingRef.current = false
        return
      }

      // Step 1: Client-side Tesseract.js OCR
      const { data: { text } } = await Tesseract.recognize(
        imageData,
        'eng',
        {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              setScanProgress(Math.round(m.progress * 100))
            }
          }
        }
      )

      setIsScanning(false)

      if (!text || !text.trim()) {
        if (isManual) {
          addToast('Could not extract any text. Please hold steady and try again!', 'info')
        }
        setCameraState('ready')
        isProcessingRef.current = false
        return
      }

      setCameraState('processing')
      const selectedAI = localStorage.getItem('selectedAI') || 'gemini'

      // Step 2: Solve the MCQ using client-extracted text
      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extractedText: text,
          sessionId,
          questionNumber: currentQuestion,
          provider: selectedAI
        }),
      })

      const result = await response.json()

      // If it fails with a 422 (No MCQ detected)
      if (response.status === 422) {
        if (isManual) {
          addToast('No multiple-choice question detected. Please align the question and options.', 'info')
        }
        setCameraState('ready')
        isProcessingRef.current = false
        return
      }

      if (!response.ok) {
        addToast(result.error || 'Failed to process question.', 'error')
        setCameraState('ready')
        isProcessingRef.current = false
        return
      }

      // Add initial answer to local state
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

      addToast(`Q${result.answer.questionNumber} solved via ${selectedAI.toUpperCase()}! Auditing now...`, 'info')

      // Step 3: Auto-verify immediately
      const verifyRes = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, provider: selectedAI }),
      })
      
      const verifyResult = await verifyRes.json()
      if (verifyRes.ok && verifyResult.results) {
         setAnswers((prev) =>
           prev.map((a) => {
             const verified = verifyResult.results.find(
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
         addToast(`Q${result.answer.questionNumber} verified!`, 'success')
      } else {
         addToast(`Q${result.answer.questionNumber} verification failed.`, 'error')
      }

      setCurrentQuestion((prev) => prev + 1)
      setCameraState('ready')
      isProcessingRef.current = false

    } catch (err) {
      console.error(err)
      if (isManual) {
        addToast('An error occurred while solving the question.', 'error')
      }
      setIsScanning(false)
      setCameraState('ready')
      isProcessingRef.current = false
    }
  }, [cameraRef, cameraState, currentQuestion, sessionId, sessionVerified, addToast])

  // Continuous loop trigger
  useEffect(() => {
    if (autoScanMode && cameraState === 'ready' && !sessionVerified && currentQuestion <= MAX_QUESTIONS && !!sessionId) {
      // Cool down period of 2.5s between scans
      autoScanInterval.current = setInterval(() => processFrame(false), 2500)
    } else if (autoScanInterval.current) {
      clearInterval(autoScanInterval.current)
    }
    return () => {
      if (autoScanInterval.current) clearInterval(autoScanInterval.current)
    }
  }, [autoScanMode, cameraState, sessionVerified, currentQuestion, sessionId, processFrame])

  // ── Sign Out ───────────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    await getSupabase().auth.signOut()
  }, [])

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
            onStateChange={(newState) => {
              setCameraState(newState)
              if (newState === 'error') {
                setCameraError('')  // CameraView has its own error message
              }
            }}
            onRetry={() => {
              setCameraState('loading')
              setCameraError('')
            }}
          />

          {/* Mode Selector Toggle */}
          <div className="scan-mode-toggle" id="toggle-scan-mode">
            <button
              className={`scan-mode-btn ${autoScanMode ? 'active' : ''}`}
              onClick={() => setAutoScanMode(true)}
              aria-label="Auto-Scan Mode"
            >
              🔄 Auto-Scan
            </button>
            <button
              className={`scan-mode-btn ${!autoScanMode ? 'active' : ''}`}
              onClick={() => setAutoScanMode(false)}
              aria-label="Manual Mode"
            >
              ⚡ Manual
            </button>
          </div>

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

            {/* Dynamic Controls based on scan mode */}
            {autoScanMode ? (
              <div className={`auto-scan-indicator ${cameraState === 'scanning' || cameraState === 'processing' || isScanning ? 'active' : ''}`}>
                {isScanning ? (
                  <>
                    <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                    <span>OCR: {scanProgress}%</span>
                  </>
                ) : cameraState === 'scanning' || cameraState === 'processing' ? (
                  <>
                    <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                    <span>{cameraState === 'processing' ? 'Solving...' : 'Capturing...'}</span>
                  </>
                ) : (
                  <>
                    <span className="pulsing-dot" />
                    <span>Auto-Scan Active</span>
                  </>
                )}
              </div>
            ) : (
              <button
                id="btn-manual-capture"
                className="btn-manual-capture"
                onClick={() => processFrame(true)}
                disabled={cameraState !== 'ready' || isScanning || sessionVerified || currentQuestion > MAX_QUESTIONS}
                aria-label="Capture and solve question"
              >
                {isScanning ? (
                  <>
                    <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'white' }} />
                    <span>OCR: {scanProgress}%</span>
                  </>
                ) : cameraState === 'scanning' || cameraState === 'processing' ? (
                  <>
                    <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'white' }} />
                    <span>Solving...</span>
                  </>
                ) : (
                  <>
                    <span>⚡ Solve Question</span>
                  </>
                )}
              </button>
            )}

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
            <div className="sidebar-status-box">
              {sessionVerified ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--success-color)', textAlign: 'center', margin: 0, fontWeight: 500 }}>
                  ✓ Session Complete
                </p>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                  Questions are automatically audited after being solved.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  )
}
