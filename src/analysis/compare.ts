import { simulate } from '../sim/engine'
import type { Decision, Problem, Recommendation } from '../sim/types'

/** 한 번의 운이 아니라 판단을 비교하기 위한 반복 횟수 */
export const ANALYSIS_RUNS = 150

export interface AnalysisRow {
  key: 'noop' | 'user' | 'recommendation'
  label: string
  passed: number
  runs: number
  rate: number
}

export interface MatchAnalysis {
  rows: AnalysisRow[]
  recommendation: Recommendation
  userDelta: number
}

function planOf(recommendation: Recommendation): Decision[] {
  const { line, press, width } = recommendation.tactics
  return [
    { tick: 0, type: 'FORMATION', value: recommendation.formation },
    { tick: 0, type: 'LINE', value: line },
    { tick: 0, type: 'PRESS', value: press },
    { tick: 0, type: 'WIDTH', value: width },
  ]
}

/**
 * 세 전술은 반드시 같은 시드 묶음으로 돌린다.
 *
 * 서로 다른 운을 주면 전술 차이와 운 차이가 섞인다. 같은 150개의 경기를
 * 무개입·사용자 판단·권장 전술에 똑같이 주면 달라지는 것은 결정뿐이다.
 */
function measure(problem: Problem, decisions: Decision[], runs: number): number {
  let passed = 0
  for (let i = 0; i < runs; i++) {
    const replay = { ...problem, seed: problem.seed + i }
    if (simulate(replay, decisions).passed) passed += 1
  }
  return passed
}

function row(
  key: AnalysisRow['key'],
  label: string,
  passed: number,
  runs: number,
): AnalysisRow {
  return { key, label, passed, runs, rate: passed / runs }
}

export function compareDecisions(
  problem: Problem,
  userDecisions: Decision[],
  runs = ANALYSIS_RUNS,
): MatchAnalysis {
  if (!Number.isInteger(runs) || runs <= 0) throw new Error('분석 횟수는 양의 정수여야 한다')
  if (!problem.recommendation) throw new Error(`${problem.id}: 권장 전술이 없다`)

  const noopPassed = measure(problem, [], runs)
  const userPassed = measure(problem, userDecisions, runs)
  const recommendedPassed = measure(problem, planOf(problem.recommendation), runs)

  const rows = [
    row('noop', '무개입', noopPassed, runs),
    row('user', '나의 판단', userPassed, runs),
    row('recommendation', '권장 전술', recommendedPassed, runs),
  ]

  return {
    rows,
    recommendation: problem.recommendation,
    userDelta: rows[1].rate - rows[0].rate,
  }
}
