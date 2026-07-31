/**
 * 04 · 분석과 기록.
 *
 * 사용자가 정했다 — *"04 분석 및 히스토리"*, 그리고 기록은 **브라우저에
 * 저장**한다.
 *
 * 여기서는 지어내지 않는다. `matchHistory` 에 실제로 남은 판만 보여주고,
 * 기록이 없으면 없다고 말한다. 한 경기 결과와 150판 판단 평가는 종료
 * 화면(`AnalysisPanel`)이 이미 자세히 하므로 여기서는 **쌓인 흐름**만 본다.
 *
 * ## 빈 화면
 *
 * 1600×1000 실측으로 내용이 192px뿐이라 **748px이 통째로 비어 있었다.**
 * 기록이 없는 것은 정상 상태이고 처음 열면 언제나 이 화면이다. 그래서
 * 빈 화면을 사과문이 아니라 **무엇이 쌓이는지 미리 읽는 자리**로 만든다.
 *
 * 가짜 예시 줄을 그려 넣지 않는다. 없는 값을 화면에 세우지 않는 것이 이
 * 저장소의 규칙이고, 예시 한 줄은 실제 기록으로 오해된다. 대신 **앞으로
 * 남을 칸의 이름과 뜻**만 적는다.
 */
import { historySummary, timeAgo, type MatchRecord } from './matchHistory'

