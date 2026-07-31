/**
 * 첫 화면 전술판의 움직임이 축구인가.
 *
 * 사용자가 정했다 — *"점들 각각 전술적으로 움직이는 거."* 그래서 "움직인다"
 * 가 아니라 **"공을 기준으로 옳게 움직인다"** 를 검사한다.
 *
 * 숫자를 박지 않는다. 계수를 조금 손보면 깨지는 검사는 아무것도 지키지
 * 못한다. 여기서는 **방향과 대소**만 본다.
 */
import { describe, expect, it } from 'vitest'
import { boardFrame, LOOP_SEC } from './titleBoardMotion'
import type { BoardDot } from './titleBoard'

const OURS: BoardDot[] = [
  { num: 1, pos: 'GK', x: 5, y: 34 },
  { num: 2, pos: 'DF', x: 22, y: 10 },
  { num: 5, pos: 'DF', x: 18, y: 26 },
  { num: 4, pos: 'DF', x: 18, y: 42 },
  { num: 3, pos: 'DF', x: 22, y: 58 },
  { num: 7, pos: 'MF', x: 45, y: 10 },
  { num: 6, pos: 'MF', x: 42, y: 27 },
  { num: 8, pos: 'MF', x: 42, y: 41 },
  { num: 11, pos: 'MF', x: 45, y: 58 },
  { num: 9, pos: 'FW', x: 70, y: 27 },
  { num: 10, pos: 'FW', x: 70, y: 41 },
]

const THEIRS: BoardDot[] = [
  { num: 1, pos: 'GK', x: 103, y: 34 },
  { num: 2, pos: 'DF', x: 84, y: 12 },
  { num: 5, pos: 'DF', x: 86, y: 27 },
  { num: 4, pos: 'DF', x: 86, y: 41 },
  { num: 3, pos: 'DF', x: 84, y: 56 },
  { num: 7, pos: 'MF', x: 66, y: 14 },
  { num: 8, pos: 'MF', x: 64, y: 29 },
  { num: 10, pos: 'MF', x: 64, y: 39 },
  { num: 6, pos: 'MF', x: 66, y: 54 },
  { num: 9, pos: 'FW', x: 46, y: 27 },
  { num: 11, pos: 'FW', x: 46, y: 41 },
]

const at = (t: number) => boardFrame(OURS, THEIRS, t)
/** 한 바퀴를 촘촘히 훑는다 */
const sweep = (step = 0.25) => {
  const out = []
  for (let t = 0; t < LOOP_SEC; t += step) out.push(at(t))
  return out
}
const base = (side: 'ours' | 'theirs', num: number) =>
  (side === 'ours' ? OURS : THEIRS).find((d) => d.num === num)!

