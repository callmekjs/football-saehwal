import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  ANALYSIS_RUNS,
  compareDecisions,
  type MatchAnalysis,
} from '../analysis/compare'
import type { CoachFinding, OutcomeProfile } from '../analysis/coach'
import type {
  Decision,
  Level,
  MatchState,
  OpponentId,
  Problem,
} from '../sim/types'
import { buildOneMove } from './oneMove'
import {
  buildSurvivalStory,
  type StoryEvent,
} from './survivalStory'

const LEVEL_LABEL: Record<'line' | 'press' | 'width', Record<Level, string>> = {
  line: { 0: '낮음', 1: '보통', 2: '높음' },
  press: { 0: '약', 1: '중', 2: '강' },
  width: { 0: '좁게', 1: '보통', 2: '넓게' },
}

function percent(rate: number) {
  return `${(rate * 100).toFixed(1)}%`
}

function average(value: number) {
  return value.toFixed(value >= 10 ? 1 : 2)
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
      <ul>
        {finding.evidence.map((evidence, index) => (
          <li key={`${finding.id}-${index}`}>{evidence}</li>
        ))}
      </ul>
    </article>
  )
}

function eventIcon(event: StoryEvent) {
  if (event.kind === 'GOAL') return '+'
  if (event.kind === 'CONCEDE') return '−'
  if (event.kind === 'PENALTY') return 'P'
  if (event.kind === 'SEND_OFF') return 'R'
  return '!'
}

function MetricBars({
  label,
  noop,
  user,
  lowerIsBetter,
}: {
  label: string
  noop: number
  user: number
  lowerIsBetter: boolean
}) {
  const max = Math.max(noop, user, 0.01)
  const improved = lowerIsBetter ? user < noop : user > noop
  const worsened = lowerIsBetter ? user > noop : user < noop
  const tone = improved ? 'positive' : worsened ? 'negative' : 'neutral'

  return (
    <article className="flow-metric" data-tone={tone}>
      <div className="flow-metric-head">
        <strong>{label}</strong>
        <span>{improved ? '개선' : worsened ? '악화' : '비슷'}</span>
      </div>
      <div className="flow-pair">
        <span>방치</span>
        <i>
          <b style={{ width: `${(noop / max) * 100}%` }} />
        </i>
        <em>{average(noop)}</em>
      </div>
      <div className="flow-pair user">
        <span>내 판단</span>
        <i>
          <b style={{ width: `${(user / max) * 100}%` }} />
        </i>
        <em>{average(user)}</em>
      </div>
    </article>
  )
}

function profileMetrics(problem: Problem, noop: OutcomeProfile, user: OutcomeProfile) {
  if (problem.objective.type === 'EQUALIZE') {
    return [
      { label: '공격 진입', noop: noop.homeAttempt, user: user.homeAttempt, lower: false },
      { label: '슈팅', noop: noop.homeShot, user: user.homeShot, lower: false },
      { label: '득점', noop: noop.goalsFor, user: user.goalsFor, lower: false },
    ]
  }
  return [
    { label: '상대 공격', noop: noop.awayAttempt, user: user.awayAttempt, lower: true },
    { label: '상대 슈팅', noop: noop.awayShot, user: user.awayShot, lower: true },
    { label: '실점', noop: noop.goalsAgainst, user: user.goalsAgainst, lower: true },
  ]
}

