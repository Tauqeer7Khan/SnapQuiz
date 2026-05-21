import { NextResponse } from 'next/server';
// import { VertexAI } from '@google-cloud/vertexai';
import Groq from 'groq-sdk';

const parseAIResponse = (text: string) => {
  const cleanText = text.replace(/[\*\`#]/g, '').trim();
  const answerMatch = cleanText.match(/ANSWER\s*[:\-\=]?\s*([A-D1-4])/i);
  const explanationMatch = cleanText.match(/EXPLANATION\s*[:\-\=]?\s*(.+)/is);

  let option = answerMatch ? answerMatch[1].toUpperCase() : 'UNCLEAR';
  let explanation = explanationMatch ? explanationMatch[1].trim() : 'Could not generate an explanation for this question.';

  if (option === 'UNCLEAR') {
    const lines = cleanText.split('\n');
    for (const line of lines) {
      if (/ANSWER|CORRECT/i.test(line)) {
        const letterMatch = line.match(/\b([A-D1-4])\b/i);
        if (letterMatch) {
          option = letterMatch[1].toUpperCase();
          break;
        }
      }
    }
  }

  return { option, explanation };
};

const buildSolvePrompt = (extractedText: string) => `You are an expert academic tutor. Analyze the following multiple-choice question text and determine the correct answer.

QUESTION TEXT:
${extractedText}

Instructions:
1. Carefully reconstruct the question and options (A, B, C, D) even if the text has OCR typos, spelling mistakes, or is noisy.
2. Determine the single correct answer. Always provide your best guess.
3. Provide a concise but accurate explanation (2-3 sentences max).

IMPORTANT: Respond in EXACTLY this format (no deviations):
ANSWER: [single letter A/B/C/D or number]
EXPLANATION: [your brief explanation here]

Do not return UNCLEAR. Always select the most reasonable option based on the text.`;

const buildVerifyPrompt = (extractedText: string, currentAnswer: string) => `You are an expert academic auditor. Review the following multiple-choice question and the proposed answer.

QUESTION TEXT:
${extractedText}

PROPOSED ANSWER: Option ${currentAnswer}

Instructions:
Are you absolutely sure this is the correct answer? Verify against facts. 
If the proposed answer is correct, confirm it. If it is wrong, provide the correct answer.

IMPORTANT: Respond in EXACTLY this format (no deviations):
ANSWER: [single letter A/B/C/D or number]
EXPLANATION: [your brief explanation here]`;

const buildCodingPrompt = (extractedText: string) => `You are an expert software engineer and computer science tutor. Analyze the following programming or algorithmic problem.

PROBLEM TEXT:
${extractedText}

Instructions:
1. Carefully reconstruct the problem statement, even if there are OCR typos or noise.
2. Identify the problem type (e.g., Data Structures, Algorithms, Graph Theory, Dynamic Programming).
3. Provide the optimal solution approach, the correct answer or algorithm, and a concise explanation.

IMPORTANT: Respond in EXACTLY this format:
ANSWER: [The correct option letter, or a brief direct answer if no options are given]
EXPLANATION: [Clear step-by-step explanation of the solution approach, 3-5 sentences max]

Do not return UNCLEAR. Always reason through the problem and provide the best possible answer.`;

// ─── Validation Guardrail Configuration ───────────────────────────────────────
const VALIDATION_THRESHOLDS = {
  MIN_CONFIDENCE: 60,           // Tesseract confidence % — below this, reject early
  MCQ_MIN_CHARS: 20,            // Profile A: MCQ minimum character count
  CODING_MIN_CHARS: 50,         // Profile B: Coding question minimum character count
  MIN_ALPHANUMERIC_RATIO: 0.3,  // Minimum ratio of alphanumeric to total characters
} as const;

// MCQ indicators — Profile A
const MCQ_INDICATORS = /\bA[.)\s]|\bB[.)\s]|\bC[.)\s]|\bD[.)\s]|\?|\boption\b|\bchoose\b|\bwhich\b|\bselect\b|\bcorrect\b/i;

// Coding / Algorithmic question indicators — Profile B
const CODING_INDICATORS = /\bInput[:\s]|\bOutput[:\s]|\bTest\s*[Cc]ase|\bExplanation[:\s]|\bConstraints[:\s]|\bvoid\b|\bfunction\b|\breturn\b|\bint\b|\barray\b|\bstring\b|\balgorithm\b|\bcomplexity\b|\bO\([^)]+\)/i;

type QuestionProfile = 'mcq' | 'coding' | 'invalid';

interface ValidationResult {
  valid: boolean;
  profile: QuestionProfile;
  reason?: string;
}

/**
 * Validation Guardrail — inspects OCR text and classifies it into:
 *   Profile A: MCQ question (≥ 20 chars + MCQ indicators)
 *   Profile B: Coding/Algorithmic question (≥ 50 chars + programming indicators)
 *   Invalid: gibberish, too short, or not enough alphanumeric content
 */
function validateText(ocrText: string): ValidationResult {
  const trimmed = ocrText.trim();
  const alphanumericCount = (trimmed.match(/[a-zA-Z0-9]/g) || []).length;
  const alphanumericRatio = trimmed.length > 0 ? alphanumericCount / trimmed.length : 0;

  // Hard gate 1: Gibberish rejection — too short or mostly special characters
  if (
    !trimmed ||
    trimmed.length < VALIDATION_THRESHOLDS.MCQ_MIN_CHARS ||
    alphanumericRatio < VALIDATION_THRESHOLDS.MIN_ALPHANUMERIC_RATIO
  ) {
    return {
      valid: false,
      profile: 'invalid',
      reason: `Gibberish/too short. Length: ${trimmed.length}, AlphanumericRatio: ${alphanumericRatio.toFixed(2)}`,
    };
  }

  // Profile A check: MCQ
  if (trimmed.length >= VALIDATION_THRESHOLDS.MCQ_MIN_CHARS && MCQ_INDICATORS.test(trimmed)) {
    return { valid: true, profile: 'mcq' };
  }

  // Profile B check: Coding / Algorithmic question
  if (trimmed.length >= VALIDATION_THRESHOLDS.CODING_MIN_CHARS && CODING_INDICATORS.test(trimmed)) {
    return { valid: true, profile: 'coding' };
  }

  // Hard gate 2: Sufficient length but no recognizable pattern — reject
  return {
    valid: false,
    profile: 'invalid',
    reason: `No MCQ or coding patterns detected. Length: ${trimmed.length}`,
  };
}

/*
async function callVertexAI(prompt: string) {
  const vertexAI = new VertexAI({
    project: process.env.VERTEX_PROJECT_ID,
    location: 'us-central1',
    googleAuthOptions: {
      credentials: {
        client_email: process.env.VERTEX_CLIENT_EMAIL,
        private_key: process.env.VERTEX_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }
    }
  });

  const model = vertexAI.getGenerativeModel({ model: 'gemini-1.5-pro-preview-0409' });
  const resp = await model.generateContent(prompt);
  if (!resp.response.candidates || resp.response.candidates.length === 0) {
    throw new Error('No candidates returned from Vertex AI');
  }
  return resp.response.candidates[0].content.parts[0].text || '';
}
*/

async function callGroq(prompt: string, retries = 3, backoffMs = 1000): Promise<string> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  
  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama3-8b-8192',
    });
    return completion.choices[0]?.message?.content || '';
  } catch (error: any) {
    const isRateLimit = error?.status === 429;
    const isTimeout = error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET' || error?.type === 'timeout' || error?.message?.toLowerCase().includes('timeout');
    
    if (retries > 0 && (isRateLimit || isTimeout)) {
      console.warn(`[Groq API] ${isRateLimit ? 'Rate limit' : 'Timeout'} encountered. Retrying in ${backoffMs}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return callGroq(prompt, retries - 1, backoffMs * 2);
    }
    throw error;
  }
}

