import { describe, expect, it } from 'vitest'
import { verdict } from './AnalysisPanel'

describe('감독 분석 한 줄 총평', () => {
  it('사용자를 당신이라고 부르지 않고 판단의 영향을 바로 말한다', () => {
    const improved = verdict(0.05)
    const worsened = verdict(-0.05)
    const similar = verdict(0)

    expect(improved).toContain('성공 가능성이 분명히 커졌습니다')
    expect(worsened).toContain('그대로 뒀을 때보다 위험이 더 커졌습니다')
    expect(similar).toContain('성공 가능성이 비슷했습니다')
    expect([improved, worsened, similar].join(' ')).not.toContain('당신')
  })
})
