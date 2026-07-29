import { describe, expect, it } from 'vitest'
import {
  DRAG_START,
  ORDER_DRAG_DISTANCE,
  SWAP_RADIUS,
  ZONE_RATIO,
  displayDepth,
  dropHint,
  openLane,
  resolveDrop,
  swapSeats,
  type CardPoint,
} from './squadDrag'

/** 세로로 세운 판. 위가 상대 골문이라 y 가 작을수록 depth 가 크다 */
const H = 300

const card = (id: string, x: number, y: number, depth: number, line: CardPoint['line']) =>
  ({ id, x, y, depth, line }) as CardPoint

const DF_L = card('dfL', 40, 240, 22, 'DF')
const DF_R = card('dfR', 160, 240, 22, 'DF')
const MF_L = card('mfL', 40, 150, 45, 'MF')
const FW = card('fw', 100, 40, 70, 'FW')
const ALL = [DF_L, DF_R, MF_L, FW]

describe('다른 카드 위에 놓기', () => {
  it('같은 줄이면 자리를 바꾼다', () => {
    expect(resolveDrop(DF_L, { x: 160, y: 240 }, H, ALL)).toEqual({ kind: 'SWAP', id: 'dfR' })
  })

  it('조금 빗나가도 카드 위로 친다', () => {
    const near = { x: 160 + SWAP_RADIUS - 2, y: 240 }
    expect(resolveDrop(DF_L, near, H, ALL)).toEqual({ kind: 'SWAP', id: 'dfR' })
  })

  it('많이 빗나가면 카드 위가 아니다', () => {
    const far = { x: 160 + SWAP_RADIUS + 10, y: 240 }
    expect(resolveDrop(DF_L, far, H, ALL).kind).not.toBe('SWAP')
  })

  it('겹쳐 보이면 더 가까운 카드를 고른다', () => {
    const between = { x: 150, y: 240 }
    expect(resolveDrop(MF_L, between, H, ALL)).toEqual({
      kind: 'ORDER',
      order: 'DROP_BACK',
    })
  })

  it('앞쪽 줄 선수 위에 놓으면 올라가라가 걸린다', () => {
    expect(resolveDrop(MF_L, { x: 100, y: 40 }, H, ALL)).toEqual({
      kind: 'ORDER',
      order: 'PUSH_UP',
    })
  })

  it('뒤쪽 줄 선수 위에 놓으면 내려서라가 걸린다', () => {
    expect(resolveDrop(MF_L, { x: 40, y: 240 }, H, ALL)).toEqual({
      kind: 'ORDER',
      order: 'DROP_BACK',
    })
  })

  it('자기 자신 위에 놓아도 아무 일이 없다', () => {
    expect(resolveDrop(MF_L, { x: 40, y: 150 }, H, ALL)).toEqual({ kind: 'NONE' })
  })
})

describe('위아래 구역', () => {
  it('위쪽 끝은 상대 골문 — 올라가라', () => {
    expect(resolveDrop(MF_L, { x: 200, y: H * (ZONE_RATIO - 0.02) }, H, ALL)).toEqual({
      kind: 'ORDER',
      order: 'PUSH_UP',
    })
  })

  it('아래쪽 끝은 우리 골문 — 내려서라', () => {
    expect(resolveDrop(MF_L, { x: 200, y: H * (1 - ZONE_RATIO + 0.02) }, H, ALL)).toEqual({
      kind: 'ORDER',
      order: 'DROP_BACK',
    })
  })

  it('판 밖으로 끌어 올려도 올라가라로 친다', () => {
    expect(resolveDrop(MF_L, { x: 200, y: -40 }, H, ALL)).toEqual({
      kind: 'ORDER',
      order: 'PUSH_UP',
    })
  })

  it('가운데는 아무것도 아니다 — 잘못 놓으면 되돌아간다', () => {
    expect(resolveDrop(MF_L, { x: 220, y: H / 2 }, H, ALL)).toEqual({ kind: 'NONE' })
  })

  it('판 끝까지 가지 않아도 분명히 위아래로 끌면 지시가 걸린다', () => {
    expect(resolveDrop(MF_L, { x: MF_L.x, y: MF_L.y - ORDER_DRAG_DISTANCE }, H, ALL))
      .toEqual({ kind: 'ORDER', order: 'PUSH_UP' })
    expect(resolveDrop(MF_L, { x: MF_L.x, y: MF_L.y + ORDER_DRAG_DISTANCE }, H, ALL))
      .toEqual({ kind: 'ORDER', order: 'DROP_BACK' })
  })

  it('작은 흔들림과 가로 끌기는 지시가 아니다', () => {
    expect(resolveDrop(MF_L, { x: MF_L.x, y: MF_L.y + DRAG_START + 2 }, H, ALL))
      .toEqual({ kind: 'NONE' })
    expect(resolveDrop(MF_L, { x: MF_L.x + 80, y: MF_L.y + 20 }, H, ALL))
      .toEqual({ kind: 'NONE' })
  })

  it('위아래가 뒤집히지 않는다', () => {
    const up = resolveDrop(MF_L, { x: 230, y: 5 }, H, ALL)
    const down = resolveDrop(MF_L, { x: 230, y: H - 5 }, H, ALL)
    expect(up).not.toEqual(down)
    expect(up).toEqual({ kind: 'ORDER', order: 'PUSH_UP' })
  })

  it('판 높이를 못 재면 아무 일도 하지 않는다', () => {
    expect(resolveDrop(MF_L, { x: 10, y: 10 }, 0, [])).toEqual({ kind: 'NONE' })
  })
})

