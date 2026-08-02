import { describe, expect, it } from 'vitest'
import { createState } from './engine'
import { PROBLEMS } from './problems'
import {
  applyCaptainEffect,
  benchHasFasterDefender,
  BENCH_SPEED_EDGE,
  CAPTAIN_EFFECT_IDS,
} from './setup'
import { effectivePos, getPlayer, HOME_SQUAD, initialPlayers } from './squad'
import { MAX_ORDERS } from './engine'
import { OPPONENTS } from './constants'
import { PRESETS } from '../analysis/presets'
import type { Problem } from './types'

const seeds = (p: Problem, n: number) =>
  Array.from({ length: n }, (_, i) => createState({ ...p, seed: p.seed + i }))

describe('시작 조건 — 판마다 다르다', () => {
  it('같은 시드는 언제나 같은 선수단을 만든다', () => {
    /**
     * 이게 깨지면 `measure.ts`(시드 1200개)와 경기 후 분석(150판 비교)이
     * **둘 다 죽는다.** 두 곳 모두 같은 시드를 여러 번 돌려 조건을 비교한다.
     */
    for (const p of PROBLEMS) {
      const a = createState(p)
      const b = createState(p)
      expect(JSON.stringify(a.players), p.title).toEqual(JSON.stringify(b.players))
      expect(a.tactics, p.title).toEqual(b.tactics)
      expect(a.captainEffect, p.title).toBe(b.captainEffect)
    }
  })

  it('시드가 다르면 시작 조건이 실제로 달라진다', () => {
    for (const p of PROBLEMS) {
      const states = seeds(p, 12)
      const shapes = states.map((s) =>
        JSON.stringify([
          s.tactics,
          s.players.filter((x) => x.booked).map((x) => x.id),
          s.players.filter((x) => x.order !== 'NONE').map((x) => `${x.id}:${x.order}`),
          s.players.map((x) => x.stamina),
        ]),
      )
      // 열두 판이 전부 같으면 흔들리지 않는 것이다
      expect(new Set(shapes).size, `${p.title} 의 서로 다른 시작 조건 수`).toBeGreaterThan(8)
    }
  })

  it('후반 승부처의 상대도 이미 뛴 만큼 지친 상태로 시작한다', () => {
    for (const p of PROBLEMS) {
      for (const state of seeds(p, 120)) {
        expect(state.awayStamina, p.title).toBeLessThan(100)
      }
    }
  })

  it('같은 국면도 국가가 달라지면 상대 대형과 상태가 달라진다', () => {
    const problem = PROBLEMS[0]
    const encounters = OPPONENTS.teams.map(({ id }) => {
      const state = createState(problem, id)
      return JSON.stringify(state.away)
    })
    expect(new Set(encounters).size).toBeGreaterThan(5)
  })

  it('주장 보고 여섯 종류가 판마다 실제로 바뀐다', () => {
    for (const p of PROBLEMS) {
      const effects = new Set(seeds(p, 120).map((state) => state.captainEffect))
      expect(effects, p.title).toEqual(new Set(CAPTAIN_EFFECT_IDS))
    }
  })

  it('주장이 말한 대상의 실제 체력만 같은 방향으로 움직인다', () => {
    const baseProblem = PROBLEMS[0]
    const problem: Problem = { ...baseProblem }
    const base = initialPlayers(problem)
    const allUp = applyCaptainEffect(base, 'TEAM_RECOVERED')
    const allDown = applyCaptainEffect(base, 'TEAM_FATIGUED')
    const backUp = applyCaptainEffect(base, 'BACK_LINE_RECOVERED')
    const frontDown = applyCaptainEffect(base, 'FRONT_LINE_FATIGUED')

    for (const state of base) {
      const up = allUp.find((x) => x.id === state.id)!
      const down = allDown.find((x) => x.id === state.id)!
      if (state.onPitch && !state.out) {
        expect(up.stamina, state.id).toBeGreaterThan(state.stamina)
        expect(down.stamina, state.id).toBeLessThan(state.stamina)
      } else {
        expect(up.stamina, state.id).toBe(state.stamina)
        expect(down.stamina, state.id).toBe(state.stamina)
      }

      const pos = effectivePos(state)
      const back = backUp.find((x) => x.id === state.id)!
      const front = frontDown.find((x) => x.id === state.id)!
      if (state.onPitch && !state.out && pos === 'DF') {
        expect(back.stamina, state.id).toBeGreaterThan(state.stamina)
      } else {
        expect(back.stamina, state.id).toBe(state.stamina)
      }
      if (state.onPitch && !state.out && (pos === 'MF' || pos === 'FW')) {
        expect(front.stamina, state.id).toBeLessThan(state.stamina)
      } else {
        expect(front.stamina, state.id).toBe(state.stamina)
      }
    }

    const defender = base.find((x) => x.onPitch && getPlayer(x.id).pos === 'DF')!
    const midfielder = base.find((x) => x.onPitch && getPlayer(x.id).pos === 'MF')!
    const moved = base.map((state) => {
      if (state.id === defender.id) return { ...state, order: 'PUSH_UP' as const }
      if (state.id === midfielder.id) return { ...state, order: 'DROP_BACK' as const }
      return state
    })
    const movedBackUp = applyCaptainEffect(moved, 'BACK_LINE_RECOVERED')
    const movedFrontUp = applyCaptainEffect(moved, 'FRONT_LINE_RECOVERED')
    expect(movedBackUp.find((x) => x.id === defender.id)!.stamina)
      .toBe(defender.stamina)
    expect(movedFrontUp.find((x) => x.id === defender.id)!.stamina)
      .toBeGreaterThan(defender.stamina)
    expect(movedBackUp.find((x) => x.id === midfielder.id)!.stamina)
      .toBeGreaterThan(midfielder.stamina)
    expect(movedFrontUp.find((x) => x.id === midfielder.id)!.stamina)
      .toBe(midfielder.stamina)
  })

  it('흔들어도 국면의 정체성은 고정이다', () => {
    for (const p of PROBLEMS) {
      for (const s of seeds(p, 20)) {
        // 스코어·인원·목표는 국면이 정한다
        expect(s.score, p.title).toEqual(p.score)
        expect(s.awayCount, p.title).toBe(p.awayCount)
        expect(s.subsLeft, p.title).toBe(p.subsLeft)
        // 골키퍼는 언제나 정확히 한 명이다
        const gks = s.players.filter((x) => x.onPitch && !x.out && getPlayer(x.id).pos === 'GK')
        expect(gks, p.title).toHaveLength(1)
      }
    }
  })

  it('앞 감독이 남긴 전술은 언제나 이름 붙은 전술이 아니다', () => {
    /**
     * 이 시뮬레이션이 성립하는 조건이다. 중립이나 정상 전술에서 시작하면
     * **아무것도 안 해도 통과한다** — 실측으로 무개입 통과율이 77%까지
     * 올라간 적이 있다. 흔드는 것은 "어떻게 잘못 걸렸는지"이지
     * "잘못 걸렸는지 아닌지"가 아니다.
     */
    for (const p of PROBLEMS) {
      for (const s of seeds(p, 24)) {
        const named = PRESETS.find(
          (x) => x.v[0] === s.tactics.line && x.v[1] === s.tactics.press && x.v[2] === s.tactics.width,
        )
        expect(named?.name, `${p.title} 시작 전술이 "${named?.name}" 이 됐다`).toBeUndefined()
      }
    }
  })

  it('미리 걸린 지시는 감독이 쓸 자리를 남긴다', () => {
    for (const p of PROBLEMS) {
      for (const s of seeds(p, 20)) {
        const orders = s.players.filter((x) => x.order !== 'NONE')
        expect(orders.length, p.title).toBeLessThan(MAX_ORDERS)
        for (const o of orders) {
          // 골키퍼는 어떤 지시도 받지 않는다
          expect(getPlayer(o.id).pos, p.title).not.toBe('GK')
          // 물려받은 지시는 **잘못 걸린 것**이어야 한다. 골문 앞 지키기는
          // 지키는 판에서 실제로 이득이라 여기 들어오면 안 된다
          expect(o.order, p.title).not.toBe('HOLD')
          expect(o.onPitch, p.title).toBe(true)
        }
      }
    }
  })

  it('주장 효과가 더해져도 체력은 0~100을 벗어나지 않는다', () => {
    for (const p of PROBLEMS) {
      for (const s of seeds(p, 20)) {
        for (const x of s.players) {
          expect(x.stamina, `${p.title} ${x.id}`).toBeGreaterThanOrEqual(0)
          expect(x.stamina, `${p.title} ${x.id}`).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('경고 보유자는 반칙이 나오는 자리에서만 나온다', () => {
    for (const p of PROBLEMS) {
      for (const s of seeds(p, 20)) {
        for (const x of s.players.filter((y) => y.booked)) {
          const pos = getPlayer(x.id).pos
          expect(['DF', 'MF'], `${p.title} ${x.id} 가 ${pos} 인데 경고를 안고 있다`).toContain(pos)
        }
      }
    }
  })

  it('벤치에 선발보다 확실히 빠른 수비수가 남아 있다', () => {
    /**
     * "느린 수비수를 빠른 수비수로 교체한다"가 이 시뮬레이션의 대표
     * 승부처다. 이 부등식이 깨지면 그 판단이 원리적으로 사라진다.
     */
    expect(benchHasFasterDefender()).toBe(true)
    const starters = HOME_SQUAD.filter((p) => !p.onBench && p.pos === 'DF')
    const bench = HOME_SQUAD.filter((p) => p.onBench && p.pos === 'DF')
    expect(Math.max(...bench.map((p) => p.speed)) - Math.min(...starters.map((p) => p.speed)))
      .toBeGreaterThanOrEqual(BENCH_SPEED_EDGE)
  })
})
