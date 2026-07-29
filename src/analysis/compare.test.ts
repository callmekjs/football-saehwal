import { describe, expect, it } from 'vitest'
import raw from '../data/problems.json' with { type: 'json' }
import { toProblem } from '../sim/problems'
import type { Problem } from '../sim/types'
import { compareDecisions } from './compare'

function problemAt(index: number): Problem {
  return toProblem(raw[index])
}

describe('경기 분석', () => {
  it('무개입과 아무 결정도 하지 않은 사용자는 같은 150판을 받는다', () => {
    const result = compareDecisions(problemAt(0), [])
    expect(result.rows[0].runs).toBe(150)
    expect(result.rows[1].rate).toBe(result.rows[0].rate)
    expect(result.rows[1].profile).toEqual(result.rows[0].profile)
    expect(result.coach.summary).toHaveLength(5)
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

  it('성공률을 재던 같은 경기에서 평균 득실과 위험 채널도 함께 계산한다', () => {
    const result = compareDecisions(problemAt(1), [], 40)
    for (const row of result.rows) {
      expect(row.profile.goalsFor).toBeGreaterThanOrEqual(0)
      expect(row.profile.goalsAgainst).toBeGreaterThanOrEqual(0)
      expect(row.profile.homeAttempt).toBeGreaterThan(row.profile.homeShot)
      expect(row.profile.setPiece).toBeGreaterThanOrEqual(0)
    }
  })
})
