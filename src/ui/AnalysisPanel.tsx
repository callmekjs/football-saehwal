import { useEffect, useMemo, useState } from 'react'
import {
  ANALYSIS_RUNS,
  compareDecisions,
  type MatchAnalysis,
} from '../analysis/compare'
import type { Decision, Level, Problem } from '../sim/types'

const LEVEL_LABEL: Record<'line' | 'press' | 'width', Record<Level, string>> = {
  line: { 0: '낮음', 1: '보통', 2: '높음' },
  press: { 0: '약', 1: '중', 2: '강' },
  width: { 0: '좁게', 1: '보통', 2: '넓게' },
}

function percent(rate: number) {
  return `${(rate * 100).toFixed(1)}%`
}

function verdict(delta: number) {
  if (delta >= 0.04) return '당신의 판단이 성공 가능성을 분명히 높였습니다.'
  if (delta <= -0.04) return '이번 판단은 방치했을 때보다 위험을 키웠습니다.'
  return '이번 판단은 방치했을 때와 큰 차이가 없었습니다.'
}

function pointDelta(delta: number) {
  const points = delta * 100
  return `${points > 0 ? '+' : ''}${points.toFixed(1)}%p`
}

export function AnalysisPanel({
  problem,
  decisions,
}: {
  problem: Problem
  decisions: Decision[]
}) {
  const snapshot = useMemo(() => decisions.map((decision) => ({ ...decision })), [decisions])
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setAnalysis(null)
    setError(null)

    // 종료 결과를 먼저 그린 뒤 계산한다. 폰에서도 버튼이 멈춘 것처럼 보이지 않는다.
    const timer = window.setTimeout(() => {
      try {
        const next = compareDecisions(problem, snapshot)
        if (!cancelled) setAnalysis(next)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '분석할 수 없습니다')
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [problem, snapshot])

  return (
    <section className="panel analysis">
      <h2>판단 분석 · 같은 국면 {ANALYSIS_RUNS}번</h2>
      <div className="analysis-body" aria-live="polite">
        {!analysis && !error && (
          <span className="analysis-loading">성공 가능성을 계산하고 있습니다…</span>
        )}
        {error && <span className="analysis-error">{error}</span>}
        {analysis && (
          <>
            <div className="analysis-headline">
              <strong className="analysis-verdict">{verdict(analysis.userDelta)}</strong>
              <span>방치 대비 {pointDelta(analysis.userDelta)}</span>
            </div>
            <span className="analysis-caption">
              한 경기의 운을 빼기 위해 세 전술에 똑같은 150경기를 적용했습니다.
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
            <div className="analysis-advice">
              <strong>다음에는 이렇게 바꿔보세요</strong>
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
