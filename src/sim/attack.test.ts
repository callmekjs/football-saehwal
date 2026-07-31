import { describe, it, expect } from 'vitest'
import { drawTick, resolveAttacks, type TickDraws } from './attack'
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
  it('뽑는 개수가 슬롯 수와 정확히 일치한다', () => {
    // 조건 분기 안에서 난수를 뽑으면 분기가 갈릴 때마다 이후 수열이 밀려
    // 재현이 조용히 깨진다. 슬롯을 추가할 때 이 테스트가 개수를 지킨다.
    const slots = Object.keys(drawTick(createRng(1))).length

    const a = createRng(1)
    drawTick(a)
    const afterOne = a.next()

    const b = createRng(1)
    for (let i = 0; i < slots; i++) b.next()
    expect(afterOne).toEqual(b.next())
  })

  it('슬롯이 서로 다른 값을 낸다', () => {
    const d = drawTick(createRng(1))
    const values = Object.values(d)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('resolveAttacks — 무개입 기준', () => {
  const noEvent: TickDraws = {
    behind: 1,
    behindShot: 1,
    homeAttempt: 1,
    homeEnter: 1,
    homeShot: 1,
    awayAttempt: 1,
    awayEnter: 1,
    awayShot: 1,
    setPiece: 1,
    setPieceShot: 1,
    foul: 1,
    foulTarget: 1,
    card: 1,
    penalty: 1,
    penaltyShot: 1,
    sendOff: 1,
    injury: 1,
    injuryTarget: 1,
  }

  it('이미 난 득점의 경로만 기록하며 결과와 개수가 일치한다', () => {
    const c = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    const home = resolveAttacks(
      { ...noEvent, homeAttempt: 0, homeEnter: 0, homeShot: 0 },
      c,
      1,
      70,
    )
    expect(home.homeGoals).toBe(1)
    expect(home.homeGoalCauses).toEqual(['BUILD_UP'])

    const away = resolveAttacks(
      {
        ...noEvent,
        behind: 0,
        behindShot: 0,
        awayAttempt: 0,
        awayEnter: 0,
        awayShot: 0,
        setPiece: 0,
        setPieceShot: 0,
      },
      c,
      1,
      70,
    )
    expect(away.awayGoals).toBe(1)
    expect(away.awayGoalCauses).toEqual(['BEHIND'])
    expect(away.awayGoalCauses).toHaveLength(away.awayGoals)
  })

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
