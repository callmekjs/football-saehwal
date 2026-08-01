/**
 * @vitest-environment jsdom
 *
 * 급수 타임에 **배치판 카드로 교체를 끝낼 수 있는가.**
 *
 * 벤치에서 들어올 선수를 고르면 화면 위쪽이 「나갈 선수 선택」으로 바뀐다.
 * 그런데 그 문구 바로 아래에 있는, 화면에서 가장 크고 눈에 먼저 들어오는
 * 배치판 카드를 누르면 선수 상세만 열리고 교체 카드는 그대로였다. 오류
 * 문구조차 없었다 — 눌러도 아무 일이 없는 화면이었다.
 *
 * 그려진 마크업만 보는 검사로는 이 고장이 원리적으로 안 잡힌다. 버튼은
 * 분명히 거기 있었다. 실제로 눌러 봐야 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatchScreen } from './MatchScreen'
import { click, mount } from './domHarness'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'

/** 교체 카드 세 장짜리 국면. 3 → 2 가 되는 것을 눈으로 셀 수 있다 */
const PROBLEM = PROBLEMS.find((problem) => problem.id === 'p01')!

/**
 * 등번호로 찾는다. 사람이 화면에서 하는 일과 같다.
 *
 * 글자 포함으로 찾으면 5를 찾다가 15·25에 걸린다. 등번호 칸만 정확히 본다.
 */
function byNum(
  root: ParentNode,
  selector: string,
  numSelector: string,
  num: number,
): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(selector)].find(
    (el) => el.querySelector(numSelector)?.textContent?.trim() === String(num),
  )
}

const boardCard = (root: ParentNode, num: number) =>
  byNum(root, 'button.squad-card', '.squad-num', num)
const benchChip = (root: ParentNode, num: number) =>
  byNum(root, 'button.bench-chip', '.bench-num', num)
const benchTitle = (root: ParentNode) =>
  root.querySelector('.bench-panel h2')?.textContent ?? ''

function openMatch() {
  return mount(<MatchScreen problem={PROBLEM} startHalf={2} onExit={() => undefined} />)
}

describe('급수 타임 · 배치판 카드로 교체하기', () => {
  /**
   * 가짜 시계로 둔다.
   *
   * 급수 타임에는 시계가 멈춰 있어 경기가 흐르지 않지만, 관전 화면은
   * 자기 박자로 돌면서 점수판을 갱신한다. 검사가 그 박자와 겹치면
   * 교체와 무관한 곳에서 상태가 바뀌어 무엇을 재는 검사인지 흐려진다.
   */
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('벤치 15번을 고른 뒤 배치판 5번을 누르면 실제로 맞바뀐다', () => {
    const view = openMatch()
    const before = createState(PROBLEM).subsLeft
    expect(before).toBe(3)
    expect(benchTitle(view.container)).toContain(`교체 카드 ${before}장`)

    // ① 벤치에서 들어올 15번을 고른다
    click(benchChip(view.container, 15)!)
    expect(benchTitle(view.container)).toContain('나갈 선수 선택')
    // 배치판도 지금 무엇을 묻고 있는지 말한다
    expect(view.container.querySelector('.sub-wait')?.textContent).toContain('15번이 들어옵니다')

    // ② 배치판의 5번을 누른다. 전에는 여기서 선수 상세만 열렸다
    const five = boardCard(view.container, 5)
    expect(five).toBeDefined()
    click(five!)

    // ③ 경기장에는 15번이 있고 ④ 5번은 빠져 벤치 쪽 줄로 내려간다
    expect(boardCard(view.container, 15)).toBeDefined()
    expect(boardCard(view.container, 5)).toBeUndefined()
    expect(benchChip(view.container, 5)).toBeDefined()

    // ⑤ 교체 카드가 한 장 줄었다
    expect(benchTitle(view.container)).toContain(`교체 카드 ${before - 1}장`)
    // 두 단계가 끝났으니 「나갈 선수 선택」도 닫힌다
    expect(benchTitle(view.container)).not.toContain('나갈 선수 선택')

    view.unmount()
  })

  it('골키퍼도 배치판에서 같은 방법으로 바꾼다', () => {
    const view = openMatch()
    const before = createState(PROBLEM).subsLeft

    // 벤치 골키퍼 12번 → 선발 골키퍼 1번
    click(benchChip(view.container, 12)!)
    expect(benchTitle(view.container)).toContain('나갈 선수 선택')

    const keeper = boardCard(view.container, 1)
    expect(keeper).toBeDefined()
    click(keeper!)

    expect(boardCard(view.container, 12)).toBeDefined()
    expect(boardCard(view.container, 1)).toBeUndefined()
    expect(benchTitle(view.container)).toContain(`교체 카드 ${before - 1}장`)

    view.unmount()
  })

  it('골키퍼와 필드 선수를 맞바꾸려 하면 배치판에서도 거절한다', () => {
    // 배치판 길은 벤치 길과 **같은 문**을 지난다. 규칙이 두 벌이 되면
    // 한쪽으로는 막히는 교체가 다른 쪽으로는 통과한다
    const view = openMatch()
    const before = createState(PROBLEM).subsLeft

    // 12번은 골키퍼다. 필드 선수 5번과는 바꿀 수 없다
    click(benchChip(view.container, 12)!)
    click(boardCard(view.container, 5)!)

    expect(boardCard(view.container, 5)).toBeDefined()
    expect(boardCard(view.container, 12)).toBeUndefined()
    expect(benchTitle(view.container)).toContain(`교체 카드 ${before}장`)
    // 눌렀는데 아무 말이 없는 것이 원래 고장이었다. 이유를 말해야 한다
    expect(view.container.querySelector('.squad-note')?.textContent ?? '').toContain('골키퍼')

    view.unmount()
  })

  it('들어올 선수를 고르지 않았으면 평소처럼 선수 상세가 열린다', () => {
    const view = openMatch()

    expect(view.container.querySelector('.player-data-card')).toBeNull()
    click(boardCard(view.container, 5)!)

    const card = view.container.querySelector('.player-data-card')
    expect(card).not.toBeNull()
    expect(card?.getAttribute('aria-label')).toContain('5번')
    // 상세를 열었을 뿐이라 교체 카드는 그대로다
    expect(benchTitle(view.container)).toContain(`교체 카드 ${createState(PROBLEM).subsLeft}장`)

    view.unmount()
  })

  it('벤치 줄에서 고르는 기존 두 단계 교체도 그대로 된다', () => {
    const view = openMatch()
    const before = createState(PROBLEM).subsLeft

    click(benchChip(view.container, 15)!)
    // 「나갈 선수」 줄은 벤치 안에도 그대로 있다. 빠른 길이 하나 는 것이지
    // 원래 길이 사라진 것이 아니다
    const rows = [...view.container.querySelectorAll('.bench-row')]
    const outRow = rows[rows.length - 1]
    const five = byNum(outRow, 'button.bench-chip', '.bench-num', 5)
    expect(five?.textContent).toContain('체력')
    click(five!)

    expect(boardCard(view.container, 15)).toBeDefined()
    expect(benchTitle(view.container)).toContain(`교체 카드 ${before - 1}장`)

    view.unmount()
  })
})
