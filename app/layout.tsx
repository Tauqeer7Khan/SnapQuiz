import type { Metadata, Viewport } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'MCQ Scanner — AI-Powered Question Solver',
  description:
    'Scan multiple-choice questions with your camera, solve them instantly with AI, and store results securely.',
  keywords: ['MCQ', 'scanner', 'AI', 'multiple choice', 'question solver'],
  authors: [{ name: 'MCQ Scanner' }],
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
      </head>
      <body>{children}</body>
    </html>
  )
}
