import { NextRequest, NextResponse } from 'next/server'
import { extractTextFromImage } from '@/lib/vision'
import { solveMCQ } from '@/lib/gemini'
import { createServiceClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { image, sessionId, questionNumber } = body

    // Validate required fields
    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }
    if (!sessionId) {
      return NextResponse.json({ error: 'No session ID provided' }, { status: 400 })
    }
    if (!questionNumber || questionNumber < 1 || questionNumber > 50) {
      return NextResponse.json({ error: 'Invalid question number' }, { status: 400 })
    }

    // Verify auth via cookie
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll() {},
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Step 1: Extract text from image via Google Cloud Vision
    let extractedText: string
    try {
      extractedText = await extractTextFromImage(image)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (message === 'NO_TEXT_DETECTED') {
        return NextResponse.json(
          { error: 'Could not detect any text in the image. Please ensure the question is clearly visible and try again.' },
          { status: 422 }
        )
      }
      if (message === 'VISION_TIMEOUT') {
        return NextResponse.json(
          { error: 'Image processing timed out. Please check your connection and try again.' },
          { status: 408 }
        )
      }
      throw err
    }

    // Step 2: Solve the MCQ using Gemini
    let solved: { option: string; explanation: string }
    try {
      solved = await solveMCQ(extractedText)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (message === 'NO_MCQ_DETECTED') {
        return NextResponse.json(
          { error: 'No multiple-choice question detected. Please scan a clear MCQ image.' },
          { status: 422 }
        )
      }
      if (message === 'GEMINI_TIMEOUT') {
        return NextResponse.json(
          { error: 'AI solver timed out. Please try again.' },
          { status: 408 }
        )
      }
      throw err
    }

    // Step 3: Store in database
    const serviceClient = createServiceClient()

    const { data: answer, error: insertError } = await serviceClient
      .from('answers')
      .insert({
        session_id: sessionId,
        question_number: questionNumber,
        extracted_text: extractedText,
        correct_option: solved.option,
        explanation: solved.explanation,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Database insert error:', insertError)
      return NextResponse.json({ error: 'Failed to save answer to database' }, { status: 500 })
    }

    // Update session question count
    await serviceClient
      .from('sessions')
      .update({ question_count: questionNumber })
      .eq('id', sessionId)

    return NextResponse.json({
      success: true,
      answer: {
        id: answer.id,
        questionNumber,
        option: solved.option,
        explanation: solved.explanation,
        extractedText,
      },
    })
  } catch (err: unknown) {
    console.error('Solve API error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
