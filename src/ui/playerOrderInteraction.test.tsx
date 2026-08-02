/**
 * @vitest-environment jsdom
 *
 * 경기 틱이 선수 상태 객체를 바꿔도, 사용자가 고른 선수 ID는 유지되어야 한다.
 * 카드가 저절로 닫히면 두 단계 탭의 두 번째 단계가 사라지고 실제 결정 기록도
 * 남지 않는다. 마크업만 그리는 검사로는 잡을 수 없어 시간을 흘려 직접 누른다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatchScreen } from './MatchScreen'
import { advance, click, find, mount } from './domHarness'
import { PROBLEMS } from '../sim/problems'
import type { FinishedMatch } from './recordMatch'

const PROBLEM = PROBLEMS.find((problem) => problem.id === 'p02')!

function boardCard(root: ParentNode, num: number): HTMLElement {
  const card = [...root.querySelectorAll<HTMLElement>('button.squad-card')].find(
    (entry) => entry.querySelector('.squad-num')?.textContent?.trim() === String(num),
  )
  if (!card) throw new Error(`${num}번 선수 카드를 찾을 수 없다`)
  return card
}

describe('경기 중 선수 선택과 행동 지시', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('여러 틱이 지나도 9번 선택과 무효 지시 사유를 유지한다', () => {
    const view = mount(
      <MatchScreen problem={PROBLEM} startHalf={2} onExit={() => undefined} />,
    )

    click(find(view.container, 'button.kickoff-button', '경기 재개'))
    click(boardCard(view.container, 9))
    expect(view.container.querySelector('.squad-orders .player-data-card')).not.toBeNull()

    // 예전 자동 해제(7초)를 넘기고, 그 사이 70회 넘는 상태 갱신도 통과한다.
    advance(() => vi.advanceTimersByTime(7_200))
    expect(view.container.querySelector('.squad-orders .player-data-card')).not.toBeNull()
    expect(boardCard(view.container, 9).getAttribute('aria-pressed')).toBe('true')

    // 9번은 이미 공격수다. 무효한 「올라가라」는 이유를 말하고 선택을
    // 유지해야, 감독이 같은 선수에게 다른 지시를 이어서 고를 수 있다.
    click(find(view.container, '.squad-order-grid button', '올라가라'))
    expect(view.container.querySelector('.squad-note')?.textContent).toContain(
      '이미 공격 줄에 서 있습니다',
    )
    expect(view.container.querySelector('.squad-orders .player-data-card')).not.toBeNull()

    view.unmount()
  })

  it('유효한 올라가라 지시를 경기 상태와 종료 결정 기록에 남긴다', () => {
    const finished: FinishedMatch[] = []
    const view = mount(
      <MatchScreen
        problem={PROBLEM}
        startHalf={2}
        onExit={() => undefined}
        onFinish={(match) => finished.push(match)}
      />,
    )

    click(find(view.container, 'button.kickoff-button', '경기 재개'))
    // 7번은 중원에 있고 물려받은 지시가 없어 공격 줄로 올릴 수 있다.
    click(boardCard(view.container, 7))
    click(find(view.container, '.squad-order-grid button', '올라가라'))

    expect(view.container.querySelector('.squad-orders .player-data-card')).toBeNull()
    expect(boardCard(view.container, 7).textContent).toContain('↑공격')
    expect(view.container.querySelector('.side-orders')?.textContent).toContain('7번 · 올라가라')
    const impact = view.container.querySelector('.toast small')?.textContent
    expect(impact).toContain('공격 기회')
    expect(impact).toContain('실점 위험')
    expect(impact).toContain('체력 소모')

    // 종료 보고서에 넘기는 결정 개수도 0이 아니어야 한다.
    advance(() => vi.advanceTimersByTime(75_100))
    expect(finished.length).toBeGreaterThan(0)
    expect(finished[0].decisions).toBeGreaterThan(0)

    view.unmount()
  })
})
