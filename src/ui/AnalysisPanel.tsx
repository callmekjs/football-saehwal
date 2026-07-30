import { useEffect, useMemo, useState } from 'react'
import {
  ANALYSIS_RUNS,
  compareDecisions,
  type MatchAnalysis,
} from '../analysis/compare'
import type { CoachFinding } from '../analysis/coach'
import type { Decision, OpponentId, Level, Problem } from '../sim/types'
import { buildOneMove } from './oneMove'

const LEVEL_LABEL: Record<'line' | 'press' | 'width', Record<Level, string>> = {
  line: { 0: '낮음', 1: '보통', 2: '높음' },
  press: { 0: '약', 1: '중', 2: '강' },
  width: { 0: '좁게', 1: '보통', 2: '넓게' },
}

function percent(rate: number) {
  return `${(rate * 100).toFixed(1)}%`
}

export function verdict(delta: number) {
  if (delta >= 0.04) return '내린 판단 덕분에 성공 가능성이 분명히 커졌습니다.'
  if (delta <= -0.04) return '이번에는 그대로 뒀을 때보다 위험이 더 커졌습니다.'
  return '그대로 뒀을 때와 성공 가능성이 비슷했습니다.'
}

function FindingCard({ finding }: { finding: CoachFinding }) {
  return (
    <article className="coach-finding">
      <div className="coach-finding-meta">
        <span>{finding.label}</span>
        {finding.time && <time>{finding.time}</time>}
        <b data-confidence={finding.confidence}>확신도 {finding.confidence}</b>
      </div>
      <strong>{finding.title}</strong>
      <p>{finding.explanation}</p>
      {/*
        키는 내용이 아니라 순서로 잡는다. 반별 결정 내역은 "전반 · 25:00
        7번 올라가라" 같은 줄이 여럿이라 같은 문장이 두 번 나올 수 있다.
      */}
      <ul>
        {finding.evidence.map((evidence, index) => (
          <li key={`${finding.id}-${index}`}>{evidence}</li>
        ))}
      </ul>
    </article>
  )
}

export function AnalysisPanel({
  problem,
  decisions,
  kickoff,
  firstHalf = null,
  opponent = 'USA',
}: {
  problem: Problem
  decisions: Decision[]
  kickoff: number
  /** 전반에 내린 결정. 전반부터 뛴 경기에서만 있다 */
  firstHalf?: Decision[] | null
  /**
   * 사용자가 실제로 만난 상대.
   *
   * 150판 비교의 세 채널이 **모두** 이 난이도로 돌아야 한다. 어려움으로
   * 뛰어놓고 무개입 기준선만 보통에서 재면, 상대가 세서 생긴 차이가
   * 감독의 판단 탓으로 찍힌다.
   */
  opponent?: OpponentId
}) {
  const snapshot = useMemo(() => decisions.map((decision) => ({ ...decision })), [decisions])
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const oneMove = analysis
    ? buildOneMove(analysis.coach.decisionReview, analysis.userDelta, {
        decisions: snapshot,
        kickoff,
        firstHalf,
      })
    : null

  useEffect(() => {
    let cancelled = false
    setAnalysis(null)
    setError(null)

    // 종료 결과를 먼저 그린 뒤 계산한다. 폰에서도 버튼이 멈춘 것처럼 보이지 않는다.
    const timer = window.setTimeout(() => {
      try {
        const next = compareDecisions(
          problem,
          snapshot,
          ANALYSIS_RUNS,
          kickoff,
          firstHalf,
          opponent,
        )
        if (!cancelled) setAnalysis(next)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '분석할 수 없습니다')
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [opponent, firstHalf, kickoff, problem, snapshot])

  return (
    <section className="panel analysis">
      <h2>감독 경기 분석 · 같은 조건 {ANALYSIS_RUNS}경기 비교</h2>
      <div className="analysis-body" aria-live="polite">
        {!analysis && !error && (
          <span className="analysis-loading">성공 가능성을 계산하고 있습니다…</span>
        )}
        {error && <span className="analysis-error">{error}</span>}
        {analysis && oneMove && (
          <>
            <section className="coach-overview">
              <span>감독 보고서 · 경기 기록으로 분석</span>
              <h3>{analysis.coach.headline}</h3>
              <ul>
                {analysis.coach.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>

            <section className="one-move" aria-label="이 경기의 한 수">
              <div className="one-move-head">
                <span className="one-move-kicker">종료 분석 핵심</span>
                <h3>이 경기의 한 수</h3>
                <span className="one-move-status" data-kind={oneMove.kind}>
                  {oneMove.label}
                </span>
              </div>
              <div className="one-move-main">
                <span className="one-move-time">
                  {oneMove.time ?? '결정 시각 없음'}
                </span>
                <strong className="one-move-decision">{oneMove.decision}</strong>
                <div className="one-move-impact">
                  <span>{oneMove.impactLabel}</span>
                  <strong className="one-move-delta" data-tone={oneMove.tone}>
                    {oneMove.deltaText}
                  </strong>
                </div>
              </div>
              <p className="one-move-note">{oneMove.note}</p>
            </section>

            <div className="analysis-headline">
              <strong className="analysis-verdict">{verdict(analysis.userDelta)}</strong>
              <span>그대로 뒀을 때와 비교 {oneMove.deltaText}</span>
            </div>
            <span className="analysis-caption">
              한 경기의 운을 덜어내려고 같은 조건의 {ANALYSIS_RUNS}경기에서 세 가지
              판단을 비교했습니다.
            </span>
            <div className="analysis-bars">
              {analysis.rows.map((item) => (
                <div className="analysis-row" key={item.key}>
                  <span>{item.label}</span>
                  <span className="analysis-track">
                    <i
                      className={`analysis-fill ${item.key}`}
                      style={{ width: `${item.rate * 100}%` }}
                      role="progressbar"
                      aria-label={`${item.label} 성공 가능성`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(item.rate * 100)}
                    />
                  </span>
                  <strong>{percent(item.rate)}</strong>
                </div>
              ))}
            </div>

            <div className="coach-section">
              <h3>경기의 전환점</h3>
              <FindingCard finding={analysis.coach.turningPoint} />
            </div>

            <details className="coach-details" open>
              <summary>득점과 실점은 왜 나왔나</summary>
              <div className="coach-findings">
                {analysis.coach.goalsFor.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} />
                ))}
                {analysis.coach.goalsAgainst.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} />
                ))}
              </div>
            </details>

            <details className="coach-details">
              <summary>내 결정은 무엇을 바꿨나</summary>
              <div className="coach-findings">
                {analysis.coach.decisionReview.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} />
                ))}
              </div>
            </details>

            <section className="coach-prescriptions">
              <h3>다음 경기에서 바꿀 것</h3>
              <ol>
                {analysis.coach.prescriptions.map((prescription) => (
                  <li key={prescription}>{prescription}</li>
                ))}
              </ol>
            </section>

            <div className="analysis-advice">
              <strong>{ANALYSIS_RUNS}경기로 확인한 권장 설정</strong>
              <div>
                <span>
                  <small>포메이션</small>
                  {analysis.recommendation.formation}
                </span>
                <span>
                  <small>라인</small>
                  {LEVEL_LABEL.line[analysis.recommendation.tactics.line]}
                </span>
                <span>
                  <small>압박</small>
                  {LEVEL_LABEL.press[analysis.recommendation.tactics.press]}
                </span>
                <span>
                  <small>폭</small>
                  {LEVEL_LABEL.width[analysis.recommendation.tactics.width]}
                </span>
              </div>
              <p>{analysis.recommendation.explanation}</p>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
