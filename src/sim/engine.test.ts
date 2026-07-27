import { describe, it, expect } from 'vitest'
import { simulate, createState } from './engine'
import { TOTAL_TICKS } from './constants'
import type { Decision, Problem } from './types'

/** 국면 2 「잠긴 문」 — 앞 감독이 전부 잠가놓은 상태를 물려받는다 */
const P: Problem = {
  id: 'p02',
  title: '잠긴 문',
  order: 1,
  score: [1, 0],
  initialTactics: { line: 0, press: 0, width: 0 },
  homeCount: 11,
  awayCount: 11,
  seed: 40712,
  objective: { type: 'SURVIVE', bonusOnWin: false },
  minDefenderSpeed: 62,
  startStamina: { DF04: 62, MF06: 48, FW09: 71 },
}

describe('simulate — 결정론', () => {
  it('같은 시드와 같은 결정이면 완전히 같은 결과가 나온다', () => {
    const d: Decision[] = [{ tick: 100, type: 'LINE', value: 1 }]
    expect(simulate(P, d).final).toEqual(simulate(P, d).final)
  })

  it('결정을 하면 결과 분포가 달라진다', () => {
    // 한 시드만 비교하면 안 된다. 15분에 한두 골 나오는 경기라
    // 레버를 바꿔도 그 판의 스코어가 우연히 같을 수 있다.
    // 조작이 결과에 영향을 준다는 것은 여러 판을 모아야 드러난다.
    const tally = (decisions: Decision[]) => {
      let conceded = 0
      for (let s = 0; s < 200; s++) {
        conceded += simulate({ ...P, seed: 60000 + s }, decisions).final.score[1]
      }
      return conceded
    }
    expect(tally([{ tick: 0, type: 'LINE', value: 1 }])).not.toEqual(tally([]))
  })

  it('시드가 다르면 결과가 갈린다', () => {
    const a = simulate(P, [])
    const b = simulate({ ...P, seed: 40713 }, [])
    expect(a.final.score).not.toEqual(b.final.score)
  })
})

describe('simulate — 루프', () => {
  it('정확히 750틱 돈다', () => {
    expect(simulate(P, []).final.tick).toBe(TOTAL_TICKS)
  })

  it('물려받은 지시로 시작한다', () => {
    expect(createState(P).tactics).toEqual({ line: 0, press: 0, width: 0 })
  })

  it('결정이 지정한 틱에 반영된다', () => {
    expect(simulate(P, [{ tick: 300, type: 'PRESS', value: 2 }]).final.tactics.press).toBe(2)
  })

  it('상대 성향이 스코어에서 도출된다', () => {
    // 1-0으로 우리가 이기고 있으니 상대는 지고 있어 올라온다
    expect(createState(P).opponent).toBe('ALL_OUT')
  })

  it('SURVIVE는 동점을 허용하면 실패다', () => {
    // 1-0으로 이기다 1-1이 되면 리드를 지킨 것이 아니다.
    // 이 구분이 없으면 1골 차 리드가 완충재로 작용해
    // 무개입 통과율이 77%까지 올라가고 국면이 퍼즐이 아니게 된다.
    const r = simulate(P, [])
    expect(r.passed).toBe(r.final.score[0] > r.final.score[1])
  })

  it('EQUALIZE는 무승부부터 통과다', () => {
    const chasing: Problem = {
      ...P,
      score: [0, 1],
      objective: { type: 'EQUALIZE', bonusOnWin: true },
    }
    const r = simulate(chasing, [])
    expect(r.passed).toBe(r.final.score[0] >= r.final.score[1])
  })

  it('같은 경기를 SURVIVE로 보면 EQUALIZE보다 통과가 어렵다', () => {
    const rate = (type: 'SURVIVE' | 'EQUALIZE') => {
      let pass = 0
      for (let s = 0; s < 300; s++) {
        const p: Problem = { ...P, seed: 70000 + s, objective: { type, bonusOnWin: false } }
        if (simulate(p, []).passed) pass++
      }
      return pass / 300
    }
    expect(rate('SURVIVE')).toBeLessThan(rate('EQUALIZE'))
  })
})

describe('simulate — 국면 2의 반전', () => {
  const passRate = (decisions: Decision[], n = 300): number => {
    let pass = 0
    for (let s = 0; s < n; s++) {
      if (simulate({ ...P, seed: 40000 + s }, decisions).passed) pass++
    }
    return pass / n
  }

  it('잠금을 푸는 쪽이 방치보다 확실히 낫다', () => {
    const noop = passRate([])
    const fix = passRate([
      { tick: 0, type: 'LINE', value: 1 },
      { tick: 0, type: 'PRESS', value: 1 },
    ])
    expect(fix - noop).toBeGreaterThan(0.15)
  })
})
