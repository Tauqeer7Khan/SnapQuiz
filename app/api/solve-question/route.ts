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

async function callGroq(prompt: string) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama3-8b-8192',
  });
  return completion.choices[0]?.message?.content || '';
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
    const { extractedText, provider } = await req.json();

    if (!extractedText || !provider) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const solvePrompt = buildSolvePrompt(extractedText);

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
    console.error('API Error:', error);
    // User-friendly error avoiding crash
    return NextResponse.json(
      { error: 'The AI service encountered an error or rate limit. Please try again in a moment.' },
      { status: 500 }
    );
  }
}
