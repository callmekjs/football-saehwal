import { simulate } from '../sim/engine'
import type { Decision, MatchState, Problem, Recommendation } from '../sim/types'
import {
  buildCoachReport,
  type CoachReport,
  type OutcomeProfile,
} from './coach'

/** 한 번의 운이 아니라 판단을 비교하기 위한 반복 횟수 */
export const ANALYSIS_RUNS = 150

export interface AnalysisRow {
  key: 'noop' | 'user' | 'recommendation'
  label: string
  passed: number
  runs: number
  rate: number
  profile: OutcomeProfile
}

export interface MatchAnalysis {
  rows: AnalysisRow[]
  recommendation: Recommendation
  userDelta: number
  coach: CoachReport
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
interface MeasureResult {
  passed: number
  profile: OutcomeProfile
  firstFinal: MatchState
}

function measure(problem: Problem, decisions: Decision[], runs: number): MeasureResult {
  // 같은 반복 경기의 최종 상태를 함께 모아, 별도 시뮬레이션 없이 채널별 평균을 만든다.
  let passed = 0
  const totals: OutcomeProfile = {
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
  }
  let firstFinal: MatchState | null = null

  for (let i = 0; i < runs; i++) {
    const replay = { ...problem, seed: problem.seed + i }
    const result = simulate(replay, decisions)
    if (i === 0) firstFinal = result.final
    if (result.passed) passed += 1
    totals.goalsFor += result.final.score[0] - problem.score[0]
    totals.goalsAgainst += result.final.score[1] - problem.score[1]
    totals.homeAttempt += result.final.stats.homeAttempt
    totals.awayAttempt += result.final.stats.awayAttempt
    totals.homeShot += result.final.stats.homeShot
    totals.awayShot += result.final.stats.awayShot
    totals.setPiece += result.final.stats.setPiece
    totals.behind += result.final.stats.behind
    totals.sendOff += result.final.log.filter((event) => event.kind === 'SEND_OFF').length
    totals.injury += result.final.log.filter((event) => event.kind === 'INJURY').length
  }

  if (!firstFinal) throw new Error('분석할 경기가 없다')
  const average = Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, value / runs]),
  ) as unknown as OutcomeProfile
  return { passed, profile: average, firstFinal }
}

function row(
  key: AnalysisRow['key'],
  label: string,
  measured: MeasureResult,
  runs: number,
): AnalysisRow {
  return {
    key,
    label,
    passed: measured.passed,
    runs,
    rate: measured.passed / runs,
    profile: measured.profile,
  }
}

export function compareDecisions(
  problem: Problem,
  userDecisions: Decision[],
  runs = ANALYSIS_RUNS,
  kickoff = 70,
): MatchAnalysis {
  if (!Number.isInteger(runs) || runs <= 0) throw new Error('분석 횟수는 양의 정수여야 한다')
  if (!problem.recommendation) throw new Error(`${problem.id}: 권장 전술이 없다`)

  const noop = measure(problem, [], runs)
  const user = measure(problem, userDecisions, runs)
  const recommendation = measure(problem, planOf(problem.recommendation), runs)

  const rows = [
    row('noop', '무개입', noop, runs),
    row('user', '나의 판단', user, runs),
    row('recommendation', '권장 전술', recommendation, runs),
  ]
  const userDelta = rows[1].rate - rows[0].rate

  return {
    rows,
    recommendation: problem.recommendation,
    userDelta,
    coach: buildCoachReport(
      problem,
      user.firstFinal,
      userDecisions,
      {
        noopRate: rows[0].rate,
        userRate: rows[1].rate,
        recommendationRate: rows[2].rate,
        userDelta,
        profiles: {
          noop: noop.profile,
          user: user.profile,
          recommendation: recommendation.profile,
        },
      },
      kickoff,
    ),
  }
}
