import type { PlayerOrder, Position } from '../sim/types'

/**
 * 전술판에서 선수 카드를 끌어다 놓는 판정.
 *
 * **새 확률 통로를 만들지 않는다.** 이미 배선된 개별 지시(`DROP_BACK` ·
 * `PUSH_UP`)에 공간적인 표현을 붙이는 것뿐이다. 위로 끌면 앞으로 올라가고
 * 아래로 끌면 뒤로 내려간다 — 판이 세로로 서 있고 아래가 우리 골문이라
 * 화살표를 읽지 않아도 방향이 맞는다.
 *
 * 드래그는 **빠른 길이지 유일한 길이 아니다.** 같은 일을 선수 1탭 → 행동
 * 1탭으로도 할 수 있어야 한다. 마우스가 없는 환경이 있고, 규칙상 작동하지
 * 않는 인터랙션은 평가에서 제외된다.
 *
 * 이 파일에는 **좌표 판정만** 둔다. "그 지시를 걸어도 되는가"는 엔진의
 * `checkOrder` 가 판단한다. 검증이 두 곳에 있으면 드래그로 되는 것과
 * 탭으로 되는 것이 조용히 갈린다.
 */

/** 다른 카드 위에 놓았다고 볼 거리(px). 카드가 44px 이라 반지름보다 조금 크다 */
export const SWAP_RADIUS = 30

/** 판 위아래 이 비율 안쪽은 지시 구역이다 */
export const ZONE_RATIO = 0.15

/**
 * 여기까지는 그냥 탭이다(px).
 *
 * 누르는 순간 손이 몇 픽셀 흔들린다. 이걸 두지 않으면 탭 두 단계가
 * 드래그로 오인되어 **이미 있는 조작이 망가진다.**
 */
export const DRAG_START = 6

/** 이만큼 세로로 옮기면 줄을 바꾸려는 뜻으로 본다(px) */
export const ORDER_DRAG_DISTANCE = 32

/** 경기장 연출에서 개별 지시로 전진·후퇴하는 거리와 같은 값(m) */
export const ORDER_DEPTH_SHIFT = 22

export type DropTarget =
  /** 두 사람의 화면상 자리를 맞바꾼다 */
  | { kind: 'SWAP'; id: string }
  /** 이미 있는 개별 지시를 건다 */
  | { kind: 'ORDER'; order: Extract<PlayerOrder, 'DROP_BACK' | 'PUSH_UP'> }
  /** 아무 일도 없다. 카드는 제자리로 돌아간다 */
  | { kind: 'NONE' }

export interface CardPoint {
  id: string
  /** 전술판 안에서의 중심 좌표(px) */
  x: number
  y: number
  /** 이 자리의 피치 x. 클수록 상대 골문 쪽이다 */
  depth: number
  /** 이 자리가 속한 줄 */
  line: Position
}

/** 지시가 걸린 뒤 카드와 경기장 선수가 함께 머무를 앞뒤 위치 */
export function displayDepth(depth: number, order: PlayerOrder): number {
  if (order === 'PUSH_UP') return depth + ORDER_DEPTH_SHIFT
  if (order === 'DROP_BACK') return depth - ORDER_DEPTH_SHIFT
  return depth
}

/**
 * 새 줄의 카드 사이에서 가장 넓은 빈칸을 고른다.
 *
 * 양 끝 카드는 판 밖으로 반쯤 나가지 않게 8~92% 안에 둔다. 같은 너비의
 * 카드가 늘어서므로 기존 카드 사이 중점을 후보로 보면 겹치지 않는 자리를
 * 별도 좌표 저장 없이 재현할 수 있다.
 */
export function openLane(preferred: number, occupied: number[]): number {
  if (occupied.length === 0) return Math.max(8, Math.min(92, preferred))
  const sorted = [...occupied].sort((a, b) => a - b)
  const candidates = [
    Math.max(8, Math.min(92, preferred)),
    8,
    92,
    ...sorted.slice(0, -1).map((lane, i) => (lane + sorted[i + 1]) / 2),
  ]
  let best = candidates[0]
  let bestGap = -1
  for (const candidate of candidates) {
    const gap = Math.min(...sorted.map((lane) => Math.abs(candidate - lane)))
    if (gap > bestGap || (gap === bestGap && Math.abs(candidate - preferred) < Math.abs(best - preferred))) {
      best = candidate
      bestGap = gap
    }
  }
  return best
}

