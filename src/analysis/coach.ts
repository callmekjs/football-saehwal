import { TOTAL_TICKS } from '../sim/constants'
import type { FormationId } from '../sim/formations'
import type {
  Decision,
  Level,
  MatchEventLog,
  MatchState,
  PlayerOrder,
  Problem,
  Tactics,
} from '../sim/types'

export type Confidence = '높음' | '보통' | '낮음'

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

interface Setup {
  formation: FormationId
  tactics: Tactics
  orders: Map<string, PlayerOrder>
}

const LEVEL_LABEL: Record<'line' | 'press' | 'width', Record<Level, string>> = {
  line: { 0: '낮음', 1: '보통', 2: '높음' },
  press: { 0: '약', 1: '중', 2: '강' },
  width: { 0: '좁게', 1: '보통', 2: '넓게' },
}

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`
const point = (rate: number) => `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(1)}%p`

function clockOf(tick: number, kickoff: number): string {
  const totalSeconds = Math.round((kickoff + (tick / TOTAL_TICKS) * 15) * 60)
  const minute = Math.floor(totalSeconds / 60)
  const second = totalSeconds % 60
  return `${minute}:${String(second).padStart(2, '0')}`
}

function setupAt(problem: Problem, decisions: Decision[], tick: number): Setup {
  const setup: Setup = {
    formation: problem.initialFormation,
    tactics: { ...problem.initialTactics },
    orders: new Map(),
  }

  for (const decision of decisions) {
    if (decision.tick > tick) break
    if (decision.type === 'FORMATION') setup.formation = decision.value
    else if (decision.type === 'LINE') setup.tactics.line = decision.value
    else if (decision.type === 'PRESS') setup.tactics.press = decision.value
    else if (decision.type === 'WIDTH') setup.tactics.width = decision.value
    else if (decision.type === 'ORDER') setup.orders.set(decision.target, decision.order)
  }
  return setup
}

function setupText(setup: Setup): string {
  return `${setup.formation} · 라인 ${LEVEL_LABEL.line[setup.tactics.line]} · 압박 ${
    LEVEL_LABEL.press[setup.tactics.press]
  } · 폭 ${LEVEL_LABEL.width[setup.tactics.width]}`
}

function causeOf(event: MatchEventLog): string[] {
  if (event.kind === 'PENALTY' && event.detail === 'PENALTY_SCORED') return ['PENALTY']
  if (!event.detail) return ['UNKNOWN']
  return event.detail.split('+')
}

function causeLabel(cause: string): string {
  if (cause === 'BUILD_UP') return '박스 안 공격 전개'
  if (cause === 'BEHIND') return '수비 뒷공간 침투'
  if (cause === 'OPEN_PLAY') return '상대 오픈플레이'
  if (cause === 'SET_PIECE') return '세트피스'
  if (cause === 'PENALTY') return '페널티킥'
  return '기록으로 특정할 수 없는 경로'
}

function goalFinding(
  event: MatchEventLog,
  side: 'FOR' | 'AGAINST',
  index: number,
  problem: Problem,
  final: MatchState,
  decisions: Decision[],
  kickoff: number,
): CoachFinding {
  const setup = setupAt(problem, decisions, event.tick)
  const causes = causeOf(event)
  const labels = causes.map(causeLabel)
  const time = clockOf(event.tick, kickoff)
  const exact = !causes.includes('UNKNOWN')
  const primary = causes[0]

  let explanation: string
  const evidence = [`득점 시각 ${time}`, `당시 설정: ${setupText(setup)}`]

  if (side === 'FOR') {
    explanation =
      primary === 'BUILD_UP'
        ? '전진 시도가 박스 안 슈팅으로 이어졌고, 그 슈팅이 득점으로 완성됐습니다.'
        : '득점은 확인되지만 현재 기록만으로 전개 경로까지 단정할 수 없습니다.'
    evidence.push(
      `우리 공격 전개 ${final.stats.homeAttempt}회 중 슈팅 ${final.stats.homeShot}회`,
    )
    if (primary === 'BUILD_UP') {
      evidence.push(
        `라인 ${LEVEL_LABEL.line[setup.tactics.line]}은 박스 진입 뒤 슈팅 가치에, 폭 ${
          LEVEL_LABEL.width[setup.tactics.width]
        }은 전진 시도 수에 영향을 줬습니다.`,
      )
    }
  } else {
    if (primary === 'BEHIND') {
      explanation =
        '상대가 수비 뒷공간을 찌른 뒤 일대일 슈팅까지 연결해 실점했습니다.'
      evidence.push(`경기 전체 배후 침투 허용 ${final.stats.behind}회`)
      if (setup.tactics.line === 2) {
        evidence.push('높은 수비라인은 이 시뮬레이션에서 배후 침투 위험을 직접 키웁니다.')
      }
    } else if (primary === 'OPEN_PLAY') {
      explanation =
        '상대의 일반 공격이 박스 안 슈팅으로 이어졌고, 그 슈팅을 막지 못했습니다.'
      evidence.push(
        `상대 공격 전개 ${final.stats.awayAttempt}회 중 슈팅 ${final.stats.awayShot}회`,
      )
      if (setup.tactics.width === 2) {
        evidence.push('넓은 수비 폭은 공격 통로를 늘리는 대신 중앙 공간을 내주는 대가가 있습니다.')
      }
    } else if (primary === 'SET_PIECE') {
      explanation =
        '오픈플레이가 아니라 세트피스에서 실점했습니다. 반복 허용 여부와 당시 라인을 함께 봐야 합니다.'
      evidence.push(`경기 전체 세트피스 허용 ${final.stats.setPiece}회`)
      if (setup.tactics.line === 0) {
        evidence.push('낮은 라인은 배후를 줄이지만 세트피스 허용 빈도를 크게 높입니다.')
      }
      const holding = [...setup.orders.values()].filter((order) => order === 'HOLD').length
      evidence.push(`득점 시점 골문 앞 지시 ${holding}명`)
    } else if (primary === 'PENALTY') {
      explanation =
        '박스 안 반칙으로 내준 페널티킥이 실점으로 이어졌습니다. 당시 압박 강도를 함께 봐야 합니다.'
      evidence.push(`당시 압박 ${LEVEL_LABEL.press[setup.tactics.press]}`)
      if (setup.tactics.press === 2) {
        evidence.push('강한 압박은 공을 되찾을 가능성과 함께 파울 빈도도 높입니다.')
      }
    } else {
      explanation =
        '실점은 확인되지만 현재 경기 기록만으로 배후·오픈플레이·세트피스 중 하나를 확정할 수 없습니다.'
    }
  }

  return {
    id: `${side.toLowerCase()}-${event.tick}-${index}`,
    label: side === 'FOR' ? `득점 ${index + 1}` : `실점 ${index + 1}`,
    time,
    title: labels.join(' + '),
    explanation,
    evidence,
    confidence: exact ? '높음' : '낮음',
  }
}

function noGoalFinding(
  side: 'FOR' | 'AGAINST',
  problem: Problem,
  final: MatchState,
): CoachFinding {
  const attack = side === 'FOR'
    ? { attempts: final.stats.homeAttempt, shots: final.stats.homeShot }
    : { attempts: final.stats.awayAttempt, shots: final.stats.awayShot }
  const shotRate = attack.attempts > 0 ? attack.shots / attack.attempts : 0

  if (side === 'FOR') {
    return {
      id: 'for-none',
      label: '득점 분석',
      title: final.stats.homeShot === 0 ? '슈팅까지 연결하지 못했다' : '슈팅은 만들었지만 득점은 없었다',
      explanation:
        final.stats.homeShot === 0
          ? '공격 전개는 있었지만 박스 안 슈팅으로 이어지지 않았습니다. 기록상 결정력보다 진입 과정이 먼저 문제입니다.'
          : '슈팅 기회는 만들었습니다. 다만 현재 기록에는 슈팅 위치·선방 정보가 없어 결정력 문제라고 단정하지 않습니다.',
      evidence: [
        `우리 공격 전개 ${attack.attempts}회 · 슈팅 ${attack.shots}회`,
        `전개→슈팅 전환율 ${(shotRate * 100).toFixed(1)}%`,
        `최종 목표: ${problem.objective.type === 'EQUALIZE' ? '동점 이상' : '리드 유지'}`,
      ],
      confidence: final.stats.homeShot === 0 ? '높음' : '보통',
    }
  }

  return {
    id: 'against-none',
    label: '수비 분석',
    title: '실점 없이 막아냈다',
    explanation:
      attack.shots === 0
        ? '상대의 공격을 슈팅 이전에 끊었습니다.'
        : '상대에게 슈팅은 허용했지만 실제 실점으로 이어지지는 않았습니다.',
    evidence: [
      `상대 공격 전개 ${attack.attempts}회 · 슈팅 ${attack.shots}회`,
      `세트피스 허용 ${final.stats.setPiece}회 · 배후 침투 ${final.stats.behind}회`,
    ],
    confidence: '높음',
  }
}

function reachesRecommendation(problem: Problem, decisions: Decision[]): number | null {
  if (!problem.recommendation) return null
  const matches = (setup: Setup) =>
    setup.formation === problem.recommendation?.formation &&
    setup.tactics.line === problem.recommendation.tactics.line &&
    setup.tactics.press === problem.recommendation.tactics.press &&
    setup.tactics.width === problem.recommendation.tactics.width

  if (matches(setupAt(problem, decisions, -1))) return 0
  for (const decision of decisions) {
    if (matches(setupAt(problem, decisions, decision.tick))) return decision.tick
  }
  return null
}

function decisionFindings(
  problem: Problem,
  final: MatchState,
  decisions: Decision[],
  metrics: CoachMetrics,
  kickoff: number,
): CoachFinding[] {
  const result: CoachFinding[] = []
  const first = decisions[0]

  result.push({
    id: 'decision-impact',
    label: '판단의 영향',
    title:
      metrics.userDelta >= 0.04
        ? '방치보다 성공 가능성을 분명히 높였다'
        : metrics.userDelta <= -0.04
          ? '방치보다 위험한 선택이었다'
          : '방치와 통계적으로 큰 차이가 없었다',
    explanation: `한 경기의 점수와 별개로 같은 150개 시드를 다시 적용한 결과, 사용자 판단은 방치 대비 ${point(
      metrics.userDelta,
    )}였습니다.`,
    evidence: [
      `무개입 ${percent(metrics.noopRate)} · 사용자 ${percent(metrics.userRate)}`,
      `권장 전술 ${percent(metrics.recommendationRate)}`,
    ],
    confidence: '높음',
  })

  const noop = metrics.profiles.noop
  const user = metrics.profiles.user
  const concededDelta = user.goalsAgainst - noop.goalsAgainst
  const scoredDelta = user.goalsFor - noop.goalsFor
  result.push({
    id: 'decision-channels',
    label: '150경기 양상',
    title:
      Math.abs(concededDelta) >= Math.abs(scoredDelta)
        ? concededDelta < -0.03
          ? '실점 위험을 줄이는 방향으로 작동했다'
          : concededDelta > 0.03
            ? '실점 위험을 키우는 방향으로 작동했다'
            : '평균 실점은 방치와 비슷했다'
        : scoredDelta > 0.03
          ? '득점 생산을 늘리는 방향으로 작동했다'
          : scoredDelta < -0.03
            ? '득점 생산을 줄이는 방향으로 작동했다'
            : '평균 득점은 방치와 비슷했다',
    explanation:
      '같은 시드 150개에서 성공 여부뿐 아니라 득점·실점과 위험 채널의 평균도 함께 비교했습니다.',
    evidence: [
      `평균 득점 ${noop.goalsFor.toFixed(2)}→${user.goalsFor.toFixed(2)} · 평균 실점 ${noop.goalsAgainst.toFixed(2)}→${user.goalsAgainst.toFixed(2)}`,
      `세트피스 허용 ${noop.setPiece.toFixed(1)}→${user.setPiece.toFixed(1)} · 배후 침투 ${noop.behind.toFixed(1)}→${user.behind.toFixed(1)}`,
      `우리 슈팅 ${noop.homeShot.toFixed(1)}→${user.homeShot.toFixed(1)} · 상대 슈팅 ${noop.awayShot.toFixed(1)}→${user.awayShot.toFixed(1)}`,
    ],
    confidence: '높음',
  })

  if (!first) {
    result.push({
      id: 'decision-none',
      label: '결정 시점',
      title: '경기 중 전술 개입이 없었다',
      explanation:
        '앞 감독에게서 물려받은 설정을 그대로 유지했습니다. 이번 경기에서는 결과와 사용자의 판단을 구분할 근거가 없습니다.',
      evidence: ['포메이션·레버·교체·개별 지시 변경 0회'],
      confidence: '높음',
    })
  } else {
    const firstTime = clockOf(first.tick, kickoff)
    const lastTime = clockOf(decisions[decisions.length - 1].tick, kickoff)
    result.push({
      id: 'decision-timing',
      label: '결정 시점',
      time: firstTime,
      title: `${firstTime}에 첫 개입, 총 ${decisions.length}회 결정`,
      explanation:
        first.tick <= TOTAL_TICKS * 0.2
          ? '초반에 방향을 정했습니다. 전술이 작동할 시간을 충분히 확보한 선택입니다.'
          : '첫 개입이 경기 중반 이후였습니다. 같은 선택도 늦게 내리면 영향을 줄 시간이 줄어듭니다.',
      evidence: [`첫 결정 ${firstTime} · 마지막 결정 ${lastTime}`],
      confidence: '높음',
    })
  }

  const reached = reachesRecommendation(problem, decisions)
  const finalSetup = setupAt(problem, decisions, TOTAL_TICKS)
  if (reached !== null) {
    result.push({
      id: 'decision-recommendation',
      label: '권장안 도달',
      time: clockOf(reached, kickoff),
      title: `${clockOf(reached, kickoff)}에 검증된 권장 설정을 완성했다`,
      explanation:
        '포메이션·라인·압박·폭 네 항목이 1200시드 검증의 국면별 권장안과 모두 일치했습니다.',
      evidence: [`도달 설정: ${setupText(finalSetup)}`],
      confidence: '높음',
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
    result.push({
      id: 'decision-recommendation',
      label: '권장안 비교',
      title: `검증된 권장안과 ${differences.length}개 항목이 달랐다`,
      explanation: differences.join(' · '),
      evidence: [`종료 설정: ${setupText(finalSetup)}`],
      confidence: '높음',
    })
  }

  const personnel = decisions.filter(
    (decision) => decision.type === 'SUB' || decision.type === 'ORDER',
  )
  if (personnel.length > 0) {
    result.push({
      id: 'decision-personnel',
      label: '선수 개입',
      title: `교체·개별 지시 ${personnel.length}회`,
      explanation:
        '선수 단위 개입은 적용 시점까지 기록해 150판 비교에 그대로 재현했습니다.',
      evidence: [
        `종료 인원 우리 ${final.homeCount}명 · 상대 ${final.awayCount}명`,
        `남은 교체 카드 ${final.subsLeft}장`,
      ],
      confidence: '높음',
    })
  }

  return result
}

function turningPointOf(
  goalsFor: CoachFinding[],
  goalsAgainst: CoachFinding[],
  decisionReview: CoachFinding[],
): CoachFinding {
  const goalFindings = [...goalsFor, ...goalsAgainst]
    .filter((finding) => finding.time)
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  if (goalFindings.length > 0) {
    const last = goalFindings[goalFindings.length - 1]
    return {
      ...last,
      id: 'turning-point',
      label: '경기의 전환점',
      title: `${last.time} · ${last.title}`,
    }
  }

  const timing = decisionReview.find((finding) => finding.id === 'decision-timing')
  if (timing) return { ...timing, id: 'turning-point', label: '경기의 전환점' }

  return {
    id: 'turning-point',
    label: '경기의 전환점',
    title: '점수를 바꾼 단일 사건은 없었다',
    explanation:
      '골·퇴장·부상 같은 명확한 전환점이 없었습니다. 이 경우에는 한 장면보다 경기 전체의 슈팅과 위험 허용을 봐야 합니다.',
    evidence: ['경기 이벤트 로그에 득점·실점 없음'],
    confidence: '높음',
  }
}

function prescriptionsOf(
  problem: Problem,
  decisions: Decision[],
  goalsAgainst: CoachFinding[],
  kickoff: number,
): string[] {
  if (!problem.recommendation) return ['현재 국면에는 검증된 권장 전술이 없습니다.']
  const recommendation = problem.recommendation
  const items = [
    `킥오프 직후 ${recommendation.formation}, 라인 ${
      LEVEL_LABEL.line[recommendation.tactics.line]
    }, 압박 ${LEVEL_LABEL.press[recommendation.tactics.press]}, 폭 ${
      LEVEL_LABEL.width[recommendation.tactics.width]
    }로 시작하세요.`,
  ]

  const reached = reachesRecommendation(problem, decisions)
  if (reached === null) {
    items.push('네 항목을 따로 늦게 맞추지 말고 초반에 한 번에 완성해 전술이 작동할 시간을 확보하세요.')
  } else if (reached > TOTAL_TICKS * 0.2) {
    items.push(
      `${clockOf(reached, kickoff)}에 완성한 권장 설정을 다음에는 킥오프 직후부터 적용하세요.`,
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

export function buildCoachReport(
  problem: Problem,
  final: MatchState,
  decisions: Decision[],
  metrics: CoachMetrics,
  kickoff: number,
): CoachReport {
  const orderedDecisions = [...decisions].sort((a, b) => a.tick - b.tick)
  const goalForEvents = final.log.filter((event) => event.kind === 'GOAL')
  const goalAgainstEvents = final.log.flatMap((event) => {
    if (event.kind === 'PENALTY' && event.detail === 'PENALTY_SCORED') return [event]
    if (event.kind !== 'CONCEDE') return []
    const causes = causeOf(event)
    // 한 틱에 두 채널이 동시에 득점하면 점수도 두 골 오른다. 기존 로그는
    // 한 줄이므로 분석 단계에서 원인별 골로 다시 펼친다.
    return causes.map((cause) => ({ ...event, detail: cause }))
  })

  const goalsFor =
    goalForEvents.length > 0
      ? goalForEvents.map((event, index) =>
          goalFinding(event, 'FOR', index, problem, final, orderedDecisions, kickoff),
        )
      : [noGoalFinding('FOR', problem, final)]
  const goalsAgainst =
    goalAgainstEvents.length > 0
      ? goalAgainstEvents.map((event, index) =>
          goalFinding(event, 'AGAINST', index, problem, final, orderedDecisions, kickoff),
        )
      : [noGoalFinding('AGAINST', problem, final)]
  const decisionReview = decisionFindings(
    problem,
    final,
    orderedDecisions,
    metrics,
    kickoff,
  )

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

  return {
    headline: `${final.score[0]}-${final.score[1]}, ${resultWord} ${judgmentWord}`,
    summary: [
      `우리 공격 ${final.stats.homeAttempt}회 → 슈팅 ${final.stats.homeShot}회 → 득점 ${
        final.score[0] - problem.score[0]
      }골`,
      `상대 공격 ${final.stats.awayAttempt}회 → 슈팅 ${final.stats.awayShot}회 → 실점 ${
        final.score[1] - problem.score[1]
      }골`,
      `위험 허용: 세트피스 ${final.stats.setPiece}회 · 배후 침투 ${final.stats.behind}회`,
      `사용자 판단 ${percent(metrics.userRate)} · 방치 대비 ${point(metrics.userDelta)}`,
      `권장 전술 성공 가능성 ${percent(metrics.recommendationRate)}`,
    ],
    turningPoint: turningPointOf(goalsFor, goalsAgainst, decisionReview),
    goalsFor,
    goalsAgainst,
    decisionReview,
    prescriptions: prescriptionsOf(problem, orderedDecisions, goalsAgainst, kickoff),
  }
}
