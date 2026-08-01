import type { CoachFinding } from '../analysis/coach'
import { SEGMENT_MINUTES, formatMinute, halfLabel, kickoffMinute } from '../matchClock'
import { TOTAL_TICKS } from '../sim/constants'
import { getPlayer } from '../sim/squad'
import type { Decision, Level, PlayerOrder } from '../sim/types'

export type OneMoveKind = 'none' | 'single' | 'representative'
export type OneMoveTone = 'positive' | 'negative' | 'neutral'

export interface OneMoveSummary {
  kind: OneMoveKind
  label: string
  time: string | null
  decision: string
  impactLabel: string
  deltaText: string
  tone: OneMoveTone
  note: string
}

export interface OneMoveDecisionHistory {
  decisions: readonly Decision[]
  kickoff: number
  firstHalf?: readonly Decision[] | null
}

interface ConcreteDecision {
  time: string
  decision: string
}

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

function numberOf(id: string): string {
  try {
    return `${getPlayer(id).num}번`
  } catch {
    return id
  }
}

function decisionText(decision: Decision): string {
  if (decision.type === 'FORMATION') return `포메이션 → ${decision.value}`
  if (decision.type === 'LINE') return `라인 → ${LEVEL_LABEL.line[decision.value]}`
  if (decision.type === 'PRESS') return `압박 → ${LEVEL_LABEL.press[decision.value]}`
  if (decision.type === 'WIDTH') return `폭 → ${LEVEL_LABEL.width[decision.value]}`
  if (decision.type === 'SUB') {
    return `교체 ${numberOf(decision.out)} → ${numberOf(decision.in)}`
  }
  if (decision.type === 'ORDER') {
    return `${numberOf(decision.target)} → ${ORDER_LABEL[decision.order]}`
  }
  if (decision.type === 'POSITION') {
    return `${numberOf(decision.target)} → ${decision.position ? '직접 배치' : '기본 자리'}`
  }
  return '무엇을 바꿨는지 기록에 없음'
}

function clockAt(tick: number, kickoff: number): string {
  return formatMinute(kickoff + (tick / TOTAL_TICKS) * SEGMENT_MINUTES)
}

function earliest(decisions: readonly Decision[]): Decision | null {
  return decisions.reduce<Decision | null>(
    (first, decision) =>
      first === null || decision.tick < first.tick ? decision : first,
    null,
  )
}

/**
 * 화면이 저장한 실제 결정 가운데 경기 시간상 가장 이른 한 건을 고른다.
 * 두 반을 뛰었으면 전반 기록이 언제나 후반 기록보다 먼저다.
 */
function observedDecisionOf(
  history: OneMoveDecisionHistory,
): ConcreteDecision | null {
  const firstHalfDecision = history.firstHalf
    ? earliest(history.firstHalf)
    : null
  if (firstHalfDecision) {
    return {
      time: `${halfLabel(1)} ${clockAt(firstHalfDecision.tick, kickoffMinute(1))}`,
      decision: decisionText(firstHalfDecision),
    }
  }

  const current = earliest(history.decisions)
  if (!current) return null
  return {
    time: history.firstHalf
      ? `${halfLabel(2)} ${clockAt(current.tick, history.kickoff)}`
      : clockAt(current.tick, history.kickoff),
    decision: decisionText(current),
  }
}

function decisionCount(review: readonly CoachFinding[]): number {
  const timing = review.find((finding) => finding.id === 'decision-timing')
  const match = timing?.title.match(/총 (\d+)회 결정/)
  return match ? Number(match[1]) : 0
}

/**
 * 두 반 보고서에는 실제 결정이 `전반 · 25:00 포메이션 → 5-4-1`처럼
 * 기록된다. 새 인과를 만들지 않고 이미 적힌 첫 관찰 결정만 꺼낸다.
 */
