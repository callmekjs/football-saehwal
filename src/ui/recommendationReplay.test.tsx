/**
 * @vitest-environment jsdom
 *
 * 전반부터 권장안을 맡기면 사람이 누르지 않아도 두 반을 끝까지 가는지,
 * 그동안 저장 경로가 열리지 않는지 실제 경기 시계로 확인한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROBLEMS } from '../sim/problems'
import { advance, mount } from './domHarness'
import { MatchScreen } from './MatchScreen'

const problem = PROBLEMS.find((item) => item.id === 'p01')!

describe('권장안 시범 경기', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('전반과 후반을 자동으로 이어 뛰고 저장 콜백을 한 번도 열지 않는다', () => {
    const onFinish = vi.fn()
    const original = '{"do-not-touch":"사용자 경기"}'
    window.localStorage.setItem('saehwal.history.v1', original)
    const view = mount(
      <MatchScreen
        problem={problem}
        startHalf={1}
        mode="RECOMMENDATION"
        recommendationRate={0.76}
        onExit={() => undefined}
        onFinish={onFinish}
      />,
    )

    expect(view.container.querySelector('.recommendation-banner')).not.toBeNull()
    expect(view.container.querySelector('.break-note')).toBeNull()
    expect(view.container.querySelector('.halftime')).toBeNull()

    advance(() => vi.advanceTimersByTime(75_100))

    // 전반 종료 효과가 곧바로 후반 0틱 권장안을 적용하고 후반을 시작한다.
    expect(view.container.querySelector('.recommendation-result')).toBeNull()
    expect(view.container.querySelector('.break-note')).toBeNull()
    expect(view.container.querySelector('.halftime')).toBeNull()

    advance(() => vi.advanceTimersByTime(75_100))

    const result = view.container.querySelector('.recommendation-result')
    expect(result?.textContent).toContain('권장안 시범 경기')
    expect(result?.textContent).toContain('76.0%')
    expect(result?.textContent).toContain('한 판의 결과와 별개')
    expect(view.container.querySelector('.match-report')).toBeNull()
    expect(onFinish).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('saehwal.history.v1')).toBe(original)

    view.unmount()
  })
})
