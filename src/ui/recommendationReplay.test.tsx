/**
 * @vitest-environment jsdom
 *
 * 전반부터 권장안을 맡기면 사람이 누르지 않아도 두 반을 끝까지 가는지,
 * 그동안 저장 경로가 열리지 않는지 실제 경기 시계로 확인한다.
 */
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROBLEMS } from '../sim/problems'
import { advance, mount } from './domHarness'
import { MatchScreen } from './MatchScreen'

const problem = PROBLEMS.find((item) => item.id === 'p01')!
const secondHalfProblem = PROBLEMS.find((item) => item.id === 'p02')!

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
      <StrictMode>
        <MatchScreen
          problem={problem}
          startHalf={1}
          mode="RECOMMENDATION"
          recommendationRate={0.76}
          onExit={() => undefined}
          onFinish={onFinish}
        />
      </StrictMode>,
    )

    expect(view.container.querySelector('.recommendation-banner')).not.toBeNull()
    expect(view.container.querySelector('.break-note')).toBeNull()
    expect(view.container.querySelector('.halftime')).toBeNull()
    advance(() => vi.advanceTimersByTime(0))
    expect(view.container.querySelector('.match-break')).toBeNull()
    expect(view.container.querySelector('.match-subs')).not.toBeNull()

    advance(() => vi.advanceTimersByTime(75_100))

    // 전반 종료 효과가 곧바로 후반 0틱 권장안을 적용하고 후반을 시작한다.
    advance(() => vi.advanceTimersByTime(0))
    expect(view.container.querySelector('.recommendation-result')).toBeNull()
    expect(view.container.querySelector('.break-note')).toBeNull()
    expect(view.container.querySelector('.halftime')).toBeNull()
    expect(view.container.querySelector('.match-break')).toBeNull()
    expect(view.container.querySelector('.match-subs')).not.toBeNull()

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

  it('실제 p02 후반 진입에서 권장 설정을 적용하고 READY를 즉시 벗어난다', () => {
    const view = mount(
      <StrictMode>
        <MatchScreen
          problem={secondHalfProblem}
          startHalf={2}
          mode="RECOMMENDATION"
          recommendationRate={0.7}
          onExit={() => undefined}
        />
      </StrictMode>,
    )

    // StrictMode의 두 번째 reset 효과까지 지난 뒤 예약된 0틱 적용을 실행한다.
    advance(() => vi.advanceTimersByTime(0))

    expect(view.container.querySelector('.match-break')).toBeNull()
    expect(view.container.querySelector('.match-subs')).not.toBeNull()
    expect(view.container.querySelector('.match-meta')?.textContent).toContain('4-3-3')
    expect(
      [...view.container.querySelectorAll('.lever-seg')].map((row) =>
        row.getAttribute('data-value'),
      ),
    ).toEqual(['1', '1', '2'])

    advance(() => vi.advanceTimersByTime(75_100))
    expect(view.container.querySelector('.recommendation-result')).not.toBeNull()

    view.unmount()
  })
})
