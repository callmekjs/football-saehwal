import { FREE_POSITION } from '../sim/constants'
import type { PlayerOrder, PlayerPosition } from '../sim/types'

/**
 * 전술판 카드 한 변과 카드 사이에 남길 최소 여백(px).
 *
 * 카드는 44px 표적이다. 중심끼리 이보다 가까우면 둘 중 하나를 누르기
 * 어려우므로, 놓은 지점에서 가장 가까운 빈자리로만 조금 비켜 준다.
 */
export const CARD_SIZE = 44
export const CARD_GAP = 4

/**
 * 여기까지는 그냥 탭이다(px).
 *
 * 누르는 순간의 작은 손 떨림은 드래그로 읽지 않는다. 가로·세로·대각선
 * 어느 방향이든 이 거리를 넘으면 실제 위치 변경이다.
 */
export const DRAG_START = 6

/** 기존 앞뒤 줄 지시를 배치판에 보여주는 거리(m) */
export const ORDER_DEPTH_SHIFT = 22

export function displayDepth(depth: number, order: PlayerOrder): number {
  if (order === 'PUSH_UP') return depth + ORDER_DEPTH_SHIFT
  if (order === 'DROP_BACK') return depth - ORDER_DEPTH_SHIFT
  return depth
}

export interface BoardSize {
  width: number
  height: number
}

export interface BoardPoint {
  x: number
  y: number
}

export type DropTarget =
  | { kind: 'PLACE'; position: PlayerPosition }
  | { kind: 'NONE' }

export type DepthZone = 'DEFENCE' | 'MIDFIELD' | 'ATTACK'
export type LaneZone = 'LEFT' | 'CENTRE' | 'RIGHT'

