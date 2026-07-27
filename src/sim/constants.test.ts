import { describe, it, expect } from 'vitest'
import { LINE, BASE, TOTAL_TICKS } from './constants'

/**
 * 이 테스트의 목적은 값이 맞는지가 아니라, 누가 실수로 값을 바꿨을 때
 * 알아채는 것이다. 8월 1일 동결 이후 특히 중요하다.
 */
describe('동결 대상 상수', () => {
  it('총 틱은 750이다', () => {
    expect(TOTAL_TICKS).toBe(750)
  })

  it('라인 낮음의 세트피스 증가가 배후 감소를 압도한다', () => {
    // 이 부등식이 깨지면 "잠글수록 맞는다"가 성립하지 않고
    // 라인 낮음이 전 국면 지배 전략이 되어 국면 2·4가 죽는다.
    const low = LINE[0]
    const behindSaved = BASE.B0 * (1 - low.behind)
    const setPieceAdded = BASE.S0 * (low.setPiece - 1)
    expect(setPieceAdded).toBeGreaterThan(behindSaved)
  })

  it('라인 3단계의 배후 승수가 단조 증가한다', () => {
    expect(LINE[0].behind).toBeLessThan(LINE[1].behind)
    expect(LINE[1].behind).toBeLessThan(LINE[2].behind)
  })
})
