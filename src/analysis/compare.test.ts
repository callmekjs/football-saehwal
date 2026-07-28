import { describe, expect, it } from 'vitest'
import raw from '../data/problems.json' with { type: 'json' }
import type { FormationId } from '../sim/formations'
import type { Level, Problem } from '../sim/types'
import { compareDecisions } from './compare'

function problemAt(index: number): Problem {
  const p = raw[index]
  return {
    ...p,
    score: [p.score[0], p.score[1]],
    initialFormation: p.initialFormation as FormationId,
    initialTactics: p.initialTactics as { line: Level; press: Level; width: Level },
    objective: p.objective as Problem['objective'],
    recommendation: {
      ...p.recommendation,
      formation: p.recommendation.formation as FormationId,
      tactics: p.recommendation.tactics as { line: Level; press: Level; width: Level },
    },
    staminaOverrides: { ...p.staminaOverrides } as Record<string, number>,
  }
}

describe('경기 분석', () => {
  it('무개입과 아무 결정도 하지 않은 사용자는 같은 150판을 받는다', () => {
    const result = compareDecisions(problemAt(0), [])
    expect(result.rows[0].runs).toBe(150)
    expect(result.rows[1].rate).toBe(result.rows[0].rate)
  })

  it('같은 국면과 결정은 언제나 같은 분석을 만든다', () => {
    const problem = problemAt(1)
    expect(compareDecisions(problem, [], 30)).toEqual(compareDecisions(problem, [], 30))
  })

  it('모든 국면의 권장 전술은 방치보다 성공 가능성을 확실히 높인다', () => {
    for (let index = 0; index < raw.length; index++) {
      const result = compareDecisions(problemAt(index), [])
      expect(result.rows[2].rate).toBeGreaterThan(result.rows[0].rate + 0.1)
    }
  })
})
