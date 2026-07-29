import { describe, it, expect } from 'vitest'
import {
  addedTimeOf,
  clockOf,
  endLabel,
  halfLabel,
  inAddedTime,
  kickoffLabel,
  minuteAt,
  regulationEnd,
} from './matchClock'
import { TOTAL_TICKS } from '../sim/constants'

/**
 * 시계는 전반과 후반을 같은 규칙으로 다뤄야 한다.
 *
 * 이 계산이 세 파일에 흩어져 있었고 전부 "후반 90분"을 전제로 적혀
 * 있었다. 전반 국면을 넣는 순간 카드에는 "전반 32분"인데 종료 화면에는
 * "경기 종료"가 뜨는 식으로 갈린다.
 */
describe('경기 시계 — 전반과 후반', () => {
  it('정규 시간은 전반 45분 후반 90분이다', () => {
    expect(regulationEnd(1)).toBe(45)
    expect(regulationEnd(2)).toBe(90)
  })

  it('추가시간은 정규 시간을 넘긴 만큼이다', () => {
    // 전반 32분에 시작하면 47분에 끝나므로 45+2
    expect(addedTimeOf(32, 1)).toBe(2)
    expect(addedTimeOf(34, 1)).toBe(4)
    // 후반 76분에 시작하면 91분에 끝나므로 90+1
    expect(addedTimeOf(76, 2)).toBe(1)
    expect(addedTimeOf(80, 2)).toBe(5)
  })

  it('같은 시작 분이라도 반이 다르면 추가시간이 다르다', () => {
    // 반을 안 넘기면 45분이나 90분 중 하나로 고정돼 한쪽이 반드시 틀린다
    expect(addedTimeOf(32, 1)).not.toBe(addedTimeOf(32, 2))
  })

  it('킥오프 순간은 시작 분 그대로이고 끝은 15분 뒤다', () => {
    expect(minuteAt(0, 32)).toBe(32)
    expect(minuteAt(TOTAL_TICKS, 32)).toBe(47)
    expect(clockOf(0, 32)).toBe('32:00')
  })

  it('추가시간 진입을 반마다 다른 기준으로 판정한다', () => {
    // 전반 32분 시작 → 45분이 되는 지점이 13분 뒤, 즉 전체의 13/15
    const atFortyFive = Math.round(TOTAL_TICKS * (13 / 15))
    expect(inAddedTime(atFortyFive - 5, 32, 1)).toBe(false)
    expect(inAddedTime(atFortyFive + 5, 32, 1)).toBe(true)
    // 같은 틱이라도 후반 기준(90분)으로는 아직 한참 남았다
    expect(inAddedTime(atFortyFive + 5, 32, 2)).toBe(false)
  })

  it('시작하자마자 추가시간이 되지는 않는다', () => {
    expect(inAddedTime(0, 32, 1)).toBe(false)
    expect(inAddedTime(0, 76, 2)).toBe(false)
  })

  it('끝나는 순간에는 반드시 추가시간이다', () => {
    // 국면은 정규 시간을 넘겨 끝나도록 잡혀 있다
    expect(inAddedTime(TOTAL_TICKS, 32, 1)).toBe(true)
    expect(inAddedTime(TOTAL_TICKS, 76, 2)).toBe(true)
  })

  it('전반이 끝난 것과 경기가 끝난 것은 다른 말이다', () => {
    /**
     * 1-0으로 지고 있는 전반 종료 화면에 "경기 종료"라고 적으면 사용자는
     * 경기를 졌다고 읽는다. 아직 45분이 남아 있다
     */
    expect(endLabel(1)).toBe('전반 종료')
    expect(endLabel(2)).toBe('경기 종료')
    expect(endLabel(1)).not.toBe(endLabel(2))
  })

  it('반 이름과 시작 분 표기', () => {
    expect(halfLabel(1)).toBe('전반')
    expect(halfLabel(2)).toBe('후반')
    expect(kickoffLabel(32, 1)).toBe('전반 32분')
    expect(kickoffLabel(76, 2)).toBe('후반 76분')
  })
})