function concreteDecisionOf(
  review: readonly CoachFinding[],
): ConcreteDecision | null {
  const halves = review.find((finding) => finding.id === 'decision-halves')
  if (!halves) return null

  for (const line of halves.evidence) {
    const match = line.match(/^(전반|후반) · (\d+:\d{2}) (.+)$/)
    if (match) {
      return {
        time: `${match[1]} ${match[2]}`,
        decision: match[3],
      }
    }
  }
  return null
}

function withoutTime(title: string, time: string | undefined): string {
  if (!time) return title
  const prefix = `${time}에 `
  return title.startsWith(prefix) ? title.slice(prefix.length) : title
}

export function formatPointDelta(delta: number): string {
  const raw = delta * 100
  const points = Math.abs(raw) < 0.05 ? 0 : raw
  return `${points > 0 ? '+' : ''}${points.toFixed(1)}%p`
}

function toneOf(delta: number): OneMoveTone {
  const points = delta * 100
  if (points >= 0.05) return 'positive'
  if (points <= -0.05) return 'negative'
  return 'neutral'
}

/**
 * 종료 보고서가 이미 확인한 결정과 150판 전체 비교만 요약한다.
 *
 * 현재 데이터는 결정 하나마다 성공 가능성을 따로 재지 않는다. 결정이
 * 여러 개면 대표 관찰/판정을 하나 고르되, +/- %p는 반드시 모든 판단을
 * 함께 재현한 결과라고 밝힌다.
 */
export function buildOneMove(
  review: readonly CoachFinding[],
  userDelta: number,
  history?: OneMoveDecisionHistory,
): OneMoveSummary {
  const deltaText = formatPointDelta(userDelta)
  const tone = toneOf(userDelta)
  const observed = history ? observedDecisionOf(history) : null
  const historyCount = history
    ? history.decisions.length + (history.firstHalf?.length ?? 0)
    : null
  const count = historyCount ?? decisionCount(review)
  const none =
    historyCount !== null
      ? historyCount === 0
      : review.some((finding) => finding.id === 'decision-none')

  if (none) {
    return {
      kind: 'none',
      label: '개입 없음',
      time: null,
      decision: '개입 없음',
      impactLabel: '방치 대비',
      deltaText,
      tone,
      note: '경기 중에 바꾼 것이 없어 판단 효과를 따로 계산하지 않았습니다.',
    }
  }

  const timing = review.find((finding) => finding.id === 'decision-timing')
  const concrete = concreteDecisionOf(review)
  const reached = review.find(
    (finding) => finding.id === 'decision-recommendation' && finding.time,
  )

  if (count === 1) {
    const time = observed?.time ?? concrete?.time ?? timing?.time ?? null
    return {
      kind: 'single',
      label: '실제로 내린 결정',
      time,
      decision:
        observed?.decision ??
        concrete?.decision ??
        withoutTime(timing?.title ?? '무엇을 바꿨는지는 지금 기록으로 확인할 수 없습니다.', timing?.time),
      impactLabel: '이 결정을 포함한 판단 · 방치 대비',
      deltaText,
      tone,
      note: '같은 150판에서 이 결정이 있는 경기와 방치를 비교한 값입니다.',
    }
  }

  const time = observed?.time ?? reached?.time ?? concrete?.time ?? timing?.time ?? null
  const decision = observed
    ? observed.decision
    : reached
    ? withoutTime(reached.title, reached.time)
    : concrete?.decision ??
      withoutTime(timing?.title ?? '대표로 뽑을 결정을 지금 기록에서 고를 수 없습니다.', timing?.time)

  return {
    kind: 'representative',
    label: observed || concrete ? '대표로 짚은 결정' : '대표 판단',
    time,
    decision,
    impactLabel: '전체 판단 묶음 · 방치 대비',
    deltaText,
    tone,
    note: `위에는 ${observed || concrete ? '실제로 내린 결정' : '보고서의 판단'} 하나만 대표로 보여 줍니다. ${deltaText}는 이 한 수만의 효과가 아니라 모든 판단을 함께 재현한 결과입니다.`,
  }
}
