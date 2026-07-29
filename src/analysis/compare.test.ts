import { describe, expect, it } from 'vitest'
import raw from '../data/problems.json' with { type: 'json' }
import { toProblem } from '../sim/problems'
import { simulate, simulateHalves } from '../sim/engine'
import type { Decision, MatchState, Problem } from '../sim/types'
import type { OutcomeProfile } from './coach'
import { compareDecisions } from './compare'

function problemAt(index: number): Problem {
  return toProblem(raw[index])
}

const emptyProfile = (): OutcomeProfile => ({
  goalsFor: 0,
  goalsAgainst: 0,
  homeAttempt: 0,
  awayAttempt: 0,
  homeShot: 0,
  awayShot: 0,
  setPiece: 0,
  behind: 0,
  sendOff: 0,
  injury: 0,
})

function profileOf(problem: Problem, halves: MatchState[]): OutcomeProfile {
  const final = halves[halves.length - 1]
  const profile = emptyProfile()
  profile.goalsFor = final.score[0] - problem.score[0]
  profile.goalsAgainst = final.score[1] - problem.score[1]
  for (const half of halves) {
    profile.homeAttempt += half.stats.homeAttempt
    profile.awayAttempt += half.stats.awayAttempt
    profile.homeShot += half.stats.homeShot
    profile.awayShot += half.stats.awayShot
    profile.setPiece += half.stats.setPiece
    profile.behind += half.stats.behind
    profile.sendOff += half.log.filter((event) => event.kind === 'SEND_OFF').length
    profile.injury += half.log.filter((event) => event.kind === 'INJURY').length
  }
  return profile
}

function expectProfileClose(actual: OutcomeProfile, expected: OutcomeProfile) {
  for (const key of Object.keys(expected) as (keyof OutcomeProfile)[]) {
    expect(actual[key]).toBeCloseTo(expected[key])
  }
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

  it('전반부터 뛴 경기는 감독 보고서가 전반 결정과 전반 기록까지 말한다', () => {
    const problem = problemAt(1)
    const first: Decision[] = [{ tick: 40, type: 'FORMATION', value: '5-4-1' }]
    const second: Decision[] = [{ tick: 200, type: 'LINE', value: 1 }]
    const result = compareDecisions(problem, second, 12, 70, first)
    const halves = result.coach.decisionReview.find(
      (finding) => finding.id === 'decision-halves',
    )

    expect(halves?.title).toBe('전반 1회 · 후반 1회')
    expect(halves?.evidence.join(' ')).toContain('5-4-1')
    // 전반 기록이 실제로 넘어왔는지 — 후반 집계만 보면 이 합계가 안 나온다
    expect(result.coach.summary[0]).toContain('전반')
  })

  it('후반만 뛴 경기는 반 이름표 없이 예전과 같은 보고서를 낸다', () => {
    const result = compareDecisions(problemAt(1), [], 12)
    expect(
      result.coach.decisionReview.some((finding) => finding.id === 'decision-halves'),
    ).toBe(false)
    expect(JSON.stringify(result.coach)).not.toContain('전반')
  })

  it('한 반짜리 150판 프로필은 최종 상태 한 반만 집계한다', () => {
    const problem = problemAt(1)
    const runs = 12
    const expected = emptyProfile()
    let passed = 0

    for (let i = 0; i < runs; i++) {
      const replay = { ...problem, seed: problem.seed + i }
      const run = simulate(replay, [])
      const profile = profileOf(replay, [run.final])
      for (const key of Object.keys(expected) as (keyof OutcomeProfile)[]) {
        expected[key] += profile[key] / runs
      }
      if (run.passed) passed += 1
    }

    const row = compareDecisions(problem, [], runs).rows[1]
    expect(row.passed).toBe(passed)
    expectProfileClose(row.profile, expected)
  })

  it('두 반짜리 150판 프로필은 전반과 후반 기록을 모두 더한다', () => {
    const problem = problemAt(1)
    const runs = 12
    const expected = emptyProfile()
    let passed = 0

    for (let i = 0; i < runs; i++) {
      const replay = { ...problem, seed: problem.seed + i }
      const run = simulateHalves(replay, [], [])
      const profile = profileOf(replay, [run.halftime, run.final])
      for (const key of Object.keys(expected) as (keyof OutcomeProfile)[]) {
        expected[key] += profile[key] / runs
      }
      if (run.passed) passed += 1
    }

    const row = compareDecisions(problem, [], runs, 70, []).rows[1]
    expect(row.passed).toBe(passed)
    expectProfileClose(row.profile, expected)
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
