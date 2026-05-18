'use client'

export interface Answer {
  id: string
  questionNumber: number
  option: string
  explanation: string
  verifiedOption?: string
  verifiedExplanation?: string
  isVerified?: boolean
}

interface AnswerListProps {
  answers: Answer[]
  sessionVerified: boolean
}

export default function AnswerList({ answers, sessionVerified }: AnswerListProps) {
  if (answers.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <p>
          Scan your first question to begin.
          <br />
          Point the camera at an MCQ and press Capture.
        </p>
      </div>
    )
  }

  return (
    <>
      {answers.map((answer) => {
        const displayOption = answer.isVerified && answer.verifiedOption
          ? answer.verifiedOption
          : answer.option
        const displayExplanation = answer.isVerified && answer.verifiedExplanation
          ? answer.verifiedExplanation
          : answer.explanation
        const changed =
          answer.isVerified &&
          answer.verifiedOption &&
          answer.verifiedOption !== answer.option

        return (
          <article
            key={answer.id}
            id={`answer-card-${answer.questionNumber}`}
            className={`answer-card ${answer.isVerified ? 'verified' : ''}`}
            role="listitem"
          >
            <div className="answer-card-header">
              <span className="answer-qnum">Q{answer.questionNumber}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {changed && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      color: 'var(--warning)',
                      background: 'var(--warning-dim)',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      border: '1px solid rgba(251,191,36,0.3)',
                    }}
                    title={`Original answer was ${answer.option}`}
                  >
                    Corrected
                  </span>
                )}
                <div
                  className={`answer-option-badge ${answer.isVerified ? 'verified-badge' : ''}`}
                  aria-label={`Answer: Option ${displayOption}`}
                >
                  {displayOption}
                </div>
              </div>
            </div>

            <p className="answer-explanation">{displayExplanation}</p>

            {answer.isVerified && (
              <div className="answer-verified-tag">
                <span aria-hidden="true">✓</span>
                <span>AI Verified</span>
              </div>
            )}
          </article>
        )
      })}
    </>
  )
}
