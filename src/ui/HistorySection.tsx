/**
 * 04 · 분석과 기록.
 *
 * 사용자가 정했다 — *"04 분석 및 히스토리"*, 그리고 기록은 **브라우저에
 * 저장**한다. 그리고 다시 정했다 — *"경기 후 사람들이 이해할 수 있게
 * 그래프와 글을 통해서 어떻게 해야 더 좋은 전술을 짤 수 있는지 알려줘야
 * 해."*
 *
 * 그래서 이 화면의 목적은 성적표가 아니라 **다음 판에 쓸 것을 남기는
 * 것**이다. 위에서부터 이렇게 읽힌다.
 *
 * 1. **지난 판이 남긴 것** — 무개입·나·권장 세 갈래를 나란히 세운 막대.
 *    같은 150 시드를 셋에 똑같이 먹였으므로 달라진 것은 판단뿐이고,
 *    그래서 "얼마나 남아 있었는가"가 눈으로 보인다
 * 2. **내 전술 버릇** — 여러 판에 걸쳐 어느 레버를 계속 틀리는가
 * 3. **판단이 나아지고 있나** — `±%p` 의 흐름
 * 4. **국면별 도전 현황** — 아직 안 해본 판까지 포함한 지도
 * 5. **지난 판 목록**
 *
 * ## 종료 화면과 겹치지 않게
 *
 * 경기 직후 화면(`AnalysisPanel`)은 **이 한 판이 어땠나**를 말한다 — 세
 * 성공률 고리, 방치 대비 지표, 권장 설정. 이 화면은 **그래서 다음엔 어떻게
 * 짜나**를 말한다. 그래서 여기서만 권장 전술의 평균 실점·슈팅·세트피스까지
 * 펴 놓는다. 그 숫자는 지금까지 어디에도 보이지 않았고, 없으면 "권장안이
 * 더 좋다"가 근거 없는 주장이 된다.
 *
 * ## 지어내지 않는다
 *
 * 그래프는 전부 **기록에 실제로 남은 값**으로만 그린다. 옛 기록에는 설정과
 * 150판 비교 칸이 통째로 없다. 그런 줄은 계산에서 빠지고, 쓸 줄이 하나도
 * 없으면 그 절은 아예 나타나지 않는다. 자리를 채우려고 0을 그리면 있지도
 * 않은 경기를 그리는 것이 된다.
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
import { type CSSProperties, useState } from 'react'
import {
  deltaTrend,
  lastLesson,
  leverHabits,
  setupText,
  type Goal,
  type LeverHabit,
  type Lesson,
  type LessonRow,
  type Trend,
} from '../analysis/history'
import { historySummary, timeAgo, type MatchRecord } from './matchHistory'

function deltaText(delta: number | null): string {
  if (delta === null) return '—'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${(delta * 100).toFixed(1)}%p`
}

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`

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

/* ------------------------------------------------------------------ *
 * 그래프 조각 — 전부 CSS 도형이다. 이 저장소에는 이미지 파일이 없다
 * ------------------------------------------------------------------ */

/** 세 갈래를 같은 자에 놓은 가로 막대 하나 */
function TripleBar({
  values,
  format,
  scale,
}: {
  values: { noop: number; user: number; recommendation: number }
  format: (value: number) => string
  /** 막대 길이의 기준. 성공 가능성은 언제나 1이고, 나머지는 셋 중 최댓값이다 */
  scale: number
}) {
  const rows: ReadonlyArray<{ who: 'noop' | 'user' | 'rec'; name: string; value: number }> = [
    { who: 'noop', name: '무개입', value: values.noop },
    { who: 'user', name: '나의 판단', value: values.user },
    { who: 'rec', name: '권장 전술', value: values.recommendation },
  ]
  const safe = scale > 0 ? scale : 1

  return (
    <div className="triple-bar">
      {rows.map((row) => (
        <div className="triple-row" key={row.who} data-who={row.who}>
          <span className="triple-name">{row.name}</span>
          <span className="triple-track">
            <i style={{ width: `${Math.min(100, (row.value / safe) * 100)}%` }} />
          </span>
          <span className="triple-value">{format(row.value)}</span>
        </div>
      ))}
    </div>
  )
}

