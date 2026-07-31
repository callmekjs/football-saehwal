import { describe, it, expect } from 'vitest'
import { simulate, createState, checkSub, tick } from './engine'
import { EVENTS, TOTAL_TICKS } from './constants'
import { BENCH, HOME_XI } from './squad'
import { PROBLEMS } from './problems'
import { createRng } from './rng'
import type { Decision, Problem } from './types'

const P: Problem = {
  id: 'p02',
  title: '잠긴 문',
  order: 1,
  score: [1, 0],
  initialTactics: { line: 1, press: 1, width: 1 },
  initialFormation: '4-4-2',
  objective: { type: 'SURVIVE', bonusOnWin: false },
  seed: 40712,
  subsLeft: 3,
  staminaOverrides: { MF06: 48 },
  booked: ['MF06'],
  unavailable: [],
  awayCount: 11,
}

const count = (p: Problem, decisions: Decision[], kind: string, n = 300) => {
  let total = 0
  for (let s = 0; s < n; s++) {
    total += simulate({ ...p, seed: 90000 + s }, decisions).final.log.filter(
      (e) => e.kind === kind,
    ).length
  }
  return total / n
}

describe('경고와 퇴장', () => {
  it('강 압박이 파울을 늘린다', () => {
    const mid = count(P, [{ tick: 0, type: 'PRESS', value: 1 }], 'FOUL')
    const hard = count(P, [{ tick: 0, type: 'PRESS', value: 2 }], 'FOUL')
    expect(hard).toBeGreaterThan(mid * 1.2)
  })

  it('경고 보유 선수가 있고 강 압박이면 퇴장이 나온다', () => {
    // 압박 축이 실제로 값을 갖는 유일한 통로다.
    // 이것이 0이면 압박은 체력만 깎는 축이 되어 고를 이유가 없다.
    expect(count(P, [{ tick: 0, type: 'PRESS', value: 2 }], 'SEND_OFF')).toBeGreaterThan(0.1)
  })

  it('압박을 낮추면 퇴장이 크게 준다', () => {
    const hard = count(P, [{ tick: 0, type: 'PRESS', value: 2 }], 'SEND_OFF')
    const weak = count(P, [{ tick: 0, type: 'PRESS', value: 0 }], 'SEND_OFF')
    expect(weak).toBeLessThan(hard * 0.5)
  })

  it('경고 보유자가 없으면 강 압박이어도 해저드가 안 돈다', () => {
    const clean: Problem = { ...P, booked: [] }
    const hard = count(P, [{ tick: 0, type: 'PRESS', value: 2 }], 'SEND_OFF')
    const noBooked = count(clean, [{ tick: 0, type: 'PRESS', value: 2 }], 'SEND_OFF')
    expect(noBooked).toBeLessThan(hard)
  })

  it('퇴장이 나면 열 명이 된다', () => {
    for (let s = 0; s < 200; s++) {
      const r = simulate({ ...P, seed: 91000 + s }, [{ tick: 0, type: 'PRESS', value: 2 }])
      const sentOff = r.final.log.filter((e) => e.kind === 'SEND_OFF').length
      if (sentOff > 0) {
        expect(r.final.homeCount).toBeLessThan(11)
        return
      }
    }
    throw new Error('200판 동안 퇴장이 한 번도 없었다 — 해저드가 너무 낮다')
  })
})

describe('부상', () => {
  it('체력이 바닥난 선수가 있어야 부상이 난다', () => {
    const exhausted: Problem = {
      ...P,
      staminaOverrides: { MF06: 10, MF08: 12, FW09: 8 },
    }
    const healthy: Problem = {
      ...P,
      staminaOverrides: {},
      initialTactics: { line: 1, press: 0, width: 1 },
      initialFormation: '4-4-2',
    }
    expect(count(exhausted, [], 'INJURY')).toBeGreaterThan(count(healthy, [], 'INJURY'))
  })

  it('부상은 교체 카드를 강제로 소모한다', () => {
    const exhausted: Problem = { ...P, staminaOverrides: { MF06: 5, MF08: 5, FW09: 5 } }
    for (let s = 0; s < 300; s++) {
      const r = simulate({ ...exhausted, seed: 92000 + s }, [])
      if (r.final.log.some((e) => e.kind === 'INJURY')) {
        expect(r.final.subsLeft).toBeLessThan(P.subsLeft)
        return
      }
    }
    throw new Error('300판 동안 부상이 한 번도 없었다')
  })
})

