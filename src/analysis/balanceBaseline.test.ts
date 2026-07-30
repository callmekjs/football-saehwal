import { describe, expect, it } from 'vitest'
import raw from '../data/problems.json' with { type: 'json' }
import { referenceNoActionRate } from './balanceBaseline'

describe('홈 화면 무개입 통과율', () => {
  it('모든 국면에 측정값이 있고 전술 국면 합격선 아래다', () => {
    for (const problem of raw) {
      const rate = referenceNoActionRate(problem.id)
      expect(rate).toBeGreaterThanOrEqual(0)
      expect(rate).toBeLessThanOrEqual(0.5)
    }
  })

  it('측정하지 않은 국면을 조용히 0%로 보여주지 않는다', () => {
    expect(() => referenceNoActionRate('없는-국면')).toThrow()
  })
})