describe('지시 뒤 카드 위치', () => {
  it('올라가라는 위로, 내려서라는 아래로 이동하고 다른 지시는 자리를 지킨다', () => {
    const base = 42
    expect(displayDepth(base, 'PUSH_UP')).toBeGreaterThan(base)
    expect(displayDepth(base, 'DROP_BACK')).toBeLessThan(base)
    expect(displayDepth(base, 'CONSERVE')).toBe(base)
  })

  it('새 줄의 기존 카드 사이에서 가장 넓은 빈칸을 고른다', () => {
    const defenders = [7, 36, 64, 93]
    const defenderLane = openLane(38, defenders)
    expect(Math.min(...defenders.map((lane) => Math.abs(defenderLane - lane))))
      .toBeGreaterThan(13)
    expect(openLane(62, [38, 62])).toBe(92)
    expect(openLane(50, [])).toBe(50)
  })
})

describe('자리 바꾸기', () => {
  it('두 사람의 자리 번호가 서로 넘어간다', () => {
    const seats = new Map([
      ['a', 1],
      ['b', 5],
      ['c', 7],
    ])
    const next = swapSeats(seats, 'a', 'b')
    expect(next.get('a')).toBe(5)
    expect(next.get('b')).toBe(1)
    expect(next.get('c')).toBe(7)
  })

  it('원래 맵을 고치지 않는다', () => {
    const seats = new Map([
      ['a', 1],
      ['b', 5],
    ])
    swapSeats(seats, 'a', 'b')
    expect(seats.get('a')).toBe(1)
  })

  it('같은 사람끼리는 바뀌지 않는다', () => {
    const seats = new Map([['a', 1]])
    expect(swapSeats(seats, 'a', 'a').get('a')).toBe(1)
  })

  it('명단에 없는 사람이면 그대로 둔다', () => {
    const seats = new Map([['a', 1]])
    const next = swapSeats(seats, 'a', 'zzz')
    expect(next.get('a')).toBe(1)
    expect(next.has('zzz')).toBe(false)
  })

  it('두 번 바꾸면 처음으로 돌아온다', () => {
    const seats = new Map([
      ['a', 2],
      ['b', 9],
    ])
    const back = swapSeats(swapSeats(seats, 'a', 'b'), 'a', 'b')
    expect(back.get('a')).toBe(2)
    expect(back.get('b')).toBe(9)
  })
})

describe('놓기 전에 알려주는 한 줄', () => {
  const numOf = (id: string) => (id === 'dfR' ? 3 : 99)

  it('안 되는 이유가 있으면 그것부터 말한다', () => {
    const hint = dropHint({ kind: 'ORDER', order: 'PUSH_UP' }, '이미 공격수다', numOf, 9)
    expect(hint).toBe('이미 공격수다')
  })

  it('자리 바꾸기는 배치만 바뀐다고 분명히 말한다', () => {
    const hint = dropHint({ kind: 'SWAP', id: 'dfR' }, null, numOf, 2)
    expect(hint).toContain('배치만')
    expect(hint).toContain('2')
    expect(hint).toContain('3')
  })

  it('지시는 방향마다 다른 말을 한다', () => {
    const up = dropHint({ kind: 'ORDER', order: 'PUSH_UP' }, null, numOf, 6)
    const down = dropHint({ kind: 'ORDER', order: 'DROP_BACK' }, null, numOf, 6)
    expect(up).not.toBe(down)
    expect(up).toContain('올라가라')
    expect(down).toContain('내려서라')
  })

  it('아무 데나 놓으면 되돌아간다고 말한다', () => {
    expect(dropHint({ kind: 'NONE' }, null, numOf, 6)).toContain('제자리')
  })
})

describe('탭을 망가뜨리지 않는 상수', () => {
  it('손 떨림은 드래그가 아니다', () => {
    expect(DRAG_START).toBeGreaterThan(2)
    expect(DRAG_START).toBeLessThan(SWAP_RADIUS)
  })

  it('지시 구역이 판의 절반을 먹지 않는다 — 가운데가 남아야 취소할 수 있다', () => {
    expect(ZONE_RATIO).toBeGreaterThan(0.05)
    expect(ZONE_RATIO * 2).toBeLessThan(0.5)
  })
})
