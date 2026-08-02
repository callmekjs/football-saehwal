import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ANALYSIS_RUNS,
  compareDecisions,
  type MatchAnalysis,
} from '../analysis/compare'
import type { CoachFinding, OutcomeProfile } from '../analysis/coach'
import { toRecordCompare, type RecordCompare } from '../analysis/history'
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
  onDelta,
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
  /**
   * 150판 비교가 끝나면 한 번 알린다.
   *
   * 차이(`delta`)만 넘기면 기록에 "+8.2%p" 한 줄밖에 안 남아서, 나중에
   * `04 · 분석·기록` 이 "그래서 무엇을 어떻게 바꾸라는 것인가"를 그릴 수
   * 없다. 세 갈래 평균까지 함께 넘긴다.
   */
  onDelta?: (delta: number, compare: RecordCompare | null) => void
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

  /**
   * 이 분석이 **어느 판의 것인가**를 값 하나로 적는다.
   *
   * 전에는 `problem` 객체를 그대로 의존성에 넣었다. 부르는 쪽이 그 객체를
   * 매 렌더 새로 만들면(실제로 `App.tsx` 가 그랬다) 참조가 매번 달라져
   * 효과가 다시 돌았고, 그 효과가 150판을 다시 돌린 뒤 `onDelta` 로 기록을
   * 저장해 부모를 다시 그리게 만들어 **끝이 없었다.**
   *
   * 참조가 아니라 값으로 물으면 그 고리가 성립하지 않는다. 같은 판이면
   * 부모가 몇 번을 다시 그리든 이 문자열은 같다.
   */
  const matchKey = useMemo(
    () =>
      [
        problem.id,
        problem.seed,
        opponent,
        kickoff,
        kickoffHalf,
        snapshot.length,
        firstHalf?.length ?? -1,
      ].join('#'),
    [firstHalf, kickoff, kickoffHalf, opponent, problem.id, problem.seed, snapshot],
  )

  /**
   * 효과 안에서 읽을 지금 값.
   *
   * 의존성을 `matchKey` 하나로 줄이는 대신, 실제로 쓰는 값은 여기서 꺼낸다.
   * 그래야 낡은 렌더의 값을 붙잡는 일이 없다.
   */
  const latest = useRef({
    problem,
    snapshot,
    kickoff,
    firstHalf,
    opponent,
    initialState,
    finalState,
    firstHalfState,
    onDelta,
  })
  latest.current = {
    problem,
    snapshot,
    kickoff,
    firstHalf,
    opponent,
    initialState,
    finalState,
    firstHalfState,
    onDelta,
  }

  /** 분석을 **끝낸** 판. 같은 판이면 두 번 돌지 않는다 */
  const analyzed = useRef<string | null>(null)
  /** 기록에 결과를 넘긴 판. `onDelta` 는 한 판에 한 번이다 */
  const delivered = useRef<string | null>(null)

  useEffect(() => {
    if (analyzed.current === matchKey) return
    analyzed.current = matchKey

    let cancelled = false
    let finished = false
    setAnalysis(null)
    setError(null)

    const timer = window.setTimeout(() => {
      const now = latest.current
      try {
        const next = compareDecisions(
          now.problem,
          now.snapshot,
          ANALYSIS_RUNS,
          now.kickoff,
          now.firstHalf,
          now.opponent,
          {
            initial: now.initialState,
            final: now.finalState,
            firstHalf: now.firstHalfState,
          },
        )
        if (cancelled) return
        finished = true
        setAnalysis(next)
        // 150판 비교가 끝났다. 기록에 방치 대비 차이와 세 갈래 평균을 채워 넣게 알린다
        if (delivered.current !== matchKey) {
          delivered.current = matchKey
          now.onDelta?.(next.userDelta, toRecordCompare(next.rows))
        }
      } catch (reason) {
        if (cancelled) return
        finished = true
        setError(reason instanceof Error ? reason.message : '분석할 수 없습니다')
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      /**
       * 끝나기 전에 떼어졌으면 **다시 붙을 때 한 번 더 돌아야 한다.**
       *
       * 실제 앱은 `StrictMode` 안에서 돈다. 붙자마자 한 번 떼었다 다시
       * 붙이므로, 「붙는 순간」으로 막으면 두 번째에 걸려 분석이 아예 안
       * 돌고 화면이 영원히 「검증 중…」에 머문다.
       */
      if (!finished) analyzed.current = null
    }
    // 값은 `latest` 에서 꺼낸다. 다시 돌 이유는 판이 바뀌는 것 하나뿐이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey])

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
            <span className="survival-kicker">경기 끝 · 한눈에 보기</span>
            <h2>{story.outcome.title}</h2>
            <p>{problem.title}</p>
          </div>
          <div className="survival-score" aria-label={`최종 점수 ${finalState.score[0]} 대 ${finalState.score[1]}`}>
            <small>최종</small>
            <strong>{finalState.score[0]}</strong>
            <i>:</i>
            <strong>{finalState.score[1]}</strong>
          </div>
        </header>

        <ol className="story-route story-core" aria-label="결과와 핵심 판단">
          <li className="story-stage outcome">
            <span className="story-index">01</span>
            <small>이번 목표</small>
            <strong>{passed ? '목표 달성' : '목표 실패'}</strong>
            <p>{story.crisis.objective}</p>
            <span className="outcome-mark">{passed ? '✓' : '×'}</span>
          </li>
          <li className="story-stage response">
            <span className="story-index">02</span>
            <small>내가 바꾼 것</small>
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
              <strong className="no-response">바꾼 것 없음</strong>
            )}
          </li>
        </ol>

        <details className="result-context analysis-evidence">
          <summary>처음 위기와 실제 경기 흐름 자세히 보기</summary>
          <ol className="story-route story-context" aria-label="처음 위기와 실제 경기 흐름">
            <li className="story-stage crisis">
              <span className="story-index">03</span>
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
            <li className="story-stage flow">
              <span className="story-index">04</span>
              <small>실제 경기 흐름</small>
              {story.flow.integrity === 'UNAVAILABLE' ? (
                <strong className="no-response">남은 기록 없음</strong>
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
          </ol>
        </details>

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
            <section className="decision-summary">
              <header>
                <span>내 선택 평가</span>
                <h3>내 선택이 도움이 됐나요?</h3>
              </header>
              <strong data-tone={oneMove.tone}>
                {oneMove.deltaText}
                <small>아무것도 안 했을 때와 비교</small>
              </strong>
              <p>{verdict(analysis.userDelta)}</p>
            </section>

            <section className="next-solution">
              <header>
                <span>다음 경기 추천</span>
                <h3>같은 상황에서는 이렇게 시작하세요</h3>
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

            <details className="comparison-details analysis-evidence">
              <summary>150판 성공률과 세부 평균 자세히 보기</summary>
              <div className="comparison-details-body">
                <section className="decision-proof">
                  <header>
                    <div>
                      <span>같은 조건으로 {ANALYSIS_RUNS}판 비교 · 경기 전체 판단</span>
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
                    <span>한 경기 결과와 나눠 본 150판 평균</span>
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
              </div>
            </details>

            <details className="coach-details analysis-evidence">
              <summary>왜 이런 결과가 나왔는지 자세히 보기</summary>
              <div className="evidence-body">
                <dl className="coach-simple-summary">
                  <div>
                    <dt>무슨 일이 있었나요?</dt>
                    <dd>{analysis.coach.headline}</dd>
                  </div>
                  <div>
                    <dt>쉽게 말하면</dt>
                    <dd>{analysis.coach.summary[0]}</dd>
                  </div>
                  <div>
                    <dt>다음에는 뭘 해야 하나요?</dt>
                    <dd>{analysis.coach.prescriptions[0]}</dd>
                  </div>
                </dl>

                <details className="coach-technical-details">
                  <summary>숫자와 장면 기록 더 보기</summary>
                  <div className="coach-technical-body">
                    <section className="coach-overview">
                      <span>감독 보고서 · 실제 경기 기록 분석</span>
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
              </div>
            </details>
          </>
        )}
      </div>
    </section>
  )
}
