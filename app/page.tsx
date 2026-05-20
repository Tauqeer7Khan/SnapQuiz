'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async () => {
    try {
      setLoading(true)
      setError(null)

      const supabase = createClient()
      
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
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

        {/* Login Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            id={`btn-login-google`}
            className="btn-google"
            onClick={handleLogin}
            disabled={loading}
            aria-label={`Sign in with Google`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--foreground)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {loading ? (
              <span className="spinner" />
            ) : (
              <span style={{ fontSize: '1.2rem', marginRight: '8px' }}>🇬</span>
            )}
            {loading ? 'Redirecting...' : 'Continue with Google'}
          </button>
        </div>

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
