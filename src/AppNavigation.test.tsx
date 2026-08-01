/**
 * @vitest-environment jsdom
 *
 * 첫 화면의 두 시작 길을 실제로 누른다. 「바로 킥오프」는 기본 선택으로
 * 급수 타임까지 한 번에 가고, PLAY의 01→02→03 준비 흐름은 그대로 남아야
 * 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
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
})