function LessonRowCard({ row }: { row: LessonRow }) {
  const scale = Math.max(row.noop, row.user, row.recommendation)
  return (
    <li className="lesson-row">
      <div className="lesson-row-head">
        <b>{row.label}</b>
        <small>{row.lowerIsBetter ? '낮을수록 좋음' : '높을수록 좋음'}</small>
      </div>
      <TripleBar
        values={{ noop: row.noop, user: row.user, recommendation: row.recommendation }}
        format={(value) => value.toFixed(row.digits)}
        scale={scale}
      />
      <p>{row.note}</p>
    </li>
  )
}

function LessonBoard({ lesson }: { lesson: Lesson }) {
  return (
    <section className="lesson-board" aria-labelledby="lesson-title">
      <header>
        <span>
          가장 최근 판 · {lesson.problemTitle} · {lesson.opponentName} 상대 · 같은 조건 150판
        </span>
        <h3 id="lesson-title">{lesson.headline}</h3>
      </header>

      <ul className="lesson-legend">
        <li data-who="noop">
          <i aria-hidden />
          <b>무개입</b>
          <small>앞 감독이 걸어둔 지시 그대로</small>
        </li>
        <li data-who="user">
          <i aria-hidden />
          <b>나의 판단</b>
          <small>{lesson.mine ? setupText(lesson.mine) : '종료 시점 설정 기록 없음'}</small>
        </li>
        <li data-who="rec">
          <i aria-hidden />
          <b>권장 전술</b>
          <small>
            {lesson.recommended ? setupText(lesson.recommended) : '이 국면에는 권장안이 없음'}
          </small>
        </li>
      </ul>

      {/*
        그래프와 그 그래프를 읽는 글을 **나란히** 둔다. 막대만 있고 해석이
        없으면 사용자가 스스로 결론을 만들어야 하고, 그러면 그래프는 장식이다.
      */}
      <div className="lesson-top">
        <div className="lesson-rate">
          <div className="lesson-row-head">
            <b>성공 가능성</b>
            <small>150판 중 국면 목표를 이룬 비율</small>
          </div>
          <TripleBar values={lesson.rates} format={percent} scale={1} />
        </div>

        <div className="lesson-text">
          {lesson.paragraphs.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
          ))}
        </div>
      </div>

      <ul className="lesson-rows">
        {lesson.rows.map((row) => (
          <LessonRowCard key={row.key} row={row} />
        ))}
      </ul>

      {lesson.gaps.length > 0 && (
        <div className="lesson-gaps">
          <h4>다음 판의 출발점</h4>
          <ul>
            {lesson.gaps.map((gap) => (
              <li key={gap.label}>
                <small>{gap.label}</small>
                <b>{gap.mine}</b>
                <i aria-hidden>→</i>
                <strong>{gap.recommended}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function HabitBoard({ habits }: { habits: LeverHabit[] }) {
  const total = habits[0]?.total ?? 0
  return (
    <section className="habit-board" aria-labelledby="habit-title">
      <header>
        <span>설정이 남은 {total}판을 모아서</span>
        <h3 id="habit-title">내 전술 버릇</h3>
      </header>
      <ul>
        {habits.map((habit) => {
          const segments =
            habit.key === 'formation'
              ? [
                  { seg: 'matched' as const, count: habit.matched },
                  { seg: 'other' as const, count: habit.higher },
                ]
              : [
                  { seg: 'lower' as const, count: habit.lower },
                  { seg: 'matched' as const, count: habit.matched },
                  { seg: 'higher' as const, count: habit.higher },
                ]
          const counts =
            habit.key === 'formation'
              ? `맞음 ${habit.matched} · 다름 ${habit.higher}`
              : `${habit.key === 'line' ? '낮게' : habit.key === 'press' ? '약하게' : '좁게'} ${
                  habit.lower
                } · 맞음 ${habit.matched} · ${
                  habit.key === 'line' ? '높게' : habit.key === 'press' ? '세게' : '넓게'
                } ${habit.higher}`

          return (
            <li key={habit.key} data-lean={habit.lean}>
              <div className="habit-head">
                <b>{habit.label}</b>
                <small>{counts}</small>
              </div>
              <div
                className="habit-bar"
                role="img"
                aria-label={`${habit.label} — ${counts}`}
              >
                {segments
                  .filter((segment) => segment.count > 0)
                  .map((segment) => (
                    <i
                      key={segment.seg}
                      data-seg={segment.seg}
                      style={{ flexGrow: segment.count }}
                    />
                  ))}
              </div>
              <p>{habit.note}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 0 을 가운데 두고 위아래로 뻗는 기둥. `±%p` 는 음수가 될 수 있다 */
function TrendBoard({ trend }: { trend: Trend }) {
  const peak = Math.max(0.1, ...trend.points.map((point) => Math.abs(point.delta)))
  return (
    <section className="trend-board" aria-labelledby="trend-title">
      <header>
        <span>방치 대비 성공 가능성 차이 · 오래된 판에서 최근 판 순</span>
        <h3 id="trend-title">판단이 나아지고 있나</h3>
      </header>
      {/*
        기둥 수는 판 수만큼이라 두 개일 수도 열두 개일 수도 있다. 남는 폭을
        그대로 나눠 쓰면 두 판일 때 기둥 하나가 600px 짜리 색면이 된다.
        그래서 기둥 수를 CSS 에 넘겨 최대 너비를 거기에 맞춘다.
      */}
      <div
        className="trend-chart"
        style={{ '--n': trend.points.length } as CSSProperties}
        role="img"
        aria-label={`최근 ${trend.points.length}판의 방치 대비 차이. ${trend.note}`}
      >
        <i className="trend-zero" aria-hidden />
        {trend.points.map((point) => (
          <span
            key={point.at}
            className="trend-col"
            data-sign={point.delta >= 0 ? 'up' : 'down'}
            data-passed={point.passed ? 'on' : 'off'}
            title={`${point.problemTitle} · ${point.opponentName} · ${deltaText(point.delta)}`}
          >
            <i style={{ height: `${(Math.abs(point.delta) / peak) * 50}%` }} />
          </span>
        ))}
      </div>
      <div className="trend-axis">
        <small>오래된 판</small>
        <small>점선 = 0%p · 아무것도 안 한 것과 같음</small>
        <small>최근 판</small>
      </div>
      <p>{trend.note}</p>
      {/*
        기둥과 점이 어긋나는 칸이 이 저장소의 house rule 을 눈으로 보여준다.
        여기서 설명하지 않으면 점이 그냥 장식이 된다.
      */}
      <p className="trend-legend">
        기둥은 <b>판단</b>의 값입니다. 가운데 점은 그 한 판의 <b>결과</b>로,
        가득 찬 점이 타파 성공입니다. 기둥이 위인데 점이 비어 있는 칸은 좋은
        판단이 나쁜 결과를 만난 판입니다. 그런 칸이 있다는 것이 이 시뮬레이션이
        정직하다는 뜻입니다.
      </p>
    </section>
  )
}

/* ------------------------------------------------------------------ */

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
  const [confirmingClear, setConfirmingClear] = useState(false)
  const { played, passed, rate } = historySummary(records)
  // 시각은 화면에서만 쓰는 값이라 엔진과 무관하다
  const at = now ?? Date.now()
  const perProblem = byProblem(records)

  // 국면이 요구하는 것에 따라 볼 칸이 다르다. 쫓는 판에서 "상대 슈팅이
  // 줄었다"는 위로가 되지 않는다
  const goalOf = (problemId: string): Goal | undefined => {
    const problem = problems.find((item) => item.id === problemId)
    if (!problem) return undefined
    return problem.goal === '동점 이상' ? 'EQUALIZE' : 'SURVIVE'
  }

  const lesson = lastLesson(records, goalOf)
  const habits = leverHabits(records)
  const trend = deltaTrend(records)

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
        여기부터 세 절은 **기록이 실제로 있을 때만** 나타난다. 옛 기록만
        남은 브라우저에서는 설정과 150판 비교 칸이 없어 하나도 안 뜰 수
        있고, 그게 맞다. 없는 값을 0으로 그리지 않는다.
      */}
      {lesson && <LessonBoard lesson={lesson} />}
      {habits.length > 0 && <HabitBoard habits={habits} />}
      {trend && <TrendBoard trend={trend} />}

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

          {onClear &&
            (confirmingClear ? (
              <div
                className="history-clear-confirm"
                role="alertdialog"
                aria-labelledby="history-clear-question"
              >
                <p id="history-clear-question">
                  <b>모든 기록을 지울까요?</b>
                  <small>지우면 되돌릴 수 없습니다.</small>
                </p>
                <button
                  type="button"
                  className="chip history-clear-cancel"
                  autoFocus
                  onClick={() => setConfirmingClear(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="chip history-clear-confirm-button"
                  onClick={() => {
                    onClear()
                    setConfirmingClear(false)
                  }}
                >
                  모두 지우기
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="chip history-clear"
                onClick={() => setConfirmingClear(true)}
              >
                기록 지우기
              </button>
            ))}
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
