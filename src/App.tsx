import { useMemo, useState } from 'react'
import raw from './data/problems.json' with { type: 'json' }
import { MatchScreen } from './ui/MatchScreen'
import type { FormationId } from './sim/formations'
import type { Level, Objective, Problem } from './sim/types'

/** 국면 카드에 띄울 정보. 국면 데이터에서 파생한다 */
interface Entry {
  problem: Problem
  kickoff: number
  summary: string
}

const KICKOFF: Record<string, number> = { p01: 70, p02: 70, p04: 80 }

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
    objective: p.objective as Objective,
  }
}

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
      <>
        <button
          onClick={() => setPicked(null)}
          style={{ margin: '10px 0 0 14px', fontSize: 13, color: 'var(--muted)' }}
        >
          ← 국면 선택으로
        </button>
        <MatchScreen key={picked.problem.id} problem={picked.problem} kickoff={picked.kickoff} />
      </>
    )
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 20, display: 'grid', gap: 14 }}>
      <div style={{ marginTop: 20 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 500 }}>축구 사활</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
          경기 15분을 75초 안에 풀어냅니다. 시계는 멈추지 않고, 되돌릴 수 없습니다.
        </p>
      </div>

      {entries.map((e) => (
        <button
          key={e.problem.id}
          className="panel"
          onClick={() => setPicked(e)}
          style={{ padding: 16, textAlign: 'left', display: 'grid', gap: 6 }}
        >
          <strong style={{ fontSize: 17 }}>{e.problem.title}</strong>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{e.summary}</span>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>
            후반 {e.kickoff}분 · 교체 {e.problem.subsLeft}장 ·{' '}
            {e.problem.objective.type === 'SURVIVE' ? '리드 지키기' : '동점 이상'}
          </span>
        </button>
      ))}
    </main>
  )
}