describe('교체 카드', () => {
  const slowest = HOME_XI.filter((p) => p.pos === 'DF').sort((a, b) => a.speed - b.speed)[0]
  const fastest = BENCH.filter((p) => p.pos === 'DF').sort((a, b) => b.speed - a.speed)[0]
  const SUB: Decision = { tick: 0, type: 'SUB', out: slowest.id, in: fastest.id }

  it('교체하면 카드가 하나 준다', () => {
    expect(simulate(P, [SUB]).final.subsLeft).toBe(P.subsLeft - 1)
  })

  it('교체가 실제로 반영된다', () => {
    const end = simulate(P, [SUB]).final
    expect(end.players.find((s) => s.id === fastest.id)!.onPitch).toBe(true)
    expect(end.players.find((s) => s.id === slowest.id)!.onPitch).toBe(false)
  })

  it('반영에 지연이 있다', () => {
    // 즉시 반영되면 "늦게 쓰면 늦게 듣는다"가 성립하지 않는다
    const justBefore = TOTAL_TICKS - EVENTS.subDelayTicks + 10
    const end = simulate(P, [{ ...SUB, tick: justBefore }]).final
    expect(end.players.find((s) => s.id === fastest.id)!.onPitch).toBe(false)
    expect(end.subsLeft).toBe(P.subsLeft - 1)
  })

  it('카드를 다 쓰면 더 못 바꾼다', () => {
    const s0 = createState({ ...P, subsLeft: 0 })
    expect(checkSub(s0, slowest.id, fastest.id)).not.toBeNull()
  })

  it('피치에 없는 선수는 뺄 수 없다', () => {
    const s = createState(P)
    expect(checkSub(s, fastest.id, slowest.id)).not.toBeNull()
  })

  it('같은 선수를 두 번 대기시킬 수 없다', () => {
    let s = createState(P)
    expect(checkSub(s, slowest.id, fastest.id)).toBeNull()
    s = { ...s, pendingSubs: [{ out: slowest.id, in: fastest.id, atTick: 60 }] }
    expect(checkSub(s, slowest.id, fastest.id)).not.toBeNull()
  })

  it('빠른 수비수를 일찍 넣을수록 실점이 준다', () => {
    // 순서가 실재하는 것은 레버가 아니라 카드다.
    // 레버는 확률에 곱해지는 승수라 곱셈 순서가 없다.
    const conceded = (subTick: number) => {
      let total = 0
      const attack: Problem = { ...P, initialTactics: { line: 2, press: 1, width: 1 } }
      for (let s = 0; s < 400; s++) {
        total += simulate({ ...attack, seed: 93000 + s }, [{ ...SUB, tick: subTick }]).final.score[1]
      }
      return total
    }
    expect(conceded(0)).toBeLessThan(conceded(500))
  })

  it('예약 뒤 퇴장한 선수는 교체가 되살리지 않는다', () => {
    const accumulatedCards = PROBLEMS.find((problem) => problem.id === 'p03')!
    const cases = [
      [83502, 'DF03'],
      [83510, 'DF04'],
      [83539, 'MF10'],
      [83540, 'DF03'],
      [83543, 'DF02'],
      [83568, 'DF03'],
    ] as const

    for (const [seed, outgoing] of cases) {
      const problem = { ...accumulatedCards, seed }
      const rng = createRng(seed)
      let state = createState(problem)

      // 1틱에 교체를 예약한다. 6초 안에 나갈 선수가 두 번째 경고로
      // 퇴장하는 직접 재현 시드들이다.
      state = tick(state, rng)
      state = {
        ...state,
        subsLeft: state.subsLeft - 1,
        pendingSubs: [{
          out: outgoing,
          in: 'DF15',
          atTick: state.tick + EVENTS.subDelayTicks,
        }],
      }
      while (state.tick <= 1 + EVENTS.subDelayTicks) state = tick(state, rng)

      expect(
        state.log.some((event) => event.kind === 'SEND_OFF' && event.target === outgoing),
        `${seed}: 예약한 선수가 먼저 퇴장해야 한다`,
      ).toBe(true)
      expect(state.players.find((player) => player.id === outgoing)?.out).toBe(true)
      expect(state.players.find((player) => player.id === 'DF15')?.onPitch).toBe(false)
      expect(
        state.log.some((event) => event.kind === 'SUB' && event.target === 'DF15'),
      ).toBe(false)
      expect(state.homeCount, `${seed}: 퇴장 뒤 인원`).toBe(10)
    }
  })

  it.each([40712, 40729])(
    '시드 %i에서 필드 선수와 골키퍼의 양방향 교체를 막고 골키퍼끼리만 허용한다',
    (seed) => {
      const state = createState({ ...P, seed })

      expect(checkSub(state, 'DF04', 'GK12')).not.toBeNull()
      expect(checkSub(state, 'GK01', 'DF15')).not.toBeNull()
      expect(checkSub(state, 'GK01', 'GK12')).toBeNull()
    },
  )
})

describe('한 틱의 사건 우선순위', () => {
  const collisionCases = [
    { problemId: 'p02', seed: 1831661670, tick: 212 },
    { problemId: 'p04', seed: 1662164807, tick: 470 },
  ]

  for (const sample of collisionCases) {
    it(`${sample.problemId} 시드 ${sample.seed}에서 양 팀 득점을 함께 확정하지 않는다`, () => {
      const problem = PROBLEMS.find((entry) => entry.id === sample.problemId)!
      const events = simulate({ ...problem, seed: sample.seed }, []).final.log.filter(
        (event) => event.tick === sample.tick,
      )
      const goals = events.filter(
        (event) => event.kind === 'GOAL' || event.kind === 'CONCEDE',
      )

      expect(goals).toHaveLength(1)
    })
  }

  it('반칙 판정 뒤 같은 틱의 일반 득점을 함께 확정하지 않는다', () => {
    const problem = PROBLEMS.find((entry) => entry.id === 'p04')!
    const events = simulate({ ...problem, seed: 2937000874 }, []).final.log.filter(
      (event) => event.tick === 524,
    )

    expect(events.some((event) => event.kind === 'FOUL')).toBe(true)
    expect(events.some((event) => event.kind === 'CARD')).toBe(true)
    expect(
      events.some((event) => event.kind === 'GOAL' || event.kind === 'CONCEDE'),
    ).toBe(false)
  })
})
