'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type AIProvider = 'gemini' | 'chatgpt' | 'claude' | 'grok'

const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Gemini 1.5 Pro',
    authProvider: 'google',
    btnText: 'Continue with Google',
    signupUrl: 'https://aistudio.google.com/',
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT 4o',
    authProvider: 'azure',
    btnText: 'Continue with Microsoft',
    signupUrl: 'https://platform.openai.com/signup',
  },
  claude: {
    id: 'claude',
    name: 'Claude 3.5 Sonnet',
    authProvider: 'github',
    btnText: 'Continue with GitHub',
    signupUrl: 'https://console.anthropic.com/',
  },
  grok: {
    id: 'grok',
    name: 'Grok 1.5',
    authProvider: 'twitter',
    btnText: 'Continue with X',
    signupUrl: 'https://x.ai/',
  },
} as const

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedAI, setSelectedAI] = useState<AIProvider>('gemini')

  const handleLogin = async () => {
    try {
      setLoading(true)
      setError(null)

      // Persist chosen AI for the session
      localStorage.setItem('selectedAI', selectedAI)

      const providerData = PROVIDERS[selectedAI]
      const supabase = createClient()
      
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: providerData.authProvider as any,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (authError) {
        setError(authError.message)
        setLoading(false)
      }
    } catch {
      setError('An unexpected error occurred. Please try again.')
      setLoading(false)
    }
  }

  const currentProvider = PROVIDERS[selectedAI]

  return (
    <main className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo" aria-hidden="true">
          🔍
        </div>

        {/* Title */}
        <div className="login-title">
          <h1>MCQ Scanner</h1>
          <p>
            Continuous auto-scanning AI solver.
          </p>
        </div>

        <div className="login-divider" />

        {/* AI Selection */}
        <div className="ai-selector">
          <label className="ai-selector-label">Select AI Model</label>
          <div className="ai-grid">
            {(Object.keys(PROVIDERS) as AIProvider[]).map((key) => {
              const p = PROVIDERS[key]
              return (
                <button
                  key={key}
                  className={`ai-option ${selectedAI === key ? 'selected' : ''}`}
                  onClick={() => setSelectedAI(key)}
                  aria-pressed={selectedAI === key}
                >
                  {p.name}
                </button>
              )
            })}
          </div>
          <div className="signup-prompt">
            Don&apos;t have an account?{' '}
            <a href={currentProvider.signupUrl} target="_blank" rel="noreferrer">
              Sign up for {currentProvider.name}
            </a>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            role="alert"
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'var(--error-dim)',
              border: '1px solid rgba(255,95,122,0.3)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--error)',
              fontSize: '0.875rem',
              lineHeight: 1.5,
              marginBottom: '1rem'
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {/* Login Button */}
        <button
          id="btn-login"
          className="btn-google"
          onClick={handleLogin}
          disabled={loading}
          aria-label={`Sign in with ${currentProvider.authProvider}`}
        >
          {loading ? (
            <span className="spinner" />
          ) : (
            <span style={{ fontSize: '1.2rem', marginRight: '8px' }}>⚡</span>
          )}
          {loading ? 'Redirecting...' : currentProvider.btnText}
        </button>

        {/* Footer note */}
        <p className="login-footer">
          Secure sign-in powered by Supabase Auth.
          <br />
          Your data is encrypted and private.
        </p>
      </div>
    </main>
  )
}