describe('첫 화면 전술판의 움직임', () => {
  it('공이 왼쪽으로 가면 양 팀 블록이 함께 왼쪽으로 민다', () => {
    // 오른쪽 수비수가 제자리에 남으면 그 팀은 가로로 찢어진다
    const frames = sweep()
    const left = frames.reduce((a, b) => (a.ball.y < b.ball.y ? a : b))
    const right = frames.reduce((a, b) => (a.ball.y > b.ball.y ? a : b))

    for (const side of ['ours', 'theirs'] as const) {
      const mid = (f: (typeof frames)[number]) =>
        f[side].reduce((s, d) => s + d.y, 0) / f[side].length
      expect(mid(left), `${side} 블록이 공을 안 따라간다`).toBeLessThan(mid(right))
    }
  })

  it('공이 우리 골문 쪽으로 오면 두 팀이 함께 내려온다', () => {
    // 한쪽만 움직이면 두 팀 사이가 텅 빈다
    const frames = sweep()
    const deep = frames.reduce((a, b) => (a.ball.x < b.ball.x ? a : b))
    const high = frames.reduce((a, b) => (a.ball.x > b.ball.x ? a : b))

    for (const side of ['ours', 'theirs'] as const) {
      const line = (f: (typeof frames)[number]) =>
        f[side].reduce((s, d) => s + d.x, 0) / f[side].length
      expect(line(deep), `${side} 가 공 깊이를 안 따라간다`).toBeLessThan(line(high))
    }
  })

  it('공을 안 가진 쪽에서 한 명이 공을 잡으러 나간다', () => {
    // 스물두 명이 같은 폭으로만 움직이면 아무도 공을 뺏지 않는다
    const pressed = sweep().filter((f) => {
      const off = f.side === 'ours' ? f.theirs : f.ours
      const nearest = Math.min(...off.map((d) => Math.hypot(d.x - f.ball.x, d.y - f.ball.y)))
      const shifted = off.filter((d) => {
        const b = base(f.side === 'ours' ? 'theirs' : 'ours', d.num)
        return Math.hypot(d.x - b.x, d.y - b.y) > 6
      })
      return nearest < 14 && shifted.length > 0
    })
    expect(pressed.length, '압박하러 나가는 선수가 없다').toBeGreaterThan(0)
  })

  it('골키퍼는 필드 선수보다 훨씬 덜 움직인다', () => {
    const frames = sweep()
    const drift = (side: 'ours' | 'theirs', num: number) =>
      Math.max(
        ...frames.map((f) => {
          const d = f[side].find((p) => p.num === num)!
          const b = base(side, num)
          return Math.hypot(d.x - b.x, d.y - b.y)
        }),
      )
    for (const side of ['ours', 'theirs'] as const) {
      const field = Math.max(...[2, 5, 6, 8].map((n) => drift(side, n)))
      expect(drift(side, 1), `${side} 골키퍼가 골문을 비운다`).toBeLessThan(field * 0.5)
    }
  })

  it('양 팀이 번갈아 공을 가진다', () => {
    const sides = new Set(sweep().map((f) => f.side))
    expect(sides).toEqual(new Set(['ours', 'theirs']))
  })

  it('공을 가진 선수는 언제나 정확히 한 명이다', () => {
    for (const f of sweep()) {
      const holders = [...f.ours, ...f.theirs].filter((d) => d.onBall)
      expect(holders).toHaveLength(1)
    }
  })

  it('대형이 무너지지 않는다 — 아무도 자기 자리에서 멀리 못 간다', () => {
    // 실제 대형을 보여주는 판이라 움직임이 자리를 바꾸면 화면이 거짓말을 한다
    for (const f of sweep()) {
      for (const side of ['ours', 'theirs'] as const) {
        for (const d of f[side]) {
          const b = base(side, d.num)
          expect(
            Math.hypot(d.x - b.x, d.y - b.y),
            `${side} ${d.num}번이 자리를 떠났다`,
          ).toBeLessThan(20)
        }
      }
    }
  })

  it('아무도 경기장 밖으로 나가지 않는다', () => {
    for (const f of sweep(0.1)) {
      for (const d of [...f.ours, ...f.theirs]) {
        expect(d.x).toBeGreaterThan(0)
        expect(d.x).toBeLessThan(105)
        expect(d.y).toBeGreaterThan(0)
        expect(d.y).toBeLessThan(68)
      }
      expect(f.ball.x).toBeGreaterThanOrEqual(0)
      expect(f.ball.x).toBeLessThanOrEqual(105)
    }
  })

  it('한 바퀴를 돌면 처음으로 돌아온다', () => {
    const a = at(3.7)
    const b = at(3.7 + LOOP_SEC)
    expect(b.ball.x).toBeCloseTo(a.ball.x, 6)
    expect(b.ours[0].x).toBeCloseTo(a.ours[0].x, 6)
  })

  it('브라우저를 모른다 — 같은 시각이면 언제나 같은 판이다', () => {
    expect(JSON.stringify(at(9.3))).toBe(JSON.stringify(at(9.3)))
  })
})
