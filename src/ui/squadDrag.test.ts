import { describe, expect, it } from 'vitest'
import { FREE_POSITION } from '../sim/constants'
import {
  CARD_GAP,
  CARD_SIZE,
  DRAG_START,
  POSITION_CHOICES,
  boardPointOf,
  displayDepth,
  dropHint,
  isDragMovement,
  positionZone,
  resolveDrop,
} from './squadDrag'

const SIZE = { width: 300, height: 420 }

const placedAt = (x: number, y: number, occupied = [] as Array<{ x: number; y: number }>) => {
  const target = resolveDrop({ x, y }, SIZE, occupied)
  expect(target.kind).toBe('PLACE')
  if (target.kind !== 'PLACE') throw new Error('놓기 좌표가 필요하다')
  return target.position
}

describe('어느 방향으로든 자유 위치 놓기', () => {
  it('6px 이상 가로·세로·대각선 이동은 모두 드래그다', () => {
    expect(isDragMovement(DRAG_START, 0)).toBe(true)
    expect(isDragMovement(0, -DRAG_START)).toBe(true)
    expect(isDragMovement(5, 5)).toBe(true)
    expect(isDragMovement(DRAG_START - 1, 0)).toBe(false)
  })

  it('빈 공간에 놓은 실제 지점을 피치 미터로 바꾼다', () => {
    const centre = placedAt(SIZE.width / 2, SIZE.height / 2)
    expect(centre.x).toBeCloseTo(FREE_POSITION.pitch.centreX)
    expect(centre.y).toBeCloseTo(FREE_POSITION.pitch.centreY)
  })

  it('가로로만 옮겨도 좌우 위치가 달라진다', () => {
    const left = placedAt(70, 210)
    const right = placedAt(230, 210)
    expect(left.x).toBeCloseTo(right.x)
    expect(left.y).toBeLessThan(right.y)
  })

  it('세로로만 옮겨도 수비·공격 위치가 달라진다', () => {
    const top = placedAt(150, 80)
    const bottom = placedAt(150, 340)
    expect(top.x).toBeGreaterThan(bottom.x)
    expect(top.y).toBeCloseTo(bottom.y)
  })

  it('대각선으로 옮기면 앞뒤와 좌우가 함께 달라진다', () => {
    const first = placedAt(80, 330)
    const second = placedAt(220, 90)
    expect(second.x).toBeGreaterThan(first.x)
    expect(second.y).toBeGreaterThan(first.y)
  })

  it('같은 줄이나 다른 카드 위도 SWAP이 아니라 실제 PLACE다', () => {
    const occupied = [{ x: 52.5, y: 34 }]
    const point = boardPointOf(occupied[0], SIZE)
    const target = resolveDrop(point, SIZE, occupied)
    expect(target.kind).toBe('PLACE')
    expect(target).not.toHaveProperty('id')
    expect(target).not.toHaveProperty('order')
  })
})

describe('경계와 카드 겹침', () => {
  it('판 밖에 놓아도 경계 안으로 제한하고 카드 전체가 보인다', () => {
    const position = placedAt(-999, 999)
    const p = FREE_POSITION.pitch
    expect(position.x).toBeGreaterThanOrEqual(p.minX)
    expect(position.x).toBeLessThanOrEqual(p.maxX)
    expect(position.y).toBeGreaterThanOrEqual(p.minY)
    expect(position.y).toBeLessThanOrEqual(p.maxY)

    const point = boardPointOf(position, SIZE)
    expect(point.x).toBeGreaterThanOrEqual(CARD_SIZE / 2)
    expect(point.y).toBeLessThanOrEqual(SIZE.height - CARD_SIZE / 2)
  })

  it('다른 카드와 겹치면 가장 가까운 빈자리로 최소 보정한다', () => {
    const occupied = [{ x: 52.5, y: 34 }]
    const point = boardPointOf(occupied[0], SIZE)
    const placed = placedAt(point.x, point.y, occupied)
    const corrected = boardPointOf(placed, SIZE)
    const existing = boardPointOf(occupied[0], SIZE)
    const gap = Math.hypot(corrected.x - existing.x, corrected.y - existing.y)

    expect(gap).toBeGreaterThanOrEqual(CARD_SIZE + CARD_GAP - 0.1)
    expect(gap).toBeLessThan(CARD_SIZE + CARD_GAP + 1)
  })

  it('여러 카드 사이에서도 어느 카드와도 겹치지 않는다', () => {
    const occupied = [
      { x: 52.5, y: 34 },
      { x: 52.5, y: 45 },
      { x: 65, y: 34 },
    ]
    const desired = boardPointOf(occupied[0], SIZE)
    const placed = boardPointOf(placedAt(desired.x, desired.y, occupied), SIZE)
    for (const position of occupied) {
      const other = boardPointOf(position, SIZE)
      expect(Math.hypot(placed.x - other.x, placed.y - other.y))
        .toBeGreaterThanOrEqual(CARD_SIZE + CARD_GAP - 0.1)
    }
  })
})

describe('3×3 위치 안내와 접근성 대안', () => {
  it('수비·중원·공격 × 왼쪽·중앙·오른쪽 아홉 자리가 모두 있다', () => {
    expect(POSITION_CHOICES).toHaveLength(9)
    expect(new Set(POSITION_CHOICES.map((choice) => choice.depthLabel))).toEqual(
      new Set(['수비', '중원', '공격']),
    )
    expect(new Set(POSITION_CHOICES.map((choice) => choice.laneLabel))).toEqual(
      new Set(['왼쪽', '중앙', '오른쪽']),
    )
  })

  it('위치 구역 이름이 실제 좌표와 맞는다', () => {
    expect(positionZone({ x: 12, y: 8 })).toEqual({ depth: '수비', lane: '왼쪽' })
    expect(positionZone({ x: 52.5, y: 34 })).toEqual({ depth: '중원', lane: '중앙' })
    expect(positionZone({ x: 92, y: 61 })).toEqual({ depth: '공격', lane: '오른쪽' })
  })

  it('드래그 힌트가 앞뒤와 좌우를 함께 말한다', () => {
    const hint = dropHint(
      { kind: 'PLACE', position: { x: 90, y: 8 } },
      null,
      7,
    )
    expect(hint).toContain('공격')
    expect(hint).toContain('왼쪽')
  })

  it('엔진이 막은 한국어 사유를 위치 안내보다 먼저 보여준다', () => {
    const reason = '뒤에는 수비수가 적어도 세 명 남아야 합니다'
    expect(
      dropHint({ kind: 'PLACE', position: { x: 90, y: 34 } }, reason, 4),
    ).toBe(reason)
  })
})

describe('기존 앞뒤 줄 지시 표시', () => {
  it('포메이션 기준에서 올라가라/내려서라만 앞뒤로 보인다', () => {
    expect(displayDepth(45, 'PUSH_UP')).toBeGreaterThan(45)
    expect(displayDepth(45, 'DROP_BACK')).toBeLessThan(45)
    expect(displayDepth(45, 'CONSERVE')).toBe(45)
  })
})
