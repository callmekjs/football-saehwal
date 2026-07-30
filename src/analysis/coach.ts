import { SEGMENT_MINUTES, halfLabel, kickoffMinute, type Half } from '../matchClock'
import { withJosa } from './josa'
import { TOTAL_TICKS } from '../sim/constants'
import type { FormationId } from '../sim/formations'
import { getPlayer } from '../sim/squad'
import { opponentInfo, REFERENCE_TEAM } from './opponents'
import type {
  Decision,
  OpponentId,
  Level,
  MatchEventLog,
  MatchState,
  PlayerOrder,
  PlayerPosition,
  Problem,
  Tactics,
} from '../sim/types'

/**
 * 감독 보고서 — 경기가 끝난 뒤 무엇이 왜 일어났는지 설명한다.
 *
 * ★ **경기는 한 반일 수도 두 반일 수도 있다.** 사용자가 전반을 고르면
 * 전반을 뛰고 그대로 후반까지 이어진다(`simulateHalves`). 그때 보고서가
 * 후반만 보면 전반에 내린 포메이션 변경·교체·개별 지시가 통째로 빠지고,
 * 후반 장면의 "당시 설정"도 앞 감독의 초기값으로 잘못 적힌다.
 *
 * 그래서 이 파일은 두 반을 `Leg` 라는 같은 모양으로 다루고, 모든 시각을
 * **경기 전체 기준 틱(`g`)** 으로 줄 세운다. 같은 틱 번호가 두 반에
 * 존재하므로(전반 30틱과 후반 30틱), `g` 없이는 둘이 같은 시각으로 찍힌다.
 *
 * ★ **후반만 뛴 경기는 예전과 똑같이 동작해야 한다.** 반 이름표(`전반`·
 * `후반`)는 반이 둘일 때만 붙고, 하나일 때의 문구·시각·근거는 그대로다.
 *
 * ★ **읽기만 한다.** 경기 결과·확률·매 틱 난수 18개에 닿지 않는다.
 */

export type Confidence = '높음' | '보통' | '낮음'

interface ConfidenceBasis {
  /** 경기 이벤트나 결정 이력에서 직접 확인했다 */
  observed?: boolean
  /** 같은 위험이나 행동이 둘 이상 반복됐다 */
  repeated?: boolean
  /** 같은 시드 묶음 또는 검증된 권장안과 비교했다 */
  compared?: boolean
  /** 경로 자체가 기록에 없어 장면과 연결할 수 없다 */
  unavailable?: boolean
}

/**
 * 확신도는 문구에 붙이는 고정 딱지가 아니라 근거의 양과 종류로 정한다.
 *
 * 근거가 없거나 장면 경로를 확인할 수 없으면 낮음, 한 종류의 근거만 있으면
 * 보통이다. 근거가 두 줄 이상이고 직접 관찰·반복·비교 중 두 종류 이상이
 * 겹칠 때만 높음으로 올린다.
 */
function confidenceOf(
  evidence: readonly string[],
  basis: ConfidenceBasis,
): Confidence {
  if (basis.unavailable || evidence.length === 0) return '낮음'

  const sourceCount = [
    basis.observed,
    basis.repeated,
    basis.compared,
  ].filter(Boolean).length
  return evidence.length >= 2 && sourceCount >= 2 ? '높음' : '보통'
}

export interface CoachFinding {
  id: string
  label: string
  time?: string
  title: string
  explanation: string
  evidence: string[]
  confidence: Confidence
}

export interface CoachReport {
  headline: string
  summary: string[]
  turningPoint: CoachFinding
  goalsFor: CoachFinding[]
  goalsAgainst: CoachFinding[]
  decisionReview: CoachFinding[]
  prescriptions: string[]
}

export interface CoachMetrics {
  noopRate: number
  userRate: number
  recommendationRate: number
  userDelta: number
  profiles: {
    noop: OutcomeProfile
    user: OutcomeProfile
    recommendation: OutcomeProfile
  }
}

export interface OutcomeProfile {
  goalsFor: number
  goalsAgainst: number
  homeAttempt: number
  awayAttempt: number
  homeShot: number
  awayShot: number
  setPiece: number
  behind: number
  sendOff: number
  injury: number
}

/**
 * 전반의 기록. 사용자가 전반부터 뛴 경기에서만 있다.
 *
 * `final` 은 전반 종료 시점의 상태다(`simulateHalves` 의 `halftime`).
 * 후반 상태는 `carryToNextHalf` 가 기록과 집계를 비웠으므로, 이걸 받지
 * 않으면 전반의 골도 통계도 보고서에 존재하지 않는다.
 */
export interface CoachFirstHalf {
  decisions: Decision[]
  final: MatchState
}

/** 한 반의 기록. 전반부터 뛰면 둘, 후반만 뛰면 하나다 */
interface Leg {
  half: Half
  /** 이 반이 재개하는 분. 전반 25, 후반 70 */
  kickoff: number
  decisions: Decision[]
  final: MatchState
}