export interface PositionChoice {
  depth: DepthZone
  lane: LaneZone
  depthLabel: '수비' | '중원' | '공격'
  laneLabel: '왼쪽' | '중앙' | '오른쪽'
  position: PlayerPosition
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const pitch = FREE_POSITION.pitch
const zones = FREE_POSITION.zones
const pitchLength = pitch.maxX - pitch.minX
const pitchWidth = pitch.maxY - pitch.minY

const depthCentres: Array<[DepthZone, PositionChoice['depthLabel'], number]> = [
  ['DEFENCE', '수비', (pitch.minX + zones.defenceMaxX) / 2],
  ['MIDFIELD', '중원', (zones.defenceMaxX + zones.midfieldMaxX) / 2],
  ['ATTACK', '공격', (zones.midfieldMaxX + pitch.maxX) / 2],
]

const laneCentres: Array<[LaneZone, PositionChoice['laneLabel'], number]> = [
  ['LEFT', '왼쪽', pitch.minY + pitchWidth / 6],
  ['CENTRE', '중앙', pitch.centreY],
  ['RIGHT', '오른쪽', pitch.maxY - pitchWidth / 6],
]

/** 드래그 없이 고를 수 있는 수비/중원/공격 × 왼쪽/중앙/오른쪽 아홉 자리 */
export const POSITION_CHOICES: PositionChoice[] = depthCentres.flatMap(
  ([depth, depthLabel, x]) =>
    laneCentres.map(([lane, laneLabel, y]) => ({
      depth,
      lane,
      depthLabel,
      laneLabel,
      position: { x, y },
    })),
)

/** 가로·세로·대각선 어느 방향이든 6px 이상이면 드래그다 */
export function isDragMovement(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_START
}

/**
 * 실제 피치 미터를 세로 전술판의 카드 중심 좌표로 바꾼다.
 *
 * 판 위쪽이 상대 골문이므로 x 축은 뒤집고, y 축은 화면 왼쪽에서 오른쪽
 * 방향으로 그대로 놓는다.
 */
export function boardPointOf(position: PlayerPosition, size: BoardSize): BoardPoint {
  if (size.width <= 0 || size.height <= 0) return { x: 0, y: 0 }
  return {
    x: ((position.y - pitch.minY) / pitchWidth) * size.width,
    y: (1 - (position.x - pitch.minX) / pitchLength) * size.height,
  }
}

/**
 * 카드 중심을 판 안에 남긴다.
 *
 * 단순히 0~너비로 자르면 카드 절반이 잘린다. 44px 카드의 반지름까지
 * 안쪽으로 제한하므로 판 밖에 놓아도 가장 가까운 터치라인/골라인 자리에
 * 카드 전체가 보인다.
 */
function clampCardPoint(point: BoardPoint, size: BoardSize): BoardPoint {
  const insetX = Math.min(CARD_SIZE / 2, size.width / 2)
  const insetY = Math.min(CARD_SIZE / 2, size.height / 2)
  return {
    x: clamp(point.x, insetX, Math.max(insetX, size.width - insetX)),
    y: clamp(point.y, insetY, Math.max(insetY, size.height - insetY)),
  }
}

function pitchPositionOf(point: BoardPoint, size: BoardSize): PlayerPosition {
  if (size.width <= 0 || size.height <= 0) {
    return { x: pitch.centreX, y: pitch.centreY }
  }
  return {
    x: clamp(
      pitch.minX + (1 - point.y / size.height) * pitchLength,
      pitch.minX,
      pitch.maxX,
    ),
    y: clamp(
      pitch.minY + (point.x / size.width) * pitchWidth,
      pitch.minY,
      pitch.maxY,
    ),
  }
}

const distance = (a: BoardPoint, b: BoardPoint) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * 겹친 카드만 가장 가까운 빈자리로 조금 비켜 준다.
 *
 * 각 기존 카드 둘레의 정확한 최소 간격 지점을 후보로 만들고, 모든 카드와
 * 간격을 지키는 후보 중 원래 놓은 곳에 가장 가까운 것을 고른다. 그래서
 * 자동 보정이 필요 이상으로 멀리 카드를 보내지 않는다.
 */
function separateCard(
  desired: BoardPoint,
  occupied: BoardPoint[],
  size: BoardSize,
): BoardPoint {
  const minimum = CARD_SIZE + CARD_GAP
  const clear = (candidate: BoardPoint) =>
    occupied.every((other) => distance(candidate, other) >= minimum - 0.01)

  if (clear(desired)) return desired

  const candidates: BoardPoint[] = []
  const ANGLES = 32
  for (const other of occupied) {
    for (let i = 0; i < ANGLES; i += 1) {
      const angle = (Math.PI * 2 * i) / ANGLES
      candidates.push(
        clampCardPoint(
          {
            x: other.x + Math.cos(angle) * minimum,
            y: other.y + Math.sin(angle) * minimum,
          },
          size,
        ),
      )
    }
  }

  const valid = candidates
    .filter(clear)
    .sort((a, b) => distance(a, desired) - distance(b, desired))
  if (valid.length > 0) return valid[0]

  // 좁은 판에 카드가 빽빽해 완전한 빈자리가 없으면, 후보 중 가장 덜
  // 겹치는 곳을 고른다. 화면 밖으로 밀어내지는 않는다.
  return candidates.sort((a, b) => {
    const gapA = Math.min(...occupied.map((other) => distance(a, other)))
    const gapB = Math.min(...occupied.map((other) => distance(b, other)))
    return gapB - gapA || distance(a, desired) - distance(b, desired)
  })[0] ?? desired
}

/**
 * 실제 드롭 지점을 피치 미터 좌표로 바꾼다.
 *
 * 다른 카드 위, 같은 줄, 빈 공간, 가로·세로·대각선 이동을 따로 나누지
 * 않는다. 손을 6px 이상 움직인 뒤 놓은 모든 지점은 하나의 실제 자리다.
 */
export function resolveDrop(
  point: BoardPoint,
  size: BoardSize,
  occupied: PlayerPosition[],
): DropTarget {
  if (size.width <= 0 || size.height <= 0) return { kind: 'NONE' }
  const desired = clampCardPoint(point, size)
  const occupiedPoints = occupied.map((position) => boardPointOf(position, size))
  const separated = separateCard(desired, occupiedPoints, size)
  return { kind: 'PLACE', position: pitchPositionOf(separated, size) }
}

/** 위치가 어느 3×3 구역인지 드래그 중과 버튼 설명에서 함께 쓴다 */
export function positionZone(position: PlayerPosition): {
  depth: PositionChoice['depthLabel']
  lane: PositionChoice['laneLabel']
} {
  const depth =
    position.x <= zones.defenceMaxX
      ? '수비'
      : position.x <= zones.midfieldMaxX
        ? '중원'
        : '공격'
  const firstThird = pitch.minY + pitchWidth / 3
  const secondThird = pitch.minY + (pitchWidth * 2) / 3
  const lane = position.y < firstThird ? '왼쪽' : position.y <= secondThird ? '중앙' : '오른쪽'
  return { depth, lane }
}

/**
 * 놓기 전에 결과 또는 엔진이 막은 한국어 사유를 한 줄로 알려준다.
 */
export function dropHint(target: DropTarget, blocked: string | null, self: number): string {
  if (blocked) return blocked
  if (target.kind === 'NONE') return '경기장 안에 놓아 주세요'
  const zone = positionZone(target.position)
  return `${self}번 · ${zone.depth} · ${zone.lane}에 놓기`
}