/**
 * 끌어다 놓은 지점이 무엇을 뜻하는가.
 *
 * 판정 순서에 이유가 있다.
 *
 * 1. **다른 카드 위**가 가장 먼저다. 사람이 카드를 겨냥해 놓았으면 그게
 *    구역보다 분명한 의사표시다.
 *    - 같은 줄이면 **자리 바꾸기**다. 엔진은 좌우를 구분하지 않으므로
 *      같은 줄 안에서 자리를 바꾸는 것은 확률에 영향이 없다. 그래서
 *      화면에서도 배치만 바뀐다고 말한다.
 *    - 다른 줄이면 **지시**다. 뒤쪽 줄로 끌었으면 내려서라, 앞쪽 줄로
 *      끌었으면 올라가라. 이쪽이 사람이 기대하는 것이고 실제로 확률에
 *      걸린다.
 * 2. 카드에서 멀면 **시작점에서 움직인 방향**을 본다. 위는 상대 골문,
 *    아래는 우리 골문이다. 판 끝까지 끌 필요는 없다.
 * 3. 세로 이동이 작거나 가로 이동이면 아무 일도 없다. 잘못 놓았을 때
 *    되돌아가는 길이다.
 */
export function resolveDrop(
  from: CardPoint,
  point: { x: number; y: number },
  fieldHeight: number,
  others: CardPoint[],
): DropTarget {
  let best: CardPoint | null = null
  let bestDist = SWAP_RADIUS
  for (const o of others) {
    if (o.id === from.id) continue
    const d = Math.hypot(o.x - point.x, o.y - point.y)
    if (d <= bestDist) {
      best = o
      bestDist = d
    }
  }

  if (best) {
    if (best.line === from.line) return { kind: 'SWAP', id: best.id }
    return { kind: 'ORDER', order: best.depth > from.depth ? 'PUSH_UP' : 'DROP_BACK' }
  }

  if (fieldHeight <= 0) return { kind: 'NONE' }
  const dx = point.x - from.x
  const dy = point.y - from.y
  if (Math.abs(dy) >= ORDER_DRAG_DISTANCE && Math.abs(dy) > Math.abs(dx)) {
    return { kind: 'ORDER', order: dy < 0 ? 'PUSH_UP' : 'DROP_BACK' }
  }
  const t = point.y / fieldHeight
  if (t <= ZONE_RATIO) return { kind: 'ORDER', order: 'PUSH_UP' }
  if (t >= 1 - ZONE_RATIO) return { kind: 'ORDER', order: 'DROP_BACK' }
  return { kind: 'NONE' }
}

/**
 * 두 선수의 자리 번호를 맞바꾼다.
 *
 * 원래 맵을 고치지 않고 새로 만든다. 화면이 다시 그려지는 판단은 React
 * 가 하는데, 같은 객체를 몰래 고치면 그 판단이 어긋난다.
 */
export function swapSeats(
  seats: Map<string, number>,
  a: string,
  b: string,
): Map<string, number> {
  const next = new Map(seats)
  const ka = seats.get(a)
  const kb = seats.get(b)
  if (ka === undefined || kb === undefined || a === b) return next
  next.set(a, kb)
  next.set(b, ka)
  return next
}

/**
 * 드래그 중에 띄우는 한 줄.
 *
 * **놓기 전에** 무슨 일이 일어날지, 안 된다면 왜 안 되는지 말한다.
 * 놓은 다음에 "안 됩니다"라고 하면 사람은 이미 손을 뗀 뒤라 무엇을
 * 다시 해야 하는지 모른다.
 */
export function dropHint(
  target: DropTarget,
  blocked: string | null,
  numOf: (id: string) => number,
  self: number,
): string {
  if (blocked) return blocked
  switch (target.kind) {
    case 'SWAP':
      return `${self}번 ↔ ${numOf(target.id)}번 자리 바꾸기 · 배치만 바뀝니다`
    case 'ORDER':
      return target.order === 'PUSH_UP'
        ? `${self}번 올라가라 — 공격으로 붙는다`
        : `${self}번 내려서라 — 수비로 내려간다`
    default:
      return '놓으면 제자리로 돌아갑니다'
  }
}