async function callAI(provider: string, prompt: string) {
  if (provider === 'gemini') {
    // return callVertexAI(prompt);
    throw new Error('Gemini is temporarily unavailable. Please select Groq.');
  } else if (provider === 'groq') {
    return callGroq(prompt);
  }
  throw new Error('Unsupported provider');
}

export async function POST(req: Request) {
  try {
    const { extractedText, ocrConfidence, provider } = await req.json();

    if (!extractedText || !provider) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── Guardrail 1: Tesseract Confidence Score Gate ──────────────────────────
    // Reject early if Tesseract was not confident enough to produce usable text.
    if (ocrConfidence !== undefined && ocrConfidence !== null && ocrConfidence < VALIDATION_THRESHOLDS.MIN_CONFIDENCE) {
      console.error(`[OCR Failure] Tesseract confidence too low: ${ocrConfidence.toFixed(1)}% (threshold: ${VALIDATION_THRESHOLDS.MIN_CONFIDENCE}%)`);
      return NextResponse.json(
        { error: 'Scan unclear. Please ensure good lighting and try again.' },
        { status: 422 }
      );
    }

    // ── Guardrail 2: Dual-Profile Text Validation ────────────────────────────
    // Classifies text as MCQ, Coding, or invalid gibberish — zero garbage to Groq.
    const validation = validateText(extractedText);
    if (!validation.valid) {
      console.error('[OCR Failure] Text failed validation guardrail.', validation.reason);
      return NextResponse.json(
        { error: 'Could not extract clear question text. Please try scanning again.' },
        { status: 422 }
      );
    }

    console.log(`[Validation] Passed. Profile: ${validation.profile.toUpperCase()} | Length: ${extractedText.trim().length} chars | Confidence: ${ocrConfidence?.toFixed(1) ?? 'N/A'}%`);

    // ── Route to the correct prompt based on question profile ─────────────────
    const solvePrompt = validation.profile === 'coding'
      ? buildCodingPrompt(extractedText)
      : buildSolvePrompt(extractedText);

    // Pass 1: Send parsed question to AI.
    const pass1Raw = await callAI(provider, solvePrompt);
    const pass1Result = parseAIResponse(pass1Raw);

    // Pass 2: Send same question in a separate isolated request.
    const pass2Raw = await callAI(provider, solvePrompt);
    const pass2Result = parseAIResponse(pass2Raw);

    if (pass1Result.option === 'UNCLEAR' && pass2Result.option === 'UNCLEAR') {
      return NextResponse.json({ error: 'Could not detect a clear MCQ answer' }, { status: 422 });
    }

    let finalAnswer = pass1Result.option !== 'UNCLEAR' ? pass1Result.option : pass2Result.option;
    let summary = pass1Result.explanation;

    // Compare Pass 1 and Pass 2
    if (pass1Result.option === pass2Result.option && pass1Result.option !== 'UNCLEAR') {
      // Pass 3 (Audit): If they match, send final prompt asking to verify against facts
      const verifyPrompt = buildVerifyPrompt(extractedText, finalAnswer);
      const pass3Raw = await callAI(provider, verifyPrompt);
      const pass3Result = parseAIResponse(pass3Raw);
      
      finalAnswer = pass3Result.option !== 'UNCLEAR' ? pass3Result.option : finalAnswer;
      summary = pass3Result.explanation || summary;
    }

    // Standardized JSON response
    return NextResponse.json({
      finalAnswer: `Option ${finalAnswer}`,
      summary: summary
    });

  } catch (error: any) {
    // Enhanced Error Logging
    if (error?.status === 429) {
      console.error('[API Rate Limits] Groq API rate limit exceeded after all retries:', error);
    } else if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET' || error?.type === 'timeout' || error?.message?.toLowerCase().includes('timeout')) {
      console.error('[Connection Timeouts] Failed to connect to AI provider:', error);
    } else {
      console.error('[API Error] The AI service encountered an unexpected error:', error);
    }

    // User-friendly error avoiding crash
    return NextResponse.json(
      { error: 'The AI service encountered an error or rate limit. Please try again in a moment.' },
      { status: 500 }
    );
  }
}
