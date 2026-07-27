import { describe, it, expect } from 'vitest'
import { drawTick, resolveAttacks } from './attack'
import { resolveCoefficients } from './tactics'
import { createRng } from './rng'
import { TOTAL_TICKS } from './constants'
import type { Level, Mentality, Tactics } from './types'

const t = (line: Level, press: Level, width: Level): Tactics => ({ line, press, width })

function runOnce(tactics: Tactics, mentality: Mentality, seed: number) {
  const rng = createRng(seed)
  const c = resolveCoefficients(tactics, mentality, false)
  let home = 0
  let away = 0
  for (let i = 0; i < TOTAL_TICKS; i++) {
    const r = resolveAttacks(drawTick(rng), c, 1.0, 58)
    home += r.homeGoals
    away += r.awayGoals
  }
  return { home, away }
}

function average(tactics: Tactics, mentality: Mentality, n = 400) {
  let home = 0
  let away = 0
  for (let s = 0; s < n; s++) {
    const r = runOnce(tactics, mentality, 1000 + s)
    home += r.home
    away += r.away
  }
  return { home: home / n, away: away / n }
}

describe('drawTick', () => {
  it('매 틱 정확히 10개를 소비한다', () => {
    const a = createRng(1)
    drawTick(a)
    const afterOne = a.next()

    const b = createRng(1)
    for (let i = 0; i < 10; i++) b.next()
    expect(afterOne).toEqual(b.next())
  })
})

describe('resolveAttacks — 무개입 기준', () => {
  it('양 팀 합계가 15분에 0.9~1.4골이다', () => {
    const { home, away } = average(t(1, 1, 1), 'BALANCED')
    expect(home + away).toBeGreaterThan(0.9)
    expect(home + away).toBeLessThan(1.4)
  })

  it('라인을 내리면 실점이 오히려 는다', () => {
    // "잠글수록 맞는다" — 국면 2와 4의 반전이 여기 걸려 있다
    const normal = average(t(1, 1, 1), 'ALL_OUT')
    const low = average(t(0, 1, 1), 'ALL_OUT')
    expect(low.away).toBeGreaterThan(normal.away)
  })

  it('라인을 내리면 우리 득점도 준다', () => {
    const normal = average(t(1, 1, 1), 'ALL_OUT')
    const low = average(t(0, 1, 1), 'ALL_OUT')
    expect(low.home).toBeLessThan(normal.home)
  })

  it('상대가 뭉쳐 있으면 넓게가 좁게보다 많이 넣는다', () => {
    // "모을수록 좁아진다" — 국면 1과 5의 반전
    const wide = average(t(1, 1, 2), 'PARK_BUS')
    const narrow = average(t(1, 1, 0), 'PARK_BUS')
    expect(wide.home).toBeGreaterThan(narrow.home * 1.3)
  })

  it('느린 수비수일수록 배후 실점이 는다', () => {
    const c = resolveCoefficients(t(2, 1, 1), 'ALL_OUT', false)
    const tally = (speed: number) => {
      const rng = createRng(5)
      let away = 0
      for (let i = 0; i < TOTAL_TICKS; i++) {
        away += resolveAttacks(drawTick(rng), c, 1.0, speed).awayGoals
      }
      return away
    }
    expect(tally(58)).toBeGreaterThanOrEqual(tally(81))
  })

  it('체력이 떨어지면 우리 득점이 준다', () => {
    const c = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    const tally = (factor: number) => {
      const rng = createRng(9)
      let home = 0
      for (let i = 0; i < TOTAL_TICKS; i++) {
        home += resolveAttacks(drawTick(rng), c, factor, 70).homeGoals
      }
      return home
    }
    expect(tally(0.6)).toBeLessThanOrEqual(tally(1.0))
  })
})
