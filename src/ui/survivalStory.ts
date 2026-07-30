import { clockOf, halfLabel, type Half } from '../matchClock'
import { getPlayer } from '../sim/squad'
import type {
  Decision,
  Level,
  MatchEventLog,
  MatchState,
  PlayerOrder,
  Problem,
} from '../sim/types'

export type EvidenceScope = 'ACTUAL_MATCH' | 'SAME_SEED_150'

export interface CrisisFrame {
  source: 'ACTUAL_MATCH'
  title: string
  summary: string
  startScore: [number, number]
  objective: string
  homeCount: number
  awayCount: number
  bookedCount: number
  meanStamina: number
  inheritedSetup: string
  inheritedOrders: number
}

export interface DecisionBeat {
  source: 'ACTUAL_MATCH'
  key: string
  time: string
  items: string[]
}

export type StoryEventKind =
  | 'GOAL'
  | 'CONCEDE'
  | 'PENALTY'
  | 'SEND_OFF'
  | 'INJURY'

export interface StoryEvent {
  source: 'ACTUAL_MATCH'
  key: string
  time: string
  kind: StoryEventKind
  label: string
  score?: [number, number]
  objectiveShift?: 'ENTERED' | 'LEFT'
}

export interface SurvivalStory {
  crisis: CrisisFrame
  response: {
    source: 'ACTUAL_MATCH'
    beats: DecisionBeat[]
  }
  flow: {
    source: 'ACTUAL_MATCH'
    events: StoryEvent[]
    integrity: 'VERIFIED' | 'UNAVAILABLE'
  }
  outcome: {
    source: 'ACTUAL_MATCH'
    finalScore: [number, number]
    passed: boolean
    title: string
  }
}

export interface ActualFirstHalf {
  state: MatchState
  decisions: readonly Decision[]
}

const LEVEL_LABEL: Record<'line' | 'press' | 'width', Record<Level, string>> = {
  line: { 0: '라인 낮음', 1: '라인 보통', 2: '라인 높음' },
  press: { 0: '압박 약', 1: '압박 중', 2: '압박 강' },
  width: { 0: '폭 좁게', 1: '폭 보통', 2: '폭 넓게' },
}

const ORDER_LABEL: Record<PlayerOrder, string> = {
  NONE: '지시 해제',
  HOLD: '골문 앞',
  BACK_OFF: '물러서라',
  CONSERVE: '아껴 뛰어라',
  DROP_BACK: '내려서라',
  PUSH_UP: '올라가라',
}

function playerNumber(id: string): string {
  try {
    return `${getPlayer(id).num}번`
  } catch {
    return id
  }
}

function decisionLabel(decision: Decision): string {
  if (decision.type === 'FORMATION') return `${decision.value} 전환`
  if (decision.type === 'LINE') return LEVEL_LABEL.line[decision.value]
  if (decision.type === 'PRESS') return LEVEL_LABEL.press[decision.value]
  if (decision.type === 'WIDTH') return LEVEL_LABEL.width[decision.value]
  if (decision.type === 'SUB') {
    return `${playerNumber(decision.out)}↔${playerNumber(decision.in)}`
  }
  if (decision.type === 'ORDER') {
    return `${playerNumber(decision.target)} ${ORDER_LABEL[decision.order]}`
  }
  if (decision.type === 'POSITION') {
    return `${playerNumber(decision.target)} ${decision.position ? '직접 배치' : '자리 복귀'}`
  }
  return '감독 결정'
}

function objectiveLabel(problem: Problem): string {
  return problem.objective.type === 'SURVIVE' ? '리드를 지켜라' : '동점 이상을 만들어라'
}

function objectiveMet(score: readonly [number, number], problem: Problem): boolean {
  return problem.objective.type === 'SURVIVE' ? score[0] > score[1] : score[0] >= score[1]
}

function decisionBeat(
  decisions: readonly Decision[],
  half: Half,
  showHalf: boolean,
): DecisionBeat[] {
  const grouped = new Map<number, Decision[]>()
  for (const decision of decisions) {
    const group = grouped.get(decision.tick) ?? []
    group.push(decision)
    grouped.set(decision.tick, group)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tick, items]) => ({
      source: 'ACTUAL_MATCH',
      key: `${half}-${tick}`,
      time: `${showHalf ? `${halfLabel(half)} ` : ''}${clockOf(tick, half)}`,
      items: items.map(decisionLabel),
    }))
}

