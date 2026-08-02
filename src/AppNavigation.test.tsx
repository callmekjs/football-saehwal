/**
 * @vitest-environment jsdom
 *
 * 첫 화면의 두 시작 길을 실제로 누른다. 「바로 킥오프」는 기본 선택으로
 * 급수 타임까지 한 번에 가고, 「경기 준비」의 01→02→03 흐름은 그대로 남아야
 * 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { buildBriefing } from './analysis/briefing'
import { createState } from './sim/engine'
import { PROBLEMS } from './sim/problems'
import { addRecord, readHistory, type MatchRecord } from './ui/matchHistory'
import { click, doubleClickThrough, find, mount } from './ui/domHarness'

const RECORD: MatchRecord = {
  at: 1_000,
  problemId: 'p01',
  problemTitle: '길이 막혔다',
  opponentId: 'USA',
  opponentName: '미국',
  half: 2,
  score: [1, 0],
  passed: true,
  decisions: 2,
  delta: 0.1,
}

function squadPlayer(root: ParentNode, num: number): HTMLElement {
  const hit = [...root.querySelectorAll<HTMLElement>('button.squad-pick-main')].find(
    (button) =>
      button.querySelector('.squad-pick-id b')?.textContent?.trim() === String(num),
  )
  if (!hit) throw new Error(`${num}번 선수 카드를 찾을 수 없다`)
  return hit
}

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

    const priority = view.container.querySelector('.title-priority')?.textContent ?? ''
    expect(priority).toContain('가장 큰 위험')
    expect(priority).toContain('목표')
    expect(priority).toContain('남은 교체')

    click(find(view.container, 'button.title-quick', '바로 킥오프'))

    expect(view.container.querySelector('.match-screen')).not.toBeNull()
    expect(view.container.querySelector('.break-note')).not.toBeNull()
    expect(find(view.container, 'button.kickoff-button', '경기 재개')).toBeDefined()

    const readyText = view.container.querySelector('.match-screen')?.textContent ?? ''
    expect(readyText).toContain('목표')
    expect(readyText).toContain('가장 큰 위험')
    expect(readyText).toContain('남은 교체')
    expect(readyText).toContain('급수')

    view.unmount()
  })

  it('경기 준비는 선수단부터 보는 기존 준비 흐름을 그대로 연다', () => {
    const view = mount(<App />)

    click(find(view.container, 'button.title-play', '경기 준비'))

    expect(view.container.querySelector('.kickoff-home')).not.toBeNull()
    expect(view.container.querySelector('.kickoff-layout')?.getAttribute('data-section')).toBe(
      'squad',
    )
    expect(view.container.querySelector('.step-bar')).not.toBeNull()

    view.unmount()
  })

  it('상대 선택은 고른 나라의 핵심과 세부 자료를 나눠 보여 준다', () => {
    const view = mount(<App />)

    click(find(view.container, 'button.title-play', '경기 준비'))
    click(find(view.container, 'button.step-next', '다음 · 상대 선택'))

    const teams = view.container.querySelectorAll('button.kickoff-team')
    expect(teams).toHaveLength(13)
    expect(view.container.querySelector('button.kickoff-team[aria-pressed="true"]')?.textContent)
      .toContain('선택')

    const usaLevels = Array.from(view.container.querySelectorAll('.opp-trait > span > b'))
      .map((node) => node.textContent)
      .join('|')

    click(find(view.container, 'button.kickoff-team', '일본'))

    const dossier = view.container.querySelector('.opp-dossier')?.textContent ?? ''
    const scouting = view.container.querySelector('.opp-scouting')?.textContent ?? ''
    expect(dossier).toContain('일본')
    expect(dossier).toContain('선택 완료')
    expect(dossier).toContain('상대 전력')
    expect(dossier).not.toContain('상대 전력 한눈에')
    expect(dossier).toMatch(/공격(?:강함|보통|약함)우리 \d+\.\d · 상대 \d+\.\d/)
    expect(dossier).toMatch(/수비(?:강함|보통|약함)우리 \d+\.\d · 상대 \d+\.\d/)
    expect(dossier).toMatch(/중원(?:강함|보통|약함)우리 \d+\.\d · 상대 \d+\.\d/)
    expect(dossier).not.toContain('상대가 주로 공격하는 방법')
    expect(dossier).not.toContain('결정력')
    expect(view.container.querySelectorAll('.opp-trait')).toHaveLength(3)
    const japanLevels = Array.from(view.container.querySelectorAll('.opp-trait > span > b'))
      .map((node) => node.textContent)
      .join('|')
    expect(japanLevels).not.toBe(usaLevels)
    expect(dossier).not.toContain('주요 선수')
    expect(scouting).toContain('주요 선수')
    expect(scouting).toContain('즐겨 서는 대형')
    expect(find(view.container, 'button.step-next', '다음 · 상황 선택')).toBeDefined()

    view.unmount()
  })

  it('명단을 다시 뽑으면 상대 비교의 우리 팀 기준도 함께 바뀐다', () => {
    const view = mount(<App />)

    click(find(view.container, 'button.title-play', '경기 준비'))
    click(find(view.container, 'button.step-next', '다음 · 상대 선택'))

    const homeAverage = () =>
      view.container.querySelector('.opp-compare > div:first-child > b')?.textContent
    const lineComparisons = () =>
      Array.from(view.container.querySelectorAll('.opp-trait p')).map(
        (node) => node.textContent,
      )

    const beforeAverage = homeAverage()
    const beforeLines = lineComparisons()

    click(find(view.container, 'button.step-back', '우리 팀'))
    click(find(view.container, 'button.squad-refresh', '명단 다시 뽑기'))
    click(find(view.container, 'button.step-next', '다음 · 상대 선택'))

    expect(homeAverage()).not.toBe(beforeAverage)
    expect(lineComparisons()).not.toEqual(beforeLines)
    expect(lineComparisons().every((text) => text?.includes('우리'))).toBe(true)
    expect(lineComparisons().every((text) => text?.includes('상대'))).toBe(true)

    view.unmount()
  })

  it('경기 준비 더블클릭의 두 번째 클릭이 새 선수단 카드로 관통하지 않는다', () => {
    const view = mount(<App />)
    const play = find(view.container, 'button.title-play', '경기 준비')

    // 첫 click이 선수단을 즉시 연 직후, 같은 화면 좌표의 두 번째 click과
    // dblclick이 새로 생긴 7번 카드에 도착하는 실제 브라우저 순서다.
    const seven = doubleClickThrough(
      play,
      () => squadPlayer(view.container, 7),
      { clientX: 248, clientY: 412 },
    )

    expect(view.container.querySelector('.kickoff-home')).not.toBeNull()
    expect(seven.getAttribute('aria-pressed')).toBe('false')

    // Enter·Space의 활성화 click(detail 0)은 빗장에 걸리지 않는다.
    click(seven)
    expect(squadPlayer(view.container, 7).getAttribute('aria-pressed')).toBe('true')

    view.unmount()
  })

  it('기록 지우기는 취소할 수 있고 최종 확인 뒤에만 로컬 기록을 없앤다', () => {
    addRecord(RECORD)
    const view = mount(<App />)
    click(find(view.container, 'button.title-history', '지난 기록'))
    expect(readHistory()).toHaveLength(1)
    expect(view.container.querySelector('.history-note')?.textContent).toContain('판단 횟수')
    expect(view.container.querySelector('.history-note')?.textContent).not.toContain('판단 n회')
    expect(view.container.textContent).toContain('오늘의 경기')
    expect(view.container.textContent).not.toContain('경기 안내')
    expect(view.container.textContent).not.toContain('MATCH DAY')
    expect(view.container.textContent).not.toContain('SAEHWAL FEED')

    click(find(view.container, 'button.history-clear', '기록 지우기'))
    expect(readHistory()).toHaveLength(1)
    expect(view.container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(document.activeElement?.classList.contains('history-clear-cancel')).toBe(true)

    click(find(view.container, 'button.history-clear-cancel', '취소'))
    expect(readHistory()).toHaveLength(1)
    expect(view.container.querySelector('[role="alertdialog"]')).toBeNull()

    click(find(view.container, 'button.history-clear', '기록 지우기'))
    click(find(view.container, 'button.history-clear-confirm-button', '모두 지우기'))
    expect(readHistory()).toHaveLength(0)
    expect(view.container.querySelector('.history-list')).toBeNull()
    expect(view.container.querySelector('.history-empty')?.textContent).toContain(
      '아직 기록이 없습니다',
    )

    view.unmount()
  })

  it('첫 화면과 국면 카드의 경고 수가 실제 급수 타임 상태와 같다', () => {
    const problem = PROBLEMS.find((item) => item.id === 'p02')!
    // 첫 시도에서 App이 미리 만드는 판과 같은 씨앗이다. 「경기 시작」을 누르면
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

    click(find(view.container, 'button.title-play', '경기 준비'))
    click(find(view.container, 'button.step-next', '다음 · 상대 선택'))
    click(find(view.container, 'button.step-next', '다음 · 상황 선택'))

    const situationCards = Array.from(
      view.container.querySelectorAll<HTMLElement>('.kickoff-situation'),
    )
    expect(situationCards).toHaveLength(5)
    for (const card of situationCards) {
      const text = card.textContent ?? ''
      expect(text).toContain('목표 달성 확률')
      expect(text).toContain('전 · 현재 전술 기준')
      expect(text).not.toMatch(
        /SURVIVE|EQUALIZE|제\d국면|목표 ·|아무것도 바꾸지 않으면|만 버팁니다/,
      )
    }

    const selectedCard = view.container.querySelector('.kickoff-situation[data-selected="true"]')
    expect(selectedCard?.textContent).toContain(`경고 ${expectedCount}명`)
    expect(view.container.querySelector('.kickoff-preview-badge')?.textContent?.trim()).toBe(
      '국면 재현',
    )

    // 퇴장 국면은 설명만 열 명이어서는 안 된다. 양쪽 미리보기 대형도 실제
    // 남은 인원과 같아야 한다.
    click(situationCards[3])
    expect(
      view.container.querySelectorAll('.kickoff-crest.home .opp-board-dot'),
    ).toHaveLength(10)
    expect(
      view.container.querySelectorAll('.kickoff-crest.away .opp-board-dot'),
    ).toHaveLength(11)

    click(situationCards[4])
    expect(
      view.container.querySelectorAll('.kickoff-crest.home .opp-board-dot'),
    ).toHaveLength(11)
    expect(
      view.container.querySelectorAll('.kickoff-crest.away .opp-board-dot'),
    ).toHaveLength(10)

    // 아래 급수 타임 검사는 원래 선택했던 상황 1을 기준으로 한다.
    click(situationCards[0])

    click(find(view.container, 'button.kickoff-button-main', '경기 시작'))
    expect(view.container.querySelector('.captain-brief')?.textContent).toContain(bookedLine!.text)

    view.unmount()
  })
})
