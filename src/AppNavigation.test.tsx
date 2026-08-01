/**
 * @vitest-environment jsdom
 *
 * 첫 화면의 두 시작 길을 실제로 누른다. 「바로 킥오프」는 기본 선택으로
 * 급수 타임까지 한 번에 가고, PLAY의 01→02→03 준비 흐름은 그대로 남아야
 * 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { buildBriefing } from './analysis/briefing'
import { createState } from './sim/engine'
import { PROBLEMS } from './sim/problems'
import { click, find, mount } from './ui/domHarness'

describe('첫 화면 시작 길', () => {
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

  it('바로 킥오프 한 번으로 기본 경기의 급수 타임에 들어간다', () => {
    const view = mount(<App />)

    click(find(view.container, 'button.title-quick', '바로 킥오프'))

    expect(view.container.querySelector('.match-screen')).not.toBeNull()
    expect(view.container.querySelector('.break-note')).not.toBeNull()
    expect(find(view.container, 'button.kickoff-button', '경기 재개')).toBeDefined()

    view.unmount()
  })

  it('PLAY는 선수단부터 보는 기존 준비 흐름을 그대로 연다', () => {
    const view = mount(<App />)

    click(find(view.container, 'button.title-play', 'PLAY'))

    expect(view.container.querySelector('.kickoff-home')).not.toBeNull()
    expect(view.container.querySelector('.kickoff-layout')?.getAttribute('data-section')).toBe(
      'squad',
    )
    expect(view.container.querySelector('.step-bar')).not.toBeNull()

    view.unmount()
  })

  it('첫 화면과 국면 카드의 경고 수가 실제 급수 타임 상태와 같다', () => {
    const problem = PROBLEMS.find((item) => item.id === 'p02')!
    // 첫 시도에서 App이 미리 만드는 판과 같은 씨앗이다. KICK OFF를 누르면
    // attempt가 1이 되어 이 상태가 그대로 실제 경기 상태가 된다.
    const nextProblem = { ...problem, seed: problem.seed + 7919 }
    const expectedState = createState(nextProblem)
    const expectedCount = expectedState.players.filter(
      (player) => player.onPitch && !player.out && player.booked,
    ).length
    const expectedBriefing = buildBriefing(nextProblem, expectedState)
    const bookedLine = [...expectedBriefing.core, ...expectedBriefing.more].find(
      (line) => line.id === 'booked' || line.id === 'send-off-risk',
    )
    expect(expectedCount).toBeGreaterThan(0)
    expect(bookedLine).toBeDefined()

    const view = mount(<App />)

    expect(view.container.querySelector('.title-card-facts')?.textContent).toContain(
      `경고 ${expectedCount}명`,
    )

    click(find(view.container, 'button.title-play', 'PLAY'))
    click(find(view.container, 'button.step-next', '다음 · 상대 선택'))
    click(find(view.container, 'button.step-next', '다음 · 국면 선택'))

    const selectedCard = view.container.querySelector('.kickoff-situation[data-selected="true"]')
    expect(selectedCard?.textContent).toContain(`경고 ${expectedCount}명`)

    click(find(view.container, 'button.kickoff-button-main', 'KICK OFF'))
    expect(view.container.querySelector('.captain-brief')?.textContent).toContain(bookedLine!.text)

    view.unmount()
  })
})
