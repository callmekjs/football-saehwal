import { describe, it, expect } from 'vitest'
import {
  drainTick,
  effectiveFactor,
  halftimeRecoveryAmount,
  recoverAtHalftime,
} from './stamina'
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

describe('하프타임 체력 회복', () => {
  it('잃은 체력 25%보다 더 지친 선수를 덜 회복시키라는 최신 지시를 우선한다', () => {
    const exhausted = 10
    const fresh = 95
    // 옛 식은 더 지친 쪽을 크게 되살리므로 최신 지시와 함께 성립할 수 없다.
    const oldExhausted = (STAMINA.max - exhausted) * 0.25
    const oldFresh = (STAMINA.max - fresh) * 0.25
    expect(oldExhausted).toBeGreaterThan(oldFresh)
    expect(halftimeRecoveryAmount(exhausted)).toBeLessThan(
      halftimeRecoveryAmount(fresh),
    )
  })

  it('더 지친 선수가 더 많이 회복하는 구간이 없다', () => {
    /**
     * 사용자가 직접 검산하라고 정한 일곱 값이다. 표본 사이에 숨어 있는
     * 역전도 놓치지 않도록 10부터 95까지 0.25 간격도 함께 훑는다.
     */
    const requested = [10, 25, 40, 55, 70, 85, 95]
    const interval = Array.from({ length: 341 }, (_, index) => 10 + index * 0.25)
    for (const samples of [requested, interval]) {
      // 함수의 둘째 인자는 되돌림 비율이다. `map(함수)` 로 쓰면 배열
      // 인덱스가 비율로 넘어가므로 반드시 한 인자 콜백으로 감싼다.
      const recovery = samples.map((stamina) => halftimeRecoveryAmount(stamina))
      for (let index = 1; index < recovery.length; index++) {
        expect(
          recovery[index],
          `체력 ${samples[index - 1]} → ${samples[index]}`,
        ).toBeGreaterThanOrEqual(recovery[index - 1])
      }
    }
  })

  it('회복한 선수도 최대 체력에는 닿지 않는다', () => {
    for (const stamina of [10, 25, 40, 55, 70, 85, 95]) {
      expect(recoverAtHalftime(stamina), `체력 ${stamina}`).toBeLessThan(STAMINA.max)
    }
  })

  it('되돌림 스위치를 0으로 두면 회복량이 정확히 0이다', () => {
    for (const stamina of [10, 25, 40, 55, 70, 85, 95]) {
      expect(halftimeRecoveryAmount(stamina, 0)).toBe(0)
      expect(recoverAtHalftime(stamina, 0)).toBe(stamina)
    }
  })
})
