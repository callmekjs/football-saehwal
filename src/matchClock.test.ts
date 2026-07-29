import { describe, it, expect } from 'vitest'
import {
  BREAK_AT,
  BREAK_MINUTES,
  SEGMENT_MINUTES,
  addedTimeOf,
  breakLabel,
  breakStart,
  clockOf,
  endLabel,
  halfLabel,
  inAddedTime,
  kickoffMinute,
  minuteAt,
  regulationEnd,
  segmentEnd,
} from './matchClock'
import { TOTAL_TICKS } from './sim/constants'

/**
 * 시계는 전반과 후반을 같은 규칙으로 다뤄야 한다.
 *
 * 이 계산이 세 파일에 흩어져 있었고 전부 "후반 90분"을 전제로 적혀
 * 있었다. 전반을 고를 수 있게 되는 순간 카드와 종료 화면이 서로 다른
 * 시각을 말하게 된다.
 */
describe('경기 시계 — 전반과 후반의 급수 타임', () => {
  it('사용자가 정한 배치 그대로다 — 22분 급수 · 3분 · 재개 후 22분', () => {
    expect(BREAK_AT).toBe(22)
    expect(BREAK_MINUTES).toBe(3)
    expect(SEGMENT_MINUTES).toBe(22)
  })

  it('전반은 22분에 쉬고 25분에 재개해 47분에 끝난다', () => {
    expect(breakStart(1)).toBe(22)
    expect(kickoffMinute(1)).toBe(25)
    expect(segmentEnd(1)).toBe(47)
  })

  it('후반은 67분에 쉬고 70분에 재개해 92분에 끝난다', () => {
    expect(breakStart(2)).toBe(67)
    expect(kickoffMinute(2)).toBe(70)
    expect(segmentEnd(2)).toBe(92)
  })

  it('두 반이 같은 모양이다', () => {
    // 후반 급수 타임은 전반과 똑같이 그 반의 22분이다
    expect(breakStart(2) - regulationEnd(1)).toBe(breakStart(1))
  })

  it('정규 시간은 전반 45분 후반 90분이다', () => {
    expect(regulationEnd(1)).toBe(45)
    expect(regulationEnd(2)).toBe(90)
  })

  it('추가시간은 정규 시간을 넘긴 만큼이고 현실적인 범위 안이다', () => {
    for (const half of [1, 2] as const) {
      const added = addedTimeOf(half)
      expect(added).toBe(segmentEnd(half) - regulationEnd(half))
      expect(added, `${halfLabel(half)} 추가시간`).toBeGreaterThanOrEqual(1)
      expect(added, `${halfLabel(half)} 추가시간`).toBeLessThanOrEqual(5)
    }
  })

  it('킥오프 순간은 재개 분이고 끝은 22분 뒤다', () => {
    expect(minuteAt(0, 1)).toBe(25)
    expect(minuteAt(TOTAL_TICKS, 1)).toBe(47)
    expect(clockOf(0, 1)).toBe('25:00')
    expect(clockOf(0, 2)).toBe('70:00')
  })

  it('추가시간 진입을 반마다 다른 기준으로 판정한다', () => {
    // 전반 25:00 재개 → 45분까지 20분, 즉 전체 22분 중 20/22
    const atRegulation = Math.round(TOTAL_TICKS * (20 / 22))
    expect(inAddedTime(atRegulation - 8, 1)).toBe(false)
    expect(inAddedTime(atRegulation + 8, 1)).toBe(true)
  })

  it('시작하자마자 추가시간이 되지는 않는다', () => {
    expect(inAddedTime(0, 1)).toBe(false)
    expect(inAddedTime(0, 2)).toBe(false)
  })

  it('끝나는 순간에는 반드시 추가시간이다', () => {
    expect(inAddedTime(TOTAL_TICKS, 1)).toBe(true)
    expect(inAddedTime(TOTAL_TICKS, 2)).toBe(true)
  })

  it('전반이 끝난 것과 경기가 끝난 것은 다른 말이다', () => {
    /**
     * 0-1로 지고 있는 전반 종료 화면에 "경기 종료"라고 적으면 사용자는
     * 경기를 졌다고 읽는다. 아직 45분이 남아 있다
     */
    expect(endLabel(1)).toBe('전반 종료')
    expect(endLabel(2)).toBe('경기 종료')
    expect(endLabel(1)).not.toBe(endLabel(2))
  })

  it('반 이름과 급수 타임 표기', () => {
    expect(halfLabel(1)).toBe('전반')
    expect(halfLabel(2)).toBe('후반')
    expect(breakLabel(1)).toBe('전반 22분')
    expect(breakLabel(2)).toBe('후반 67분')
  })
})
