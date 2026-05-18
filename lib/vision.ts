/**
 * Google Cloud Vision API — Text Detection
 * Sends a base64-encoded image and returns extracted text.
 */
export async function extractTextFromImage(base64Image: string): Promise<string> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY
  if (!apiKey) throw new Error('GOOGLE_VISION_API_KEY is not configured')

  // Strip data URI prefix if present
  const imageData = base64Image.replace(/^data:image\/\w+;base64,/, '')

  const requestBody = {
    requests: [
      {
        image: { content: imageData },
        features: [
          { type: 'TEXT_DETECTION', maxResults: 1 },
          { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 },
        ],
      },
    ],
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    )

    if (!response.ok) {
      const err = await response.json()
      throw new Error(`Vision API error: ${err.error?.message || response.statusText}`)
    }

    const data = await response.json()
    const annotation = data.responses?.[0]

    // Prefer full-page text, fall back to first text annotation
    const fullText = annotation?.fullTextAnnotation?.text
    const simpleText = annotation?.textAnnotations?.[0]?.description

    const extracted = fullText || simpleText || ''

    if (!extracted.trim()) {
      throw new Error('NO_TEXT_DETECTED')
    }

    return extracted.trim()
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('VISION_TIMEOUT')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}
