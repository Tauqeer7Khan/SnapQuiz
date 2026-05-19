import { NextRequest, NextResponse } from 'next/server'
import { verifyAnswers } from '@/lib/gemini'
import { createServiceClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId } = body

    if (!sessionId) {
      return NextResponse.json({ error: 'No session ID provided' }, { status: 400 })
    }

    // Verify auth
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll() {},
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const serviceClient = createServiceClient()

    // Fetch all answers for this session
    const { data: answers, error: fetchError } = await serviceClient
      .from('answers')
      .select('*')
      .eq('session_id', sessionId)
      .order('question_number', { ascending: true })

    if (fetchError || !answers || answers.length === 0) {
      return NextResponse.json({ error: 'No answers found for this session' }, { status: 404 })
    }

    // Run Gemini verification pass
    const verified = await verifyAnswers(
      answers.map((a) => ({
        questionNumber: a.question_number,
        extractedText: a.extracted_text,
        correct_option: a.correct_option,
        explanation: a.explanation,
      }))
    )

    // Update each answer in DB
    const updates = verified.map((v) =>
      serviceClient
        .from('answers')
        .update({
          verified_option: v.option,
          verified_explanation: v.explanation,
          is_verified: true,
        })
        .eq('session_id', sessionId)
        .eq('question_number', v.questionNumber)
    )

    await Promise.all(updates)

    // Mark session as verified
    await serviceClient
      .from('sessions')
      .update({ verified: true })
      .eq('id', sessionId)

    return NextResponse.json({
      success: true,
      verifiedCount: verified.length,
      results: verified,
    })
  } catch (err: unknown) {
    console.error('Verify API error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
