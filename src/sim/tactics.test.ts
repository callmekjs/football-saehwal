import { describe, it, expect } from 'vitest'
import { resolveCoefficients } from './tactics'
import type { Level, Tactics } from './types'

const t = (line: Level, press: Level, width: Level): Tactics => ({ line, press, width })

describe('resolveCoefficients', () => {
  it('전부 보통이면 승수가 1이다', () => {
    const c = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    expect(c.behind).toBeCloseTo(1.0)
    expect(c.steal).toBeCloseTo(1.0)
    expect(c.drain).toBeCloseTo(1.0)
    expect(c.setPiece).toBeCloseTo(1.0)
  })

  it('라인을 올리면 배후 위험과 진입 가치가 함께 오른다', () => {
    const high = resolveCoefficients(t(2, 1, 1), 'BALANCED', false)
    const mid = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    expect(high.behind).toBeGreaterThan(mid.behind * 1.5)
    expect(high.entryXg).toBeGreaterThan(mid.entryXg)
    expect(high.setPiece).toBeLessThan(mid.setPiece)
  })

  it('라인을 내리면 배후는 줄지만 세트피스가 크게 는다', () => {
    // 정확한 값이 아니라 방향과 크기를 본다. 세트피스 승수는 밸런싱에서
    // 조정되는 값이라 숫자를 박아두면 튜닝할 때마다 테스트가 깨진다.
    const low = resolveCoefficients(t(0, 1, 1), 'BALANCED', false)
    const mid = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    expect(low.behind).toBeLessThan(mid.behind * 0.6)
    expect(low.setPiece).toBeGreaterThan(mid.setPiece * 2)
  })

  it('상대가 뭉쳐 있을수록 넓게가 강해진다', () => {
    const parked = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', false)
    const open = resolveCoefficients(t(1, 1, 2), 'ALL_OUT', false)
    expect(parked.widthK).toBeGreaterThan(open.widthK)
    expect(parked.widthK).toBeCloseTo(1.35)
  })

  it('상대가 뭉쳐 있을 때 좁게는 손해다', () => {
    const c = resolveCoefficients(t(1, 1, 0), 'PARK_BUS', false)
    expect(c.widthK).toBeCloseTo(0.75)
  })

  it('상대가 올라와 있으면 폭의 차이가 크게 줄어든다', () => {
    // 절대값이 아니라 비율로 본다. 상대가 뭉쳐 있을 때와 열려 있을 때의
    // 폭 스프레드 차이가 이 축의 존재 이유이므로, 임의의 임계값보다
    // 두 상황의 대비를 재는 것이 설계 의도에 맞다.
    const spread = (m: 'PARK_BUS' | 'ALL_OUT') =>
      resolveCoefficients(t(1, 1, 2), m, false).widthK -
      resolveCoefficients(t(1, 1, 0), m, false).widthK

    expect(spread('ALL_OUT')).toBeLessThan(spread('PARK_BUS') * 0.5)
  })

  it('상대가 10명이면 더 뭉쳐서 넓게가 더 강해진다', () => {
    const eleven = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', false)
    const ten = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', true)
    expect(ten.widthK).toBeGreaterThanOrEqual(eleven.widthK)
    expect(ten.oppOpen).toBeLessThan(eleven.oppOpen)
  })

  it('강 압박은 탈취를 올리고 체력을 크게 태운다', () => {
    const c = resolveCoefficients(t(1, 2, 1), 'BALANCED', false)
    expect(c.steal).toBeCloseTo(1.4)
    expect(c.drain).toBeCloseTo(1.8)
    expect(c.foul).toBeCloseTo(1.5)
  })
})