function deltaText(delta: number | null): string {
  if (delta === null) return '—'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${(delta * 100).toFixed(1)}%p`
}

/** 앞으로 한 줄에 남을 칸들. 빈 화면이 이것을 미리 읽어준다 */
const COLUMNS: ReadonlyArray<{ name: string; what: string }> = [
  { name: '국면 · 상대', what: '어떤 위기를 누구를 상대로 풀었는지' },
  { name: '스코어', what: '그 판이 끝났을 때의 점수' },
  { name: '타파 · 실패', what: '승패가 아니라 그 국면의 목표를 이뤘는지' },
  { name: '판단 n회', what: '그 경기에서 내린 결정 수' },
  { name: '±%p', what: '아무 개입도 없었을 때와의 성공 가능성 차이' },
]

/** 도전 현황 한 줄이 필요로 하는 국면 정보 */
export interface HistoryProblem {
  id: string
  title: string
  /** 기준팀 무개입 통과율. 0~1 */
  noActionRate: number
  goal: '리드 지키기' | '동점 이상'
}

/** 같은 국면을 여러 번 하면 그 국면의 성적이 쌓인다 */
function byProblem(records: readonly MatchRecord[]) {
  const map = new Map<string, { played: number; passed: number }>()
  for (const record of records) {
    const row = map.get(record.problemId) ?? { played: 0, passed: 0 }
    row.played += 1
    if (record.passed) row.passed += 1
    map.set(record.problemId, row)
  }
  return map
}

export function HistorySection({
  records,
  problems = [],
  now,
  onClear,
  onGoSituation,
}: {
  records: readonly MatchRecord[]
  /** 다섯 국면. 아직 한 번도 안 해본 것까지 함께 보여준다 */
  problems?: readonly HistoryProblem[]
  now?: number
  onClear?: () => void
  /** 빈 화면에서 바로 국면을 고르러 간다 */
  onGoSituation?: () => void
}) {
  const { played, passed, rate } = historySummary(records)
  // 시각은 화면에서만 쓰는 값이라 엔진과 무관하다
  const at = now ?? Date.now()
  const perProblem = byProblem(records)

  return (
    <section id="history" className="history-section" aria-labelledby="history-title">
      <div className="kickoff-section-head">
        <div className="kickoff-section-label">
          <i aria-hidden>04</i>
          <div>
            <small>분석 · 기록</small>
            <h2 id="history-title">지난 판</h2>
          </div>
        </div>
        <p>같은 국면을 여러 번 해볼수록 판단이 결과를 어떻게 바꾸는지 드러납니다.</p>
      </div>

      <dl className="history-summary">
        <div>
          <dt>치른 판</dt>
          <dd>{played}</dd>
        </div>
        <div>
          <dt>타파 성공</dt>
          <dd data-tone={passed > 0 ? 'safe' : undefined}>{passed}</dd>
        </div>
        <div>
          <dt>성공률</dt>
          <dd>{played === 0 ? '—' : `${(rate * 100).toFixed(0)}%`}</dd>
        </div>
        <div>
          <dt>타파한 국면</dt>
          <dd>
            {problems.filter((p) => (perProblem.get(p.id)?.passed ?? 0) > 0).length}/
            {problems.length}
          </dd>
        </div>
      </dl>

      {/*
        기록이 없어도 **여기는 비지 않는다.** 다섯 국면은 언제나 있고,
        아직 안 해본 것도 도전 목록의 일부다. 기록이 쌓이면 같은 자리에
        내 성적이 채워진다.
      */}
      {problems.length > 0 && (
        <div className="history-board">
          <h3>
            국면별 도전 현황
            <small>회색 막대는 미국 기준 무개입 통과율입니다</small>
          </h3>
          <ul>
            {problems.map((problem) => {
              const mine = perProblem.get(problem.id)
              const myRate = mine && mine.played > 0 ? mine.passed / mine.played : null
              return (
                <li key={problem.id} data-tried={mine ? 'on' : undefined}>
                  <span className="history-board-name">
                    <b>{problem.title}</b>
                    <small>{problem.goal}</small>
                  </span>
                  <span className="history-board-bars">
                    <i aria-hidden data-kind="base">
                      <u style={{ width: `${problem.noActionRate * 100}%` }} />
                    </i>
                    <i aria-hidden data-kind="mine">
                      <u style={{ width: `${(myRate ?? 0) * 100}%` }} />
                    </i>
                  </span>
                  <span className="history-board-num">
                    <small>무개입 {(problem.noActionRate * 100).toFixed(1)}%</small>
                    <b data-none={myRate === null ? 'on' : undefined}>
                      {myRate === null ? '미도전' : `내 성적 ${mine!.passed}/${mine!.played}`}
                    </b>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {played === 0 ? (
        <div className="history-blank">
          <div className="history-empty">
            <strong>아직 기록이 없습니다</strong>
            <p>
              한 판을 끝내면 여기에 결과와 그때의 판단이 남습니다. 기록은 이
              브라우저에만 저장되며 어디로도 보내지 않습니다.
            </p>
            {onGoSituation && (
              <button type="button" className="history-go" onClick={onGoSituation}>
                국면 고르러 가기
              </button>
            )}
          </div>

          <div className="history-schema">
            <h3>한 줄에 남는 것</h3>
            <dl>
              {COLUMNS.map((column) => (
                <div key={column.name}>
                  <dt>{column.name}</dt>
                  <dd>{column.what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : (
        <>
          <ul className="history-list">
            {records.map((record) => (
              <li key={`${record.at}-${record.problemId}`} data-passed={record.passed ? 'on' : 'off'}>
                <span className="history-when">{timeAgo(record.at, at)}</span>
                <span className="history-what">
                  <b>{record.problemTitle}</b>
                  <small>
                    {record.opponentName} · {record.half === 1 ? '전반' : '후반'}
                  </small>
                </span>
                <span className="history-score">
                  {record.score[0]}
                  <i>:</i>
                  {record.score[1]}
                </span>
                <span className="history-result" data-passed={record.passed ? 'on' : 'off'}>
                  {record.passed ? '타파' : '실패'}
                </span>
                <span className="history-decisions">판단 {record.decisions}회</span>
                <span className="history-delta" data-sign={(record.delta ?? 0) >= 0 ? 'up' : 'down'}>
                  {deltaText(record.delta)}
                </span>
              </li>
            ))}
          </ul>

          {onClear && (
            <button type="button" className="chip history-clear" onClick={onClear}>
              기록 지우기
            </button>
          )}
        </>
      )}

      <p className="history-note">
        <b>판단 n회</b>는 그 경기에서 내린 결정 수이고, <b>±%p</b>는 같은
        150판에서 아무 개입도 하지 않았을 때와의 성공 가능성 차이입니다. 한 수
        하나의 효과가 아니라 그 경기 판단 전체의 값입니다.
      </p>
    </section>
  )
}
