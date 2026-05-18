'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
  removing?: boolean
}

interface ToastContainerProps {
  toasts: Toast[]
  onRemove: (id: string) => void
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="toast-container" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.type} ${toast.removing ? 'removing' : ''}`}
          role="alert"
        >
          <span aria-hidden="true">
            {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  )
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, removing: true } : t))
    )
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 280)
  }, [])

  const addToast = useCallback(
    (message: string, type: ToastType = 'info', duration = 4000) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((prev) => [...prev, { id, message, type }])

      const t = setTimeout(() => removeToast(id), duration)
      timeouts.current.set(id, t)
    },
    [removeToast]
  )

  useEffect(() => {
    const ts = timeouts.current
    return () => {
      ts.forEach((t) => clearTimeout(t))
    }
  }, [])

  return { toasts, addToast, removeToast }
}
