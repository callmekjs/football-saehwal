import { useMemo, useState } from 'react'
import raw from './data/problems.json' with { type: 'json' }
import { Backdrop } from './ui/Backdrop'
import { MatchScreen, addedTimeOf } from './ui/MatchScreen'
import type { FormationId } from './sim/formations'
import type { Level, Objective, Problem } from './sim/types'

/** 국면 카드에 띄울 정보. 국면 데이터에서 파생한다 */
interface Entry {
  problem: Problem
  kickoff: number
  summary: string
}

/**
 * 국면이 시작하는 후반 분.
 *
 * 축구 후반은 90분에 끝나지 않는다. 90분을 채우고 주심이 정한 추가시간을
 * 더 뛰고 끝난다. 전에는 70분에 시작해 85분에 끝났는데, 85분은 축구에서
 * 아무 의미가 없는 시각이라 "왜 여기서 끝나지?"가 된다.
 *
 * 이 화면은 15분 구간을 다루므로, 끝나는 시각이 90분 + 추가시간(1~5분)이
 * 되도록 시작 분을 잡는다. 국면마다 추가시간이 다르다 — 추가시간은
 * 주심이 그 경기의 지연을 보고 정하는 것이지 고정값이 아니다.
 *
 * 시작 분은 **화면 표시에만 쓰인다.** 경기 길이는 750틱으로 고정이고
 * 이 숫자를 바꿔도 확률과 밸런스는 움직이지 않는다.
 */
const KICKOFF: Record<string, number> = {
  p01: 78, // → 93:00 = 90 + 3
  p02: 77, // → 92:00 = 90 + 2
  p04: 80, // → 95:00 = 90 + 5
}

const SUMMARY: Record<string, string> = {
  p01: '0-1로 지고 있다. 상대는 골문 앞에 사람을 모았다',
  p02: '1-0으로 이기고 있다. 앞 감독이 전부 잠가놓았다',
  p04: '1-0으로 이기는데 한 명이 퇴장당했다',
}

function toProblem(p: (typeof raw)[number]): Problem {
  const level = (v: number): Level => {
    if (v !== 0 && v !== 1 && v !== 2) throw new Error(`${p.id}: 레버 값이 0·1·2가 아니다`)
    return v
  }
  return {
    id: p.id,
    title: p.title,
    order: p.order,
    seed: p.seed,
    subsLeft: p.subsLeft,
    awayCount: p.awayCount,
    booked: [...p.booked],
    unavailable: [...p.unavailable],
    staminaOverrides: { ...p.staminaOverrides } as Record<string, number>,
    initialFormation: p.initialFormation as FormationId,
    score: [p.score[0], p.score[1]],
    initialTactics: {
      line: level(p.initialTactics.line),
      press: level(p.initialTactics.press),
      width: level(p.initialTactics.width),
    },
    recommendation: {
      formation: p.recommendation.formation as FormationId,
      tactics: {
        line: level(p.recommendation.tactics.line),
        press: level(p.recommendation.tactics.press),
        width: level(p.recommendation.tactics.width),
      },
      explanation: p.recommendation.explanation,
    },
    objective: p.objective as Objective,
  }
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
        .map((problem) => ({
          problem,
          kickoff: KICKOFF[problem.id] ?? 70,
          summary: SUMMARY[problem.id] ?? '',
        })),
    [],
  )

  const [picked, setPicked] = useState<Entry | null>(null)

  if (picked) {
    return (
      <MatchScreen
        key={picked.problem.id}
        problem={picked.problem}
        kickoff={picked.kickoff}
        onExit={() => setPicked(null)}
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
            <button className="cta" onClick={() => setPicked(entries[0])}>
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
            <FixtureCard key={e.problem.id} entry={e} n={i + 1} onPick={() => setPicked(e)} />
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
