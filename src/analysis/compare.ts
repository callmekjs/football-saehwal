import { simulate, simulateHalves } from '../sim/engine'
import type {
  Decision,
  OpponentId,
  MatchState,
  Problem,
  Recommendation,
} from '../sim/types'
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

/**
 * 브라우저에서 실제로 끝낸 한 판의 읽기 전용 스냅샷.
 *
 * 150판 성공률 계산에는 쓰지 않는다. 판마다 달라지는 시작 전술과 실제 종료
 * 설정을 감독 보고서가 `Problem` 기본값으로 추정하지 않게 하는 근거다.
 */
export interface CoachMatchSnapshot {
  initial: MatchState
  final: MatchState
  firstHalf: MatchState | null
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
  /**
   * 첫 판의 **전반 종료 상태**. 두 반을 뛴 경기에서만 있다.
   *
   * `carryToNextHalf` 가 후반을 시작하면서 기록과 집계를 비우기 때문에,
   * 이걸 따로 챙기지 않으면 전반의 골도 슈팅 수도 보고서에서 사라진다.
   */
  firstHalftime: MatchState | null
}

/**
 * 사용자가 전반부터 뛰었으면 비교도 두 반으로 돌린다.
 *
 * **이걸 안 맞추면 판단 평가가 통째로 틀린다.** 사용자는 1,500틱을 겪었는데
 * 무개입 기준선을 750틱으로 재면, 노출 시간이 절반이라 무개입 통과율이
 * 실제보다 훨씬 높게 나온다. 그러면 "당신의 판단이 무개입보다 못했다"는
 * 거짓 결론이 나온다.
 */
function runOnce(
  problem: Problem,
  second: Decision[],
  first: Decision[] | null,
  opponent: OpponentId,
): { final: MatchState; passed: boolean; halftime: MatchState | null } {
  if (first === null) {
    const run = simulate(problem, second, opponent)
    return { final: run.final, passed: run.passed, halftime: null }
  }
  return simulateHalves(problem, first, second, opponent)
}

function measure(
  problem: Problem,
  decisions: Decision[],
  runs: number,
  /** 전반 결정. 있으면 두 반을 이어 돌린다 */
  firstHalf: Decision[] | null = null,
  /**
   * 사용자가 실제로 만난 상대.
   *
   * **이걸 안 맞추면 판단 평가가 통째로 틀린다.** 어려움으로 이겨놓고
   * 보통 기준선과 비교하면 "무개입보다 못했다"가 나온다.
   */
  opponent: OpponentId = 'USA',
): MeasureResult {
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
  let firstHalftime: MatchState | null = null

  for (let i = 0; i < runs; i++) {
    const replay = { ...problem, seed: problem.seed + i }
    const result = runOnce(replay, decisions, firstHalf, opponent)
    if (i === 0) {
      firstFinal = result.final
      firstHalftime = result.halftime
    }
    if (result.passed) passed += 1
    totals.goalsFor += result.final.score[0] - problem.score[0]
    totals.goalsAgainst += result.final.score[1] - problem.score[1]
    // `simulateHalves` 의 최종 상태에는 후반 통계와 로그만 남는다.
    // 점수는 전반부터 이어지지만, 나머지 프로필은 전반 종료 상태를 따로
    // 더해야 이번 경기와 150판 평균이 같은 두 반을 비교한다.
    const recordedHalves = result.halftime
      ? [result.halftime, result.final]
      : [result.final]
    for (const half of recordedHalves) {
      totals.homeAttempt += half.stats.homeAttempt
      totals.awayAttempt += half.stats.awayAttempt
      totals.homeShot += half.stats.homeShot
      totals.awayShot += half.stats.awayShot
      totals.setPiece += half.stats.setPiece
      totals.behind += half.stats.behind
      totals.sendOff += half.log.filter((event) => event.kind === 'SEND_OFF').length
      totals.injury += half.log.filter((event) => event.kind === 'INJURY').length
    }
  }

  if (!firstFinal) throw new Error('분석할 경기가 없다')
  const average = Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, value / runs]),
  ) as unknown as OutcomeProfile
  return { passed, profile: average, firstFinal, firstHalftime }
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
  /**
   * 전반에 내린 결정. 전반부터 뛴 경기에서만 있다.
   *
   * 있으면 무개입·나의 판단·권장 전술을 전부 **두 반**으로 돌린다.
   */
  firstHalf: Decision[] | null = null,
  /**
   * 사용자가 실제로 만난 상대. 세 채널을 **모두** 이 난이도로 돌린다.
   *
   * 무개입 기준선이 다른 난이도에서 재어지면 "당신의 판단이 무개입보다
   * 못했다"가 상대가 세서 생긴 차이를 감독 탓으로 돌리게 된다.
   */
  opponent: OpponentId = 'USA',
  /** 실제 한 경기의 시작·종료 기록. 150판 계산과는 분리한다. */
  match: CoachMatchSnapshot | null = null,
): MatchAnalysis {
  if (!Number.isInteger(runs) || runs <= 0) throw new Error('분석 횟수는 양의 정수여야 한다')
  if (!problem.recommendation) throw new Error(`${problem.id}: 권장 전술이 없다`)

  // 무개입과 권장 전술도 사용자와 **같은 반 수**로 돌려야 비교가 성립한다
  const noop = measure(problem, [], runs, firstHalf && [], opponent)
  const user = measure(problem, userDecisions, runs, firstHalf, opponent)
  const recommendation = measure(
    problem,
    planOf(problem.recommendation),
    runs,
    firstHalf && planOf(problem.recommendation),
    opponent,
  )

  const rows = [
    row('noop', '무개입', noop, runs),
    row('user', '나의 판단', user, runs),
    row('recommendation', '권장 전술', recommendation, runs),
  ]
  const userDelta = rows[1].rate - rows[0].rate
  const reportHalftime = match?.firstHalf ?? user.firstHalftime

  return {
    rows,
    recommendation: problem.recommendation,
    userDelta,
    coach: buildCoachReport(
      problem,
      match?.final ?? user.firstFinal,
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
      // 전반부터 뛴 경기라면 전반 결정과 전반 종료 기록을 함께 넘긴다.
      // 안 넘기면 전반에 내린 포메이션·교체·개별 지시가 보고서에서 통째로
      // 빠지고, 후반 장면의 "당시 설정"도 앞 감독의 초기값으로 잘못 적힌다.
      firstHalf && reportHalftime
        ? { decisions: firstHalf, final: reportHalftime }
        : null,
      match?.initial ?? null,
    ),
  }
}
