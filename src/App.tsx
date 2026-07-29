import { useMemo, useState } from 'react'
import raw from './data/problems.json' with { type: 'json' }
import { toProblem } from './sim/problems'
import { Backdrop } from './ui/Backdrop'
import { MatchScreen, addedTimeOf } from './ui/MatchScreen'
import type { Problem } from './sim/types'

/** 국면 카드에 띄울 정보. 국면 데이터에서 파생한다 */
interface Entry {
  problem: Problem
  kickoff: number
  summary: string
}

function FixtureCard({
  entry,
  n,
  onPick,
}: {
  entry: Entry
  n: number
  onPick: () => void
}) {
  const { problem, kickoff, summary } = entry
  const survive = problem.objective.type === 'SURVIVE'
  return (
    <button className="fixture" onClick={onPick}>
      <span className="fx-band">
        <b>제{n}국면</b>
        <span>
          후반 {kickoff}분 · 추가시간 {addedTimeOf(kickoff)}분
        </span>
      </span>
      <span className="fx-main">
        <span className="fx-score">
          {problem.score[0]}
          <em>–</em>
          {problem.score[1]}
        </span>
        <strong className="fx-title">{problem.title}</strong>
        <span className="fx-sum">{summary}</span>
      </span>
      <span className="fx-chips">
        <span className="tagchip">{survive ? '리드 지키기' : '동점 이상'}</span>
        <span className="tagchip dim">교체 {problem.subsLeft}장</span>
        {problem.awayCount < 11 && <span className="tagchip warn">상대 10명</span>}
        {problem.unavailable.length > 0 && <span className="tagchip warn">우리 10명</span>}
        {problem.booked.length > 0 && <span className="tagchip warn">경고 보유</span>}
      </span>
      <span className="fx-cta">
        도전 <i aria-hidden>›</i>
      </span>
    </button>
  )
}

const TICKER =
  '시계는 멈추지 않는다 — 일시정지 없음　　되돌릴 수 없다 — 교체 카드는 회수되지 않는다　　' +
  '결과와 판단은 따로 본다 — 무너져도 좋은 판단일 수 있다　　판마다 더 나은 전술이 다르다 — 만능 전술은 없다　　' +
  '모든 국면·선수·수치는 창작이다　　'

export function App() {
  const entries = useMemo<Entry[]>(
    () =>
      raw
        .map(toProblem)
        .sort((a, b) => a.order - b.order)
        // 시작 분과 한 줄 요약은 국면 데이터에서 온다. 화면에 국면 id 별
        // 표를 두면 국면을 하나 넣을 때마다 이 파일을 고쳐야 한다
        .map((problem) => ({
          problem,
          kickoff: problem.kickoff ?? 70,
          summary: problem.summary ?? '',
        })),
    [],
  )

  const [picked, setPicked] = useState<Entry | null>(null)
  /**
   * 몇 번째 도전인가.
   *
   * 시작 조건(체력·경고·앞 감독이 걸어둔 지시와 전술)은 국면 시드에서
   * 뽑는다. 시드를 고정해두면 같은 국면을 몇 번을 해도 **완전히 같은
   * 판**이 나와, 한 번 푼 뒤로는 같은 답을 다시 입력하는 것이 된다.
   * 도전할 때마다 시드를 옮겨 새 판을 받는다.
   *
   * 옮기는 폭이 큰 소수인 이유: 시드를 1씩 더하면 이웃한 판끼리 난수가
   * 비슷해 보일 수 있다. 멀리 떨어뜨리면 그럴 일이 없다.
   */
  const [attempt, setAttempt] = useState(0)

  if (picked) {
    const problem = { ...picked.problem, seed: picked.problem.seed + attempt * 7919 }
    return (
      <MatchScreen
        key={`${picked.problem.id}#${attempt}`}
        problem={problem}
        kickoff={picked.kickoff}
        onExit={() => setPicked(null)}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    )
  }

  return (
    <div className="home">
      <header className="topbar">
        <span className="wordmark">축구 사활</span>
        <span className="topchip">감독 모드 · 월간 해커톤</span>
      </header>

      <section className="hero">
        <div className="hero-pitch">
          <Backdrop problem={entries[0].problem} />
        </div>
        <div className="hero-shade" aria-hidden />
        <div className="hero-scan" aria-hidden />
        <div className="hero-inner">
          <span className="live">
            <i aria-hidden />
            라이브 — 뒤에서 엔진이 진짜 경기를 돌리고 있다
          </span>
          <h1 className="hero-title">
            신의 한수:
            <br />
            <em>축구 사활</em>
          </h1>
          <p className="hero-sub">
            경기 15분을 75초에 압축한 실시간 전술 시뮬레이션.
            <br />
            시계는 멈추지 않고, 내린 결정은 되돌릴 수 없다.
          </p>
          <div className="hero-cta">
            <button
              className="cta"
              onClick={() => {
                setPicked(entries[0])
                setAttempt((n) => n + 1)
              }}
            >
              바로 킥오프
            </button>
            <a className="cta ghost" href="#fixtures">
              국면 고르기
            </a>
          </div>
        </div>
      </section>

      <section id="fixtures" className="board">
        <div className="board-head">
          <h2>국면 선택</h2>
          <span>전술 상황 훈련 — 판마다 더 나은 선택이 다르다</span>
        </div>
        <div className="fixtures">
          {entries.map((e, i) => (
            <FixtureCard key={e.problem.id} entry={e} n={i + 1} onPick={() => {
                setPicked(e)
                // 들어갈 때마다 새 판이다. 나갔다 다시 들어와서 똑같은
                // 경기가 나오면 흔들어둔 의미가 없다
                setAttempt((n) => n + 1)
              }} />
          ))}
        </div>
      </section>

      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          <span>{TICKER}</span>
          <span>{TICKER}</span>
        </div>
      </div>

      <p className="foot">
        등장하는 국면·선수·수치는 전부 창작이며 실제 경기·실존 인물과 무관합니다.
      </p>
    </div>
  )
}
