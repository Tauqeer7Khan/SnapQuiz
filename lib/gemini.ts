import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

export interface SolveResult {
  option: string       // e.g. "A", "B", "C", "D"
  explanation: string
}

export interface VerifyResult {
  questionNumber: number
  option: string
  explanation: string
}

/**
 * Solve a multiple-choice question using Gemini 1.5 Flash.
 */
export async function solveMCQ(extractedText: string): Promise<SolveResult> {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  const prompt = `You are an expert academic tutor. Analyze the following multiple-choice question and determine the correct answer.

QUESTION TEXT:
${extractedText}

Instructions:
1. Carefully read the question and all options (A, B, C, D or 1, 2, 3, 4).
2. Determine the single correct answer.
3. Provide a concise but accurate explanation (2-3 sentences max).

IMPORTANT: Respond in EXACTLY this format (no deviations):
ANSWER: [single letter A/B/C/D or number]
EXPLANATION: [your brief explanation here]

If you cannot identify a clear multiple-choice question in the text, respond:
ANSWER: UNCLEAR
EXPLANATION: The scanned text does not contain a recognizable multiple-choice question.`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()

    // Parse the structured response
    const answerMatch = text.match(/ANSWER:\s*([A-Da-d1-4])/i)
    const explanationMatch = text.match(/EXPLANATION:\s*(.+?)(?=\nANSWER:|$)/is)

    const option = answerMatch ? answerMatch[1].toUpperCase() : 'UNCLEAR'
    const explanation = explanationMatch
      ? explanationMatch[1].trim()
      : 'Could not generate an explanation for this question.'

    if (option === 'UNCLEAR') {
      throw new Error('NO_MCQ_DETECTED')
    }

    return { option, explanation }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('GEMINI_TIMEOUT')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Re-verify all answers in a session for accuracy.
 */
export async function verifyAnswers(
  answers: Array<{
    questionNumber: number
    extractedText: string | null
    correct_option: string
    explanation: string
  }>
): Promise<VerifyResult[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  const questionsBlock = answers
    .map(
      (a) =>
        `Q${a.questionNumber}:\nText: ${a.extractedText || '(no text)'}\nCurrent Answer: ${a.correct_option}\nCurrent Explanation: ${a.explanation}`
    )
    .join('\n\n---\n\n')

  const prompt = `You are an expert academic verifier. Review the following multiple-choice questions and their current answers.
For each question, verify if the answer is correct. If wrong, provide the correct answer.
Keep explanations concise (2-3 sentences).

${questionsBlock}

IMPORTANT: Respond in EXACTLY this format for each question (one per block):
Q[number]:
ANSWER: [letter or number]
EXPLANATION: [brief explanation]

---

Respond for ALL ${answers.length} questions.`

  const result = await model.generateContent(prompt)
  const text = result.response.text().trim()

  // Parse each Q block
  const blocks = text.split(/\n---+\n/).filter((b) => b.trim())
  const verified: VerifyResult[] = []

  for (const block of blocks) {
    const qMatch = block.match(/Q(\d+):/i)
    const answerMatch = block.match(/ANSWER:\s*([A-Da-d1-4])/i)
    const explanationMatch = block.match(/EXPLANATION:\s*(.+?)(?=\nQ\d+:|$)/is)

    if (qMatch && answerMatch) {
      verified.push({
        questionNumber: parseInt(qMatch[1]),
        option: answerMatch[1].toUpperCase(),
        explanation: explanationMatch ? explanationMatch[1].trim() : answers[verified.length]?.explanation || '',
      })
    }
  }

  // Fill in any missing entries with original answers
  for (const original of answers) {
    if (!verified.find((v) => v.questionNumber === original.questionNumber)) {
      verified.push({
        questionNumber: original.questionNumber,
        option: original.correct_option,
        explanation: original.explanation,
      })
    }
  }

  return verified.sort((a, b) => a.questionNumber - b.questionNumber)
}