export function AnalysisPanel({
  problem,
  initialState,
  finalState,
  passed,
  decisions,
  kickoff,
  kickoffHalf,
  firstHalf = null,
  firstHalfState = null,
  opponent = 'USA',
  onReplay,
  onRetry,
}: {
  problem: Problem
  initialState: MatchState
  finalState: MatchState
  passed: boolean
  decisions: Decision[]
  kickoff: number
  kickoffHalf: 1 | 2
  /** 전반에 내린 결정. 전반부터 뛴 경기에서만 있다 */
  firstHalf?: Decision[] | null
  firstHalfState?: MatchState | null
  opponent?: OpponentId
  onReplay?: () => void
  onRetry?: () => void
}) {
  const snapshot = useMemo(() => decisions.map((decision) => ({ ...decision })), [decisions])
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const story = useMemo(
    () =>
      buildSurvivalStory({
        problem,
        initialState,
        finalState,
        decisions: snapshot,
        kickoffHalf,
        firstHalf:
          firstHalf && firstHalfState
            ? { state: firstHalfState, decisions: firstHalf }
            : null,
        passed,
      }),
    [
      decisions,
      finalState,
      firstHalf,
      firstHalfState,
      initialState,
      kickoffHalf,
      passed,
      problem,
      snapshot,
    ],
  )
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

  const firstBeat = story.response.beats[0] ?? null
  const noop = analysis?.rows.find((row) => row.key === 'noop')
  const user = analysis?.rows.find((row) => row.key === 'user')
  const metrics =
    noop && user ? profileMetrics(problem, noop.profile, user.profile) : []

  return (
    <section className="analysis" data-outcome={passed ? 'passed' : 'failed'}>
      <section className="survival-hero">
        <header className="survival-hero-head">
          <div>
            <span className="survival-kicker">MISSION DEBRIEF · 실제 경기 기록</span>
            <h2>{story.outcome.title}</h2>
            <p>{problem.title}</p>
          </div>
          <div className="survival-score" aria-label={`최종 점수 ${finalState.score[0]} 대 ${finalState.score[1]}`}>
            <small>FINAL</small>
            <strong>{finalState.score[0]}</strong>
            <i>:</i>
            <strong>{finalState.score[1]}</strong>
          </div>
        </header>

        <ol className="story-route" aria-label="상황 타파 복기">
          <li className="story-stage crisis">
            <span className="story-index">01</span>
            <small>처음 위기</small>
            <strong className="story-stage-score">
              {story.crisis.startScore[0]} : {story.crisis.startScore[1]}
            </strong>
            <p>{story.crisis.summary}</p>
            <div className="crisis-signals" aria-label="실제 시작 조건">
              <span>선수 {story.crisis.homeCount}:{story.crisis.awayCount}</span>
              <span>경고 {story.crisis.bookedCount}</span>
              <span>체력 {Math.round(story.crisis.meanStamina)}</span>
              <span>대형 {story.crisis.inheritedSetup}</span>
              {story.crisis.inheritedOrders > 0 && (
                <span>물려받은 지시 {story.crisis.inheritedOrders}</span>
              )}
            </div>
          </li>

          <li className="story-stage response">
            <span className="story-index">02</span>
            <small>내 판단</small>
            {firstBeat ? (
              <>
                <time>{firstBeat.time}</time>
                <div className="decision-chips">
                  {firstBeat.items.slice(0, 4).map((item, index) => (
                    <span key={`${item}-${index}`}>{item}</span>
                  ))}
                </div>
                {story.response.beats.length > 1 && (
                  <b>이후 판단 {story.response.beats.length - 1}묶음</b>
                )}
              </>
            ) : (
              <strong className="no-response">개입 없음</strong>
            )}
          </li>

          <li className="story-stage flow">
            <span className="story-index">03</span>
            <small>실제 경기 흐름</small>
            {story.flow.integrity === 'UNAVAILABLE' ? (
              <strong className="no-response">기록 확인 불가</strong>
            ) : story.flow.events.length === 0 ? (
              <strong className="no-response">점수 변화 없음</strong>
            ) : (
              <div className="event-line">
                {story.flow.events.slice(-4).map((event) => (
                  <span
                    key={event.key}
                    className="event-node"
                    data-kind={event.kind}
                    data-shift={event.objectiveShift?.toLowerCase()}
                  >
                    <i>{eventIcon(event)}</i>
                    <time>{event.time}</time>
                    <b>{event.score ? `${event.score[0]}:${event.score[1]}` : event.label}</b>
                    {event.objectiveShift && (
                      <em>{event.objectiveShift === 'ENTERED' ? '목표선 진입' : '목표선 이탈'}</em>
                    )}
                  </span>
                ))}
              </div>
            )}
          </li>

          <li className="story-stage outcome">
            <span className="story-index">04</span>
            <small>목표 결과</small>
            <strong>{passed ? '타파 성공' : '타파 실패'}</strong>
            <p>{story.crisis.objective}</p>
            <span className="outcome-mark">{passed ? '✓' : '×'}</span>
          </li>
        </ol>

        <div className="survival-actions">
          <button className="replay-primary" onClick={onReplay}>
            같은 위기 다시
            <small>조건은 그대로 · 판단만 바꿉니다</small>
          </button>
          <button className="replay-secondary" onClick={onRetry}>
            새로운 조건
            <small>같은 국면 · 다른 시작 상태</small>
          </button>
        </div>
      </section>

      <div className="analysis-body" aria-live="polite">
        {!analysis && !error && (
          <section className="analysis-loading-card">
            <span className="analysis-loader" aria-hidden="true" />
            <strong>내 판단을 150판으로 다시 검증 중…</strong>
          </section>
        )}
        {error && <span className="analysis-error">{error}</span>}
        {analysis && oneMove && noop && user && (
          <>
            <section className="decision-proof">
              <header>
                <div>
                  <span>같은 조건 {ANALYSIS_RUNS}판 · 전체 판단 묶음</span>
                  <h3>이 판단은 정말 통했나?</h3>
                </div>
                <strong data-tone={oneMove.tone}>
                  {oneMove.deltaText}
                  <small>방치 대비</small>
                </strong>
              </header>
              <div className="probability-rings">
                {analysis.rows.map((item) => (
                  <article key={item.key} data-row={item.key}>
                    <div
                      className="probability-ring"
                      style={{ '--rate': `${item.rate * 360}deg` } as CSSProperties}
                      role="progressbar"
                      aria-label={`${item.label} 성공 가능성`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(item.rate * 100)}
                    >
                      <strong>{percent(item.rate)}</strong>
                    </div>
                    <span>{item.label}</span>
                  </article>
                ))}
              </div>
              <p>{verdict(analysis.userDelta)}</p>
            </section>

            <section className="flow-proof">
              <header>
                <span>한 경기 장면이 아닌 150판 평균</span>
                <h3>{problem.objective.type === 'EQUALIZE' ? '공격은 살아났나?' : '위험은 줄었나?'}</h3>
              </header>
              <div className="flow-metrics">
                {metrics.map((metric) => (
                  <MetricBars
                    key={metric.label}
                    label={metric.label}
                    noop={metric.noop}
                    user={metric.user}
                    lowerIsBetter={metric.lower}
                  />
                ))}
              </div>
            </section>

            <section className="next-solution">
              <header>
                <span>05 · 같은 위기의 해법</span>
                <h3>다시 한다면 이렇게 시작</h3>
              </header>
              <div className="solution-board" aria-label="권장 설정">
                <span>
                  <small>대형</small>
                  <b>{analysis.recommendation.formation}</b>
                </span>
                <i>→</i>
                <span>
                  <small>라인</small>
                  <b>{LEVEL_LABEL.line[analysis.recommendation.tactics.line]}</b>
                </span>
                <i>→</i>
                <span>
                  <small>압박</small>
                  <b>{LEVEL_LABEL.press[analysis.recommendation.tactics.press]}</b>
                </span>
                <i>→</i>
                <span>
                  <small>폭</small>
                  <b>{LEVEL_LABEL.width[analysis.recommendation.tactics.width]}</b>
                </span>
              </div>
            </section>

            <details className="coach-details analysis-evidence">
              <summary>왜 이런 결과가 나왔는지 자세히 보기</summary>
              <div className="evidence-body">
                <section className="coach-overview">
                  <span>감독 보고서 · 경기 기록으로 분석</span>
                  <h3>{analysis.coach.headline}</h3>
                  <ul>
                    {analysis.coach.summary.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>

                <div className="coach-section">
                  <h3>경기의 전환점</h3>
                  <FindingCard finding={analysis.coach.turningPoint} />
                </div>

                <div className="coach-findings">
                  {analysis.coach.goalsFor.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} />
                  ))}
                  {analysis.coach.goalsAgainst.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} />
                  ))}
                  {analysis.coach.decisionReview.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} />
                  ))}
                </div>

                <section className="coach-prescriptions">
                  <h3>다음 경기에서 바꿀 것</h3>
                  <ol>
                    {analysis.coach.prescriptions.map((prescription) => (
                      <li key={prescription}>{prescription}</li>
                    ))}
                  </ol>
                </section>
                <p className="evidence-note">{oneMove.note}</p>
              </div>
            </details>
          </>
        )}
      </div>
    </section>
  )
}
