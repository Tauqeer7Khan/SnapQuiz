import { solveMCQ as solveGemini, verifyAnswers as verifyGemini } from './gemini'

export interface SolveResult {
  option: string
  explanation: string
}

export interface VerifyResult {
  questionNumber: number
  option: string
  explanation: string
}

const parseSolveResponse = (text: string) => {
  // Strip markdown bold markers, asterisks, and backticks to prevent regex matching failures
  const cleanText = text.replace(/[\*\`#]/g, '').trim()

  // Parse the structured response
  const answerMatch = cleanText.match(/ANSWER\s*[:\-\=]?\s*([A-D1-4])/i)
  const explanationMatch = cleanText.match(/EXPLANATION\s*[:\-\=]?\s*(.+)/is)

  let option = answerMatch ? answerMatch[1].toUpperCase() : 'UNCLEAR'
  const explanation = explanationMatch
    ? explanationMatch[1].trim()
    : 'Could not generate an explanation for this question.'

  if (option === 'UNCLEAR') {
    // Fallback: search line-by-line for an isolated letter A, B, C, or D in lines containing ANSWER or CORRECT
    const lines = cleanText.split('\n')
    for (const line of lines) {
      if (/ANSWER|CORRECT/i.test(line)) {
        const letterMatch = line.match(/\b([A-D1-4])\b/i)
        if (letterMatch) {
          option = letterMatch[1].toUpperCase()
          break
        }
      }
    }
  }

  if (option === 'UNCLEAR') {
    throw new Error('NO_MCQ_DETECTED')
  }

  return { option, explanation }
}

const buildSolvePrompt = (extractedText: string) => `You are an expert academic tutor. Analyze the following multiple-choice question text and determine the correct answer.

QUESTION TEXT:
${extractedText}

Instructions:
1. Carefully reconstruct the question and options (A, B, C, D) even if the text has OCR typos, spelling mistakes, or is noisy.
2. Determine the single correct answer. Always provide your best guess.
3. Provide a concise but accurate explanation (2-3 sentences max).

IMPORTANT: Respond in EXACTLY this format (no deviations, do not use markdown bolding like **ANSWER:** in the format block):
ANSWER: [single letter A/B/C/D or number]
EXPLANATION: [your brief explanation here]

Do not return UNCLEAR. Always select the most reasonable option based on the text.`

const buildVerifyPrompt = (answers: any[]) => {
  const questionsBlock = answers
    .map(
      (a) =>
        `Q${a.questionNumber}:\nText: ${a.extractedText || '(no text)'}\nCurrent Answer: ${a.correct_option}\nCurrent Explanation: ${a.explanation}`
    )
    .join('\n\n---\n\n')

  return `You are an expert academic verifier. Review the following multiple-choice questions and their current answers.
For each question, verify if the answer is correct. If wrong, provide the correct answer.
Keep explanations concise (2-3 sentences).

${questionsBlock}

IMPORTANT: Respond in EXACTLY this format for each question (one per block):
Q[number]:
ANSWER: [letter or number]
EXPLANATION: [brief explanation]

---

Respond for ALL ${answers.length} questions.`
}

const parseVerifyResponse = (text: string, answers: any[]) => {
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

// ── Generic OpenAI-Compatible Fetch (works for Grok and OpenAI)
async function fetchOpenAICompat(prompt: string, apiKey: string, model: string, baseUrl: string = 'https://api.openai.com/v1/chat/completions') {
  if (!apiKey) throw new Error('API key missing for the selected provider. Please add it to your environment variables.')
  
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    })
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || 'API request failed')
  return data.choices[0].message.content
}

// ── Anthropic Fetch
async function fetchAnthropic(prompt: string, apiKey: string) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing. Please add it to your environment variables.')
  
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || 'Anthropic API request failed')
  return data.content[0].text
}

export async function solveMCQ(extractedText: string, provider: string): Promise<SolveResult> {
  const prompt = buildSolvePrompt(extractedText)

  let rawText = ''
  if (provider === 'chatgpt') {
    rawText = await fetchOpenAICompat(prompt, process.env.OPENAI_API_KEY || '', 'gpt-4o')
  } else if (provider === 'claude') {
    rawText = await fetchAnthropic(prompt, process.env.ANTHROPIC_API_KEY || '')
  } else if (provider === 'grok') {
    rawText = await fetchOpenAICompat(prompt, process.env.XAI_API_KEY || '', 'grok-1.5', 'https://api.x.ai/v1/chat/completions')
  } else {
    return solveGemini(extractedText)
  }

  console.log(`--- ${provider.toUpperCase()} SOLVE ---`)
  console.log("OCR Extracted Text:", extractedText)
  console.log("Raw AI Response:", rawText)

  return parseSolveResponse(rawText)
}

export async function verifyAnswers(answers: any[], provider: string): Promise<VerifyResult[]> {
  const prompt = buildVerifyPrompt(answers)

  let rawText = ''
  if (provider === 'chatgpt') {
    rawText = await fetchOpenAICompat(prompt, process.env.OPENAI_API_KEY || '', 'gpt-4o')
  } else if (provider === 'claude') {
    rawText = await fetchAnthropic(prompt, process.env.ANTHROPIC_API_KEY || '')
  } else if (provider === 'grok') {
    rawText = await fetchOpenAICompat(prompt, process.env.XAI_API_KEY || '', 'grok-1.5', 'https://api.x.ai/v1/chat/completions')
  } else {
    return verifyGemini(answers)
  }

  return parseVerifyResponse(rawText, answers)
}