/** 경기 전체의 시간축 위에 놓인 무엇 하나 */
interface Timed<T> {
  /**
   * 경기 전체 기준 틱.
   *
   * 반마다 틱이 0부터 다시 시작하므로 이것 없이는 전반 30틱과 후반 30틱을
   * 구분할 수 없다.
   */
  g: number
  leg: Leg
  tick: number
  value: T
}

interface Setup {
  formation: FormationId
  tactics: Tactics
  orders: Map<string, PlayerOrder>
  positions: Map<string, PlayerPosition>
}

type Stats = MatchState['stats']

const LEVEL_LABEL: Record<'line' | 'press' | 'width', Record<Level, string>> = {
  line: { 0: '낮음', 1: '보통', 2: '높음' },
  press: { 0: '약', 1: '중', 2: '강' },
  width: { 0: '좁게', 1: '보통', 2: '넓게' },
}

const ORDER_LABEL: Record<PlayerOrder, string> = {
  NONE: '지시 해제',
  HOLD: '골문 앞',
  BACK_OFF: '물러서라',
  CONSERVE: '아껴 뛰어라',
  DROP_BACK: '내려서라',
  PUSH_UP: '올라가라',
}

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`
const point = (rate: number) => `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(1)}%p`

/**
 * 어느 상대로 잰 150경기인가.
 *
 * 총평은 다섯 줄로 고정이라 줄을 늘리지 않고 150판 숫자가 있는 줄에 붙인다.
 * **기준팀일 때는 적지 않는다** — 기본값이라 할 말이 없고, 적으면 예전
 * 보고서와 문장이 달라져 회귀 검사가 깨진다.
 */
const foeNote = (opponent: OpponentId): string =>
  opponent === REFERENCE_TEAM ? '' : ` · ${opponentInfo(opponent).name} 상대 기준`

function clockOf(tick: number, kickoff: number): string {
  const totalSeconds = Math.round((kickoff + (tick / TOTAL_TICKS) * SEGMENT_MINUTES) * 60)
  const minute = Math.floor(totalSeconds / 60)
  const second = totalSeconds % 60
  return `${minute}:${String(second).padStart(2, '0')}`
}

/**
 * 화면에 적는 시각.
 *
 * 반이 둘일 때만 `전반`·`후반`을 붙인다. 분이 이미 25~47 과 70~92 로
 * 갈리지만, 비전공자에게는 "전반 32:11" 이 훨씬 빨리 읽힌다.
 */
function stamp(leg: Leg, tick: number, showHalf: boolean): string {
  const clock = clockOf(tick, leg.kickoff)
  return showHalf ? `${halfLabel(leg.half)} ${clock}` : clock
}

/** 등번호. 명단에 없는 id 가 들어와도 보고서가 죽지 않는다 */
function numberOf(id: string): string {
  try {
    return `${getPlayer(id).num}번`
  } catch {
    return id
  }
}

function sumStats(legs: Leg[]): Stats {
  return legs.reduce<Stats>(
    (acc, leg) => ({
      homeAttempt: acc.homeAttempt + leg.final.stats.homeAttempt,
      awayAttempt: acc.awayAttempt + leg.final.stats.awayAttempt,
      homeShot: acc.homeShot + leg.final.stats.homeShot,
      awayShot: acc.awayShot + leg.final.stats.awayShot,
      setPiece: acc.setPiece + leg.final.stats.setPiece,
      behind: acc.behind + leg.final.stats.behind,
    }),
    { homeAttempt: 0, awayAttempt: 0, homeShot: 0, awayShot: 0, setPiece: 0, behind: 0 },
  )
}

/**
 * 그 시점까지의 설정.
 *
 * **전반 결정도 반드시 포함해야 한다.** 전반에 5-4-1 로 바꾼 감독의 후반
 * 실점 장면에 "당시 포메이션 4-4-2" 라고 적으면 그건 거짓 근거다.
 */
function setupAt(problem: Problem, timeline: Timed<Decision>[], g: number): Setup {
  const setup: Setup = {
    formation: problem.initialFormation,
    tactics: { ...problem.initialTactics },
    orders: new Map(),
    positions: new Map(),
  }

  for (const item of timeline) {
    if (item.g > g) break
    const decision = item.value
    if (decision.type === 'FORMATION') {
      setup.formation = decision.value
      setup.positions.clear()
    }
    else if (decision.type === 'LINE') setup.tactics.line = decision.value
    else if (decision.type === 'PRESS') setup.tactics.press = decision.value
    else if (decision.type === 'WIDTH') setup.tactics.width = decision.value
    else if (decision.type === 'ORDER') setup.orders.set(decision.target, decision.order)
    else if (decision.type === 'POSITION') {
      if (decision.position) setup.positions.set(decision.target, decision.position)
      else setup.positions.delete(decision.target)
    }
  }
  return setup
}

function setupText(setup: Setup): string {
  const positionText =
    setup.positions.size > 0 ? ` · 직접 배치 ${setup.positions.size}명` : ''
  return `${setup.formation} · 라인 ${LEVEL_LABEL.line[setup.tactics.line]} · 압박 ${
    LEVEL_LABEL.press[setup.tactics.press]
  } · 폭 ${LEVEL_LABEL.width[setup.tactics.width]}${positionText}`
}

function causeOf(event: MatchEventLog): string[] {
  if (event.kind === 'PENALTY' && event.detail === 'PENALTY_SCORED') return ['PENALTY']
  if (!event.detail) return ['UNKNOWN']
  return event.detail.split('+')
}

function causeLabel(cause: string): string {
  if (cause === 'BUILD_UP') return '박스 안 공격 전개'
  if (cause === 'BEHIND') return '수비 뒷공간 침투'
  if (cause === 'OPEN_PLAY') return '상대 공격'
  if (cause === 'SET_PIECE') return '세트피스'
  if (cause === 'PENALTY') return '페널티킥'
  return '기록으로 특정할 수 없는 경로'
}

function goalFinding(
  item: Timed<MatchEventLog>,
  side: 'FOR' | 'AGAINST',
  index: number,
  problem: Problem,
  totals: Stats,
  timeline: Timed<Decision>[],
  showHalf: boolean,
): CoachFinding {
  const setup = setupAt(problem, timeline, item.g)
  const causes = causeOf(item.value)
  const labels = causes.map(causeLabel)
  const time = stamp(item.leg, item.tick, showHalf)
  const exact = !causes.includes('UNKNOWN')
  const primary = causes[0]

  let explanation: string
  const evidence = [`득점 시각 ${time}`, `당시 설정: ${setupText(setup)}`]

  if (side === 'FOR') {
    explanation =
      primary === 'BUILD_UP'
        ? '박스 안까지 전진한 뒤 슈팅했고, 그 슛으로 득점했습니다.'
        : '득점은 확인되지만 현재 기록만으로 전개 경로까지 단정할 수 없습니다.'
    evidence.push(`우리 공격 전개 ${totals.homeAttempt}회 중 슈팅 ${totals.homeShot}회`)
    if (primary === 'BUILD_UP') {
      evidence.push(
        `라인을 ${withJosa(LEVEL_LABEL.line[setup.tactics.line], '로으로')} 두면 박스 진입 뒤 슈팅 가능성이 달라지고, 폭을 ${withJosa(
          LEVEL_LABEL.width[setup.tactics.width],
          '로으로',
        )} 두면 전진 횟수가 달라집니다.`,
      )
    }
  } else {
    if (primary === 'BEHIND') {
      explanation =
        '상대가 수비 뒷공간을 찌른 뒤 일대일로 슈팅해 실점했습니다.'
      evidence.push(`경기 전체 배후 침투 허용 ${totals.behind}회`)
      if (setup.tactics.line === 2) {
        evidence.push('라인을 높이면 수비 뒷공간을 더 내줍니다.')
      }
    } else if (primary === 'OPEN_PLAY') {
      explanation =
        '상대가 일반 공격으로 박스 안까지 들어와 슈팅했고, 막지 못했습니다.'
      evidence.push(`상대 공격 전개 ${totals.awayAttempt}회 중 슈팅 ${totals.awayShot}회`)
      if (setup.tactics.width === 2) {
        evidence.push('폭을 넓히면 공격할 길이 늘지만 중앙도 비웁니다.')
      }
    } else if (primary === 'SET_PIECE') {
      explanation =
        '일반 공격이 아니라 세트피스에서 실점했습니다. 같은 위험이 반복됐는지와 당시 라인을 함께 봐야 합니다.'
      evidence.push(`경기 전체 세트피스 위험 ${totals.setPiece}`)
      if (setup.tactics.line === 0) {
        evidence.push('라인을 낮추면 배후 침투는 줄지만 세트피스 위험은 크게 커집니다.')
      }
      const holding = [...setup.orders.values()].filter((order) => order === 'HOLD').length
      evidence.push(`득점 시점 골문 앞 지시 ${holding}명`)
    } else if (primary === 'PENALTY') {
      explanation =
        '박스 안에서 반칙해 페널티킥을 내줬고, 실점했습니다. 당시 압박 강도도 함께 봐야 합니다.'
      evidence.push(`당시 압박 ${LEVEL_LABEL.press[setup.tactics.press]}`)
      if (setup.tactics.press === 2) {
        evidence.push('강하게 압박하면 공을 되찾기 쉬운 대신 파울도 늘어납니다.')
      }
    } else {
      explanation =
        '실점은 확인되지만 현재 경기 기록만으로 배후·오픈플레이·세트피스 중 하나를 확정할 수 없습니다.'
    }
  }

  const repeated =
    side === 'FOR'
      ? totals.homeShot > 1
      : primary === 'BEHIND'
        ? totals.behind > 1
        : primary === 'OPEN_PLAY'
          ? totals.awayShot > 1
          : primary === 'SET_PIECE'
            ? totals.setPiece > 1
            : false

  return {
    id: `${side.toLowerCase()}-${item.g}-${index}`,
    label: side === 'FOR' ? `득점 ${index + 1}` : `실점 ${index + 1}`,
    time,
    title: labels.join(' + '),
    explanation,
    evidence,
    confidence: confidenceOf(evidence, {
      observed: exact,
      repeated,
      unavailable: !exact,
    }),
  }
}

function noGoalFinding(
  side: 'FOR' | 'AGAINST',
  problem: Problem,
  totals: Stats,
): CoachFinding {
  const attack = side === 'FOR'
    ? { attempts: totals.homeAttempt, shots: totals.homeShot }
    : { attempts: totals.awayAttempt, shots: totals.awayShot }
  const shotRate = attack.attempts > 0 ? attack.shots / attack.attempts : 0

  if (side === 'FOR') {
    const evidence = [
      `우리 공격 전개 ${attack.attempts}회 · 슈팅 ${attack.shots}회`,
      `전개→슈팅 전환율 ${(shotRate * 100).toFixed(1)}%`,
      `최종 목표: ${problem.objective.type === 'EQUALIZE' ? '동점 이상' : '리드 유지'}`,
    ]
    return {
      id: 'for-none',
      label: '득점 분석',
      title: totals.homeShot === 0 ? '슈팅까지 연결하지 못했다' : '슈팅은 만들었지만 득점은 없었다',
      explanation:
        totals.homeShot === 0
          ? '공격은 전개했지만 박스 안에서 슈팅하지 못했습니다. 이 기록만 보면 마무리보다 진입 과정부터 살펴야 합니다.'
          : '슈팅 기회는 만들었습니다. 다만 슈팅 위치와 선방 기록이 없어 마무리가 문제였다고 단정할 수 없습니다.',
      evidence,
      confidence: confidenceOf(evidence, {
        observed: true,
        repeated: attack.attempts > 1 || attack.shots > 1,
      }),
    }
  }

  const evidence = [
    `상대 공격 전개 ${attack.attempts}회 · 슈팅 ${attack.shots}회`,
    `세트피스 위험 ${totals.setPiece} · 배후 침투 ${totals.behind}회`,
  ]
  return {
    id: 'against-none',
    label: '수비 분석',
    title: '실점 없이 막아냈다',
    explanation:
      attack.shots === 0
        ? '상대의 공격을 슈팅 이전에 끊었습니다.'
        : '상대에게 슈팅은 내줬지만 실점하지는 않았습니다.',
    evidence,
    confidence: confidenceOf(evidence, {
      observed: true,
      repeated:
        attack.attempts > 1 ||
        attack.shots > 1 ||
        totals.setPiece > 1 ||
        totals.behind > 1,
    }),
  }
}

/** 권장 설정을 완성한 시점. `null` 이면 끝까지 완성하지 못했다 */
interface ReachPoint {
  g: number
  leg: Leg
  tick: number
}

function reachesRecommendation(
  problem: Problem,
  timeline: Timed<Decision>[],
  legs: Leg[],
): ReachPoint | null {
  if (!problem.recommendation) return null
  const matches = (setup: Setup) =>
    setup.formation === problem.recommendation?.formation &&
    setup.tactics.line === problem.recommendation.tactics.line &&
    setup.tactics.press === problem.recommendation.tactics.press &&
    setup.tactics.width === problem.recommendation.tactics.width

  if (matches(setupAt(problem, timeline, -1))) return { g: 0, leg: legs[0], tick: 0 }
  for (const item of timeline) {
    if (matches(setupAt(problem, timeline, item.g))) {
      return { g: item.g, leg: item.leg, tick: item.tick }
    }
  }
  return null
}

/** 결정 한 건을 사람이 읽는 한 줄로 */
function decisionLine(item: Timed<Decision>): string {
  const clock = clockOf(item.tick, item.leg.kickoff)
  const decision = item.value
  if (decision.type === 'FORMATION') return `${clock} 포메이션 → ${decision.value}`
  if (decision.type === 'LINE') return `${clock} 라인 → ${LEVEL_LABEL.line[decision.value]}`
  if (decision.type === 'PRESS') return `${clock} 압박 → ${LEVEL_LABEL.press[decision.value]}`
  if (decision.type === 'WIDTH') return `${clock} 폭 → ${LEVEL_LABEL.width[decision.value]}`
  if (decision.type === 'SUB') {
    return `${clock} 교체 ${numberOf(decision.out)} → ${numberOf(decision.in)}`
  }
  if (decision.type === 'ORDER') {
    return `${clock} ${numberOf(decision.target)} ${ORDER_LABEL[decision.order]}`
  }
  if (decision.type === 'POSITION') {
    return `${clock} ${numberOf(decision.target)} ${decision.position ? '직접 배치' : '기본 자리'}`
  }
  return clock
}

/** 한 반에서 무엇을 몇 번 바꿨는지 */
function categoryText(items: Timed<Decision>[]): string {
  const count = (types: Decision['type'][]) =>
    items.filter((item) => types.includes(item.value.type)).length
  const parts: string[] = []
  const formation = count(['FORMATION'])
  if (formation > 0) parts.push(`포메이션 변경 ${formation}번`)
  const lever = count(['LINE', 'PRESS', 'WIDTH'])
  if (lever > 0) parts.push(`전술 조정 ${lever}번`)
  const sub = count(['SUB'])
  if (sub > 0) parts.push(`교체 ${sub}번`)
  const order = count(['ORDER'])
  if (order > 0) parts.push(`개별 지시 ${order}번`)
  const position = count(['POSITION'])
  if (position > 0) parts.push(`직접 배치 ${position}번`)
  return parts.join(' · ')
}

/** 한 반에서 보여줄 근거 줄 수 상한. 직접 배치는 열한 명까지 나올 수 있다 */
const LINES_PER_HALF = 6

/**
 * 반별 결정 내역.
 *
 * **반이 둘일 때만 만든다.** 후반만 뛴 경기에 "후반 3회"라고만 적힌 카드가
 * 하나 더 붙으면 새로 알려주는 것 없이 화면만 길어진다.
 */
function halfSplitFinding(
  legs: Leg[],
  timeline: Timed<Decision>[],
): CoachFinding | null {
  if (legs.length < 2) return null

  const perLeg = legs.map((leg) => ({
    leg,
    items: timeline.filter((item) => item.leg === leg),
  }))

  const evidence: string[] = []
  for (const { leg, items } of perLeg) {
    const name = halfLabel(leg.half)
    if (items.length === 0) {
      evidence.push(`${name} · 개입 없음`)
      continue
    }
    for (const item of items.slice(0, LINES_PER_HALF)) {
      evidence.push(`${name} · ${decisionLine(item)}`)
    }
    if (items.length > LINES_PER_HALF) {
      evidence.push(`${name} · 외 ${items.length - LINES_PER_HALF}회`)
    }
  }

  const finding = {
    id: 'decision-halves',
    label: '반별 결정',
    title: perLeg.map(({ leg, items }) => `${halfLabel(leg.half)} ${items.length}회`).join(' · '),
    explanation: perLeg
      .map(({ leg, items }) =>
        items.length > 0
          ? `${halfLabel(leg.half)}에 내린 결정은 ${categoryText(items)}입니다.`
          : `${halfLabel(leg.half)}에는 개입하지 않았습니다.`,
      )
      .join(' '),
    evidence,
  }
  return {
    ...finding,
    confidence: confidenceOf(evidence, {
      observed: true,
      repeated: timeline.length > 1,
    }),
  }
}

function decisionFindings(
  problem: Problem,
  final: MatchState,
  legs: Leg[],
  timeline: Timed<Decision>[],
  metrics: CoachMetrics,
  showHalf: boolean,
): CoachFinding[] {
  const result: CoachFinding[] = []
  const first = timeline[0]
  const totalTicks = legs.length * TOTAL_TICKS

  const impactEvidence = [
    `무개입 ${percent(metrics.noopRate)} · 직접 판단 ${percent(metrics.userRate)}`,
    `권장 전술 ${percent(metrics.recommendationRate)}`,
    ...(showHalf ? ['비교 150판도 사용자와 같이 전반·후반 두 반을 이어서 돌렸습니다.'] : []),
  ]
  result.push({
    id: 'decision-impact',
    label: '판단의 영향',
    title:
      metrics.userDelta >= 0.04
        ? '방치보다 성공 가능성을 분명히 높였다'
        : metrics.userDelta <= -0.04
          ? '방치보다 위험한 선택이었다'
          : '방치와 통계적으로 큰 차이가 없었다',
    explanation: `같은 150판을 다시 돌려 한 경기의 운을 걷어냈습니다. 직접 내린 판단과 방치의 성공 가능성 차이는 ${point(
      metrics.userDelta,
    )}였습니다.`,
    evidence: impactEvidence,
    confidence: confidenceOf(impactEvidence, { repeated: true, compared: true }),
  })

  const noop = metrics.profiles.noop
  const user = metrics.profiles.user
  const concededDelta = user.goalsAgainst - noop.goalsAgainst
  const scoredDelta = user.goalsFor - noop.goalsFor
  const channelEvidence = [
    `평균 득점 ${noop.goalsFor.toFixed(2)}→${user.goalsFor.toFixed(2)} · 평균 실점 ${noop.goalsAgainst.toFixed(2)}→${user.goalsAgainst.toFixed(2)}`,
    `세트피스 위험 ${noop.setPiece.toFixed(1)}→${user.setPiece.toFixed(1)} · 배후 침투 ${noop.behind.toFixed(1)}→${user.behind.toFixed(1)}`,
    `우리 슈팅 ${noop.homeShot.toFixed(1)}→${user.homeShot.toFixed(1)} · 상대 슈팅 ${noop.awayShot.toFixed(1)}→${user.awayShot.toFixed(1)}`,
  ]
  result.push({
    id: 'decision-channels',
    label: '150판 비교',
    title:
      Math.abs(concededDelta) >= Math.abs(scoredDelta)
        ? concededDelta < -0.03
          ? '실점 위험을 줄였다'
          : concededDelta > 0.03
            ? '실점 위험을 키웠다'
            : '평균 실점은 방치와 비슷했다'
        : scoredDelta > 0.03
          ? '평균 득점을 높였다'
          : scoredDelta < -0.03
            ? '평균 득점을 낮췄다'
            : '평균 득점은 방치와 비슷했다',
    explanation:
      '같은 150판에서 성공 여부와 평균 득실, 위험 장면을 함께 비교했습니다.',
    evidence: channelEvidence,
    confidence: confidenceOf(channelEvidence, { repeated: true, compared: true }),
  })

  if (!first) {
    const evidence = ['포메이션·레버·교체·개별 지시 변경 0회']
    result.push({
      id: 'decision-none',
      label: '결정 시점',
      title: showHalf
        ? '전반과 후반 모두 전술 개입이 없었다'
        : '경기 중 전술 개입이 없었다',
      explanation:
        '앞 감독이 남긴 설정을 그대로 뒀습니다. 따로 내린 판단이 없어 경기 결과와 판단을 나눠 평가할 수 없습니다.',
      evidence,
      confidence: confidenceOf(evidence, { observed: true }),
    })
  } else {
    const last = timeline[timeline.length - 1]
    const firstTime = stamp(first.leg, first.tick, showHalf)
    const lastTime = stamp(last.leg, last.tick, showHalf)
    const evidence = [`첫 결정 ${firstTime} · 마지막 결정 ${lastTime}`]
    result.push({
      id: 'decision-timing',
      label: '결정 시점',
      time: firstTime,
      title: `${firstTime}에 첫 개입, 총 ${timeline.length}회 결정`,
      explanation:
        first.g <= totalTicks * 0.2
          ? '초반에 방향을 정해 바꾼 전술을 시험할 시간을 충분히 벌었습니다.'
          : '경기 중반이 지나서야 처음 바꿨습니다. 같은 선택도 늦게 내리면 효과를 낼 시간이 줄어듭니다.',
      evidence,
      confidence: confidenceOf(evidence, {
        observed: true,
        repeated: timeline.length > 1,
      }),
    })
  }

  const halves = halfSplitFinding(legs, timeline)
  if (halves) result.push(halves)

  const reached = reachesRecommendation(problem, timeline, legs)
  const finalSetup = setupAt(problem, timeline, totalTicks)
  if (reached !== null) {
    const reachedTime = stamp(reached.leg, reached.tick, showHalf)
    const evidence = [
      `도달 설정: ${setupText(setupAt(problem, timeline, reached.g))}`,
      '같은 국면을 1,200번 검증해 고른 권장안과 비교했습니다.',
    ]
    result.push({
      id: 'decision-recommendation',
      label: '권장안 적용',
      time: reachedTime,
      title: `${reachedTime}에 검증된 권장 설정을 모두 맞췄다`,
      explanation:
        '권장 포메이션과 라인·압박·폭을 모두 맞췄습니다.',
      evidence,
      confidence: confidenceOf(evidence, { observed: true, compared: true }),
    })
  } else if (problem.recommendation) {
    const differences: string[] = []
    if (finalSetup.formation !== problem.recommendation.formation) {
      differences.push(`포메이션 ${finalSetup.formation}→${problem.recommendation.formation}`)
    }
    if (finalSetup.tactics.line !== problem.recommendation.tactics.line) {
      differences.push(
        `라인 ${LEVEL_LABEL.line[finalSetup.tactics.line]}→${
          LEVEL_LABEL.line[problem.recommendation.tactics.line]
        }`,
      )
    }
    if (finalSetup.tactics.press !== problem.recommendation.tactics.press) {
      differences.push(
        `압박 ${LEVEL_LABEL.press[finalSetup.tactics.press]}→${
          LEVEL_LABEL.press[problem.recommendation.tactics.press]
        }`,
      )
    }
    if (finalSetup.tactics.width !== problem.recommendation.tactics.width) {
      differences.push(
        `폭 ${LEVEL_LABEL.width[finalSetup.tactics.width]}→${
          LEVEL_LABEL.width[problem.recommendation.tactics.width]
        }`,
      )
    }
    const evidence = [
      `종료 설정: ${setupText(finalSetup)}`,
      `권장 설정: ${problem.recommendation.formation} · 라인 ${
        LEVEL_LABEL.line[problem.recommendation.tactics.line]
      } · 압박 ${LEVEL_LABEL.press[problem.recommendation.tactics.press]} · 폭 ${
        LEVEL_LABEL.width[problem.recommendation.tactics.width]
      }`,
    ]
    result.push({
      id: 'decision-recommendation',
      label: '권장안 비교',
      title: `검증된 권장안과 ${differences.length}개 항목이 달랐다`,
      explanation: differences.join(' · '),
      evidence,
      confidence: confidenceOf(evidence, { observed: true, compared: true }),
    })
  }

  const personnel = timeline.filter(
    (item) =>
      item.value.type === 'SUB' ||
      item.value.type === 'ORDER' ||
      item.value.type === 'POSITION',
  )
  if (personnel.length > 0) {
    const perHalf = showHalf
      ? [
          `반별 ${legs
            .map(
              (leg) =>
                `${halfLabel(leg.half)} ${personnel.filter((item) => item.leg === leg).length}회`,
            )
            .join(' · ')}`,
        ]
      : []
    const evidence = [
      ...perHalf,
      `종료 인원 우리 ${final.homeCount}명 · 상대 ${final.awayCount}명`,
      `남은 교체 카드 ${final.subsLeft}장`,
    ]
    result.push({
      id: 'decision-personnel',
      label: '선수 개입',
      title: `교체·개별 지시·직접 배치 ${personnel.length}회`,
      explanation:
        '교체와 지시, 직접 배치를 내린 시점 그대로 150판에 다시 적용했습니다.',
      evidence,
      confidence: confidenceOf(evidence, {
        observed: true,
        repeated: personnel.length > 1,
      }),
    })
  }

  return result
}

/** 골 장면 하나와 그것이 경기 전체에서 몇 번째 틱인지 */
interface RankedFinding {
  g: number
  finding: CoachFinding
}

function turningPointOf(
  goals: RankedFinding[],
  decisionReview: CoachFinding[],
): CoachFinding {
  if (goals.length > 0) {
    const last = [...goals].sort((a, b) => a.g - b.g)[goals.length - 1].finding
    return {
      ...last,
      id: 'turning-point',
      label: '경기의 전환점',
      title: `${last.time} · ${last.title}`,
    }
  }

  const timing = decisionReview.find((finding) => finding.id === 'decision-timing')
  if (timing) return { ...timing, id: 'turning-point', label: '경기의 전환점' }

  const evidence = ['경기 기록에 득점·실점 없음']
  return {
    id: 'turning-point',
    label: '경기의 전환점',
    title: '점수가 바뀐 장면은 없었다',
    explanation:
      '골·퇴장·부상처럼 흐름을 단번에 바꾼 장면은 없었습니다. 한 장면보다 경기 전체의 슈팅과 위험 장면을 봐야 합니다.',
    evidence,
    confidence: confidenceOf(evidence, { observed: true }),
  }
}

function prescriptionsOf(
  problem: Problem,
  timeline: Timed<Decision>[],
  legs: Leg[],
  goalsAgainst: CoachFinding[],
  showHalf: boolean,
): string[] {
  if (!problem.recommendation) return ['현재 국면에는 검증된 권장 전술이 없습니다.']
  const recommendation = problem.recommendation
  const items = [
    `킥오프 직후 ${recommendation.formation}, 라인 ${
      LEVEL_LABEL.line[recommendation.tactics.line]
    }, 압박 ${LEVEL_LABEL.press[recommendation.tactics.press]}, 폭 ${withJosa(
      LEVEL_LABEL.width[recommendation.tactics.width],
      '로으로',
    )} 시작하세요.`,
  ]

  const reached = reachesRecommendation(problem, timeline, legs)
  const totalTicks = legs.length * TOTAL_TICKS
  if (reached === null) {
    items.push('네 항목을 따로 늦게 바꾸지 말고 초반에 한 번에 맞춰 효과를 낼 시간을 확보하세요.')
  } else if (reached.g > totalTicks * 0.2) {
    items.push(
      `${stamp(reached.leg, reached.tick, showHalf)}에 완성한 권장 설정을 다음에는 킥오프 직후부터 적용하세요.`,
    )
  }

  const firstAgainst = goalsAgainst.find((finding) => finding.id !== 'against-none')
  if (firstAgainst) {
    items.push(
      `${firstAgainst.time}의 ${firstAgainst.title} 실점을 반복하지 않도록 당시 설정과 권장안을 먼저 비교하세요.`,
    )
  } else {
    items.push(recommendation.explanation)
  }

  return items.slice(0, 3)
}

/** 그 반의 골만 골라 경기 전체 시간축에 얹는다 */
function goalEventsOf(leg: Leg, index: number): {
  forUs: Timed<MatchEventLog>[]
  against: Timed<MatchEventLog>[]
} {
  const at = (event: MatchEventLog): Timed<MatchEventLog> => ({
    g: index * TOTAL_TICKS + event.tick,
    leg,
    tick: event.tick,
    value: event,
  })

  return {
    forUs: leg.final.log.filter((event) => event.kind === 'GOAL').map(at),
    against: leg.final.log.flatMap((event) => {
      if (event.kind === 'PENALTY' && event.detail === 'PENALTY_SCORED') return [at(event)]
      if (event.kind !== 'CONCEDE') return []
      // 한 틱에 두 채널이 동시에 득점하면 점수도 두 골 오른다. 기존 로그는
      // 한 줄이므로 분석 단계에서 원인별 골로 다시 펼친다.
      return causeOf(event).map((cause) => at({ ...event, detail: cause }))
    }),
  }
}

export function buildCoachReport(
  problem: Problem,
  final: MatchState,
  decisions: Decision[],
  metrics: CoachMetrics,
  kickoff: number,
  /**
   * 전반 기록. 사용자가 전반부터 뛴 경기에서만 넘어온다.
   *
   * 없으면 예전과 완전히 같은 한 반짜리 보고서가 나온다.
   */
  firstHalf: CoachFirstHalf | null = null,
): CoachReport {
  const sorted = (list: Decision[]) => [...list].sort((a, b) => a.tick - b.tick)
  const legs: Leg[] = firstHalf
    ? [
        // 전반이 재개하는 분은 국면이 아니라 반이 정한다. 숫자는 matchClock 만 안다
        {
          half: 1,
          kickoff: kickoffMinute(1),
          decisions: sorted(firstHalf.decisions),
          final: firstHalf.final,
        },
        { half: 2, kickoff, decisions: sorted(decisions), final },
      ]
    : [{ half: 2, kickoff, decisions: sorted(decisions), final }]
  const showHalf = legs.length > 1

  const timeline: Timed<Decision>[] = legs.flatMap((leg, index) =>
    leg.decisions.map((decision) => ({
      g: index * TOTAL_TICKS + decision.tick,
      leg,
      tick: decision.tick,
      value: decision,
    })),
  )

  const totals = sumStats(legs)
  const goalEvents = legs.map((leg, index) => goalEventsOf(leg, index))
  const forEvents = goalEvents.flatMap((set) => set.forUs)
  const againstEvents = goalEvents.flatMap((set) => set.against)

  const rankedFor: RankedFinding[] = forEvents.map((item, index) => ({
    g: item.g,
    finding: goalFinding(item, 'FOR', index, problem, totals, timeline, showHalf),
  }))
  const rankedAgainst: RankedFinding[] = againstEvents.map((item, index) => ({
    g: item.g,
    finding: goalFinding(item, 'AGAINST', index, problem, totals, timeline, showHalf),
  }))

  const goalsFor =
    rankedFor.length > 0
      ? rankedFor.map((ranked) => ranked.finding)
      : [noGoalFinding('FOR', problem, totals)]
  const goalsAgainst =
    rankedAgainst.length > 0
      ? rankedAgainst.map((ranked) => ranked.finding)
      : [noGoalFinding('AGAINST', problem, totals)]
  const decisionReview = decisionFindings(problem, final, legs, timeline, metrics, showHalf)

  const resultWord =
    problem.objective.type === 'SURVIVE'
      ? final.score[0] > final.score[1]
        ? '리드를 지켰습니다'
        : '리드를 지키지 못했습니다'
      : final.score[0] >= final.score[1]
        ? '동점 이상을 만들었습니다'
        : '따라잡지 못했습니다'
  const judgmentWord =
    metrics.userDelta >= 0.04
      ? '다만 판단 자체는 방치보다 나았습니다.'
      : metrics.userDelta <= -0.04
        ? '결과와 별개로 판단은 방치보다 위험했습니다.'
        : '판단은 방치와 통계적으로 비슷했습니다.'

  // 반별 득점·실점. 점수는 후반으로 이어지므로 하프타임 점수로 갈라야 한다
  const scored = final.score[0] - problem.score[0]
  const conceded = final.score[1] - problem.score[1]
  const splitFor = firstHalf
    ? ` (전반 ${firstHalf.final.score[0] - problem.score[0]} · 후반 ${
        final.score[0] - firstHalf.final.score[0]
      })`
    : ''
  const splitAgainst = firstHalf
    ? ` (전반 ${firstHalf.final.score[1] - problem.score[1]} · 후반 ${
        final.score[1] - firstHalf.final.score[1]
      })`
    : ''

  return {
    headline: `${final.score[0]}-${final.score[1]}, ${resultWord} ${judgmentWord}`,
    summary: [
      `우리 공격 ${totals.homeAttempt}회 → 슈팅 ${totals.homeShot}회 → 득점 ${scored}골${splitFor}`,
      `상대 공격 ${totals.awayAttempt}회 → 슈팅 ${totals.awayShot}회 → 실점 ${conceded}골${splitAgainst}`,
      `세트피스 위험 ${totals.setPiece} · 배후 침투 ${totals.behind}회`,
      `직접 내린 판단 ${percent(metrics.userRate)} · 방치 대비 ${point(metrics.userDelta)}`,
      `권장 전술 성공 가능성 ${percent(metrics.recommendationRate)}${foeNote(final.opponentTeam)}`,
    ],
    turningPoint: turningPointOf([...rankedFor, ...rankedAgainst], decisionReview),
    goalsFor,
    goalsAgainst,
    decisionReview,
    prescriptions: prescriptionsOf(problem, timeline, legs, goalsAgainst, showHalf),
  }
}
