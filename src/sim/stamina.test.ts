import { describe, it, expect } from 'vitest'
import { drainTick, effectiveFactor } from './stamina'
import { STAMINA, TOTAL_TICKS } from './constants'

describe('drainTick', () => {
  it('기준 계수로 750틱 돌면 약 22.5 소모한다', () => {
    let s = 100
    for (let i = 0; i < TOTAL_TICKS; i++) s = drainTick(s, 1.0)
    expect(100 - s).toBeCloseTo(22.5, 1)
  })

  it('강 압박이면 소모가 1.8배다', () => {
    let normal = 100
    let hard = 100
    for (let i = 0; i < TOTAL_TICKS; i++) {
      normal = drainTick(normal, 1.0)
      hard = drainTick(hard, 1.8)
    }
    expect(100 - hard).toBeCloseTo((100 - normal) * 1.8, 1)
  })

  it('0 아래로 내려가지 않는다', () => {
    let s = 5
    for (let i = 0; i < TOTAL_TICKS; i++) s = drainTick(s, 3.0)
    expect(s).toBe(0)
  })
})

describe('effectiveFactor', () => {
  it('체력 100이면 능력이 온전하다', () => {
    expect(effectiveFactor(100)).toBeCloseTo(1.0)
  })

  it('체력 0이면 바닥값에 절벽까지 걸린다', () => {
    expect(effectiveFactor(0)).toBeCloseTo(STAMINA.floorFactor * STAMINA.cliffPenalty)
  })

  it('절벽 아래에서 추가 페널티가 붙는다', () => {
    const above = effectiveFactor(STAMINA.cliff + 1)
    const below = effectiveFactor(STAMINA.cliff - 1)
    // 체력 차이는 2뿐인데 감소폭이 선형 기울기의 다섯 배를 넘는다
    const linearStep = STAMINA.rangeFactor / 100
    expect(above - below).toBeGreaterThan(linearStep * 5)
  })

  it('절벽 위에서는 단조 증가한다', () => {
    for (let s = 36; s < 100; s++) {
      expect(effectiveFactor(s + 1)).toBeGreaterThan(effectiveFactor(s))
    }
  })
})