interface MatchLeg {
  half: Half
  state: MatchState
}

function notable(event: MatchEventLog): event is MatchEventLog & { kind: StoryEventKind } {
  return (
    event.kind === 'GOAL' ||
    event.kind === 'CONCEDE' ||
    event.kind === 'PENALTY' ||
    event.kind === 'SEND_OFF' ||
    event.kind === 'INJURY'
  )
}

function eventLabel(kind: StoryEventKind): string {
  if (kind === 'GOAL') return '우리 득점'
  if (kind === 'CONCEDE') return '상대 득점'
  if (kind === 'PENALTY') return '페널티킥'
  if (kind === 'SEND_OFF') return '퇴장'
  return '부상'
}

function buildEvents(
  problem: Problem,
  startScore: [number, number],
  legs: readonly MatchLeg[],
  finalScore: [number, number],
): SurvivalStory['flow'] {
  const score: [number, number] = [...startScore]
  const events: StoryEvent[] = []
  const showHalf = legs.length > 1

  for (const leg of legs) {
    for (let index = 0; index < leg.state.log.length; index++) {
      const event = leg.state.log[index]
      if (!notable(event)) continue

      const before = objectiveMet(score, problem)
      if (event.kind === 'GOAL') score[0] += 1
      if (event.kind === 'CONCEDE') score[1] += 1
      const after = objectiveMet(score, problem)
      const scoreChanged = event.kind === 'GOAL' || event.kind === 'CONCEDE'

      events.push({
        source: 'ACTUAL_MATCH',
        key: `${leg.half}-${event.tick}-${index}`,
        time: `${showHalf ? `${halfLabel(leg.half)} ` : ''}${clockOf(event.tick, leg.half)}`,
        kind: event.kind,
        label: eventLabel(event.kind),
        ...(scoreChanged ? { score: [...score] as [number, number] } : {}),
        ...(!before && after
          ? { objectiveShift: 'ENTERED' as const }
          : before && !after
            ? { objectiveShift: 'LEFT' as const }
            : {}),
      })
    }
  }

  const verified = score[0] === finalScore[0] && score[1] === finalScore[1]
  return {
    source: 'ACTUAL_MATCH',
    events: verified ? events : [],
    integrity: verified ? 'VERIFIED' : 'UNAVAILABLE',
  }
}

export function buildSurvivalStory({
  problem,
  initialState,
  finalState,
  decisions,
  kickoffHalf,
  firstHalf = null,
  passed,
}: {
  problem: Problem
  initialState: MatchState
  finalState: MatchState
  decisions: readonly Decision[]
  kickoffHalf: Half
  firstHalf?: ActualFirstHalf | null
  passed: boolean
}): SurvivalStory {
  const onPitch = initialState.players.filter((player) => player.onPitch && !player.out)
  const bookedCount = onPitch.filter((player) => player.booked).length
  const inheritedOrders = onPitch.filter((player) => player.order !== 'NONE').length
  const meanStamina =
    onPitch.length === 0
      ? 0
      : onPitch.reduce((sum, player) => sum + player.stamina, 0) / onPitch.length
  const responseBeats = firstHalf
    ? [
        ...decisionBeat(firstHalf.decisions, 1, true),
        ...decisionBeat(decisions, 2, true),
      ]
    : decisionBeat(decisions, kickoffHalf, false)
  const legs: MatchLeg[] = firstHalf
    ? [
        { half: 1, state: firstHalf.state },
        { half: 2, state: finalState },
      ]
    : [{ half: kickoffHalf, state: finalState }]
  const finalScore: [number, number] = [...finalState.score]

  return {
    crisis: {
      source: 'ACTUAL_MATCH',
      title: problem.title,
      summary: problem.summary ?? objectiveLabel(problem),
      startScore: [...initialState.score],
      objective: objectiveLabel(problem),
      homeCount: initialState.homeCount,
      awayCount: initialState.awayCount,
      bookedCount,
      meanStamina,
      inheritedSetup: initialState.formation,
      inheritedOrders,
    },
    response: {
      source: 'ACTUAL_MATCH',
      beats: responseBeats,
    },
    flow: buildEvents(problem, [...initialState.score], legs, finalScore),
    outcome: {
      source: 'ACTUAL_MATCH',
      finalScore,
      passed,
      title: passed ? '상황 타파 성공' : '상황 타파 실패',
    },
  }
}
