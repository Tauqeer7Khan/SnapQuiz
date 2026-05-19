import type { Metadata, Viewport } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'MCQ Scanner — AI-Powered Question Solver',
  description:
    'Scan multiple-choice questions with your camera, solve them instantly with AI, and store results securely.',
  keywords: ['MCQ', 'scanner', 'AI', 'multiple choice', 'question solver'],
  authors: [{ name: 'MCQ Scanner' }],
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MCQ Scanner',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#08080f',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* iOS Safari full-screen PWA */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MCQ Scanner" />
        {/* Prevent iOS auto-zoom on input focus */}
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body>{children}</body>
    </html>
  )
}
