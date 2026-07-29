import { describe, expect, it } from 'vitest'
import {
  BREAK_SECONDS,
  BREAK_WARN_SECONDS,
  breakMessage,
  breakRatio,
  breakRemaining,
  breakTone,
  formatBreak,
} from './breakClock'

describe('급수 타임 남은 시간', () => {
  it('시작하면 정확히 1분이다', () => {
    expect(BREAK_SECONDS).toBe(60)
    expect(breakRemaining(0)).toBe(60)
  })

  it('흐른 만큼 줄어든다', () => {
    expect(breakRemaining(10_000)).toBe(50)
    expect(breakRemaining(45_000)).toBe(15)
  })

  it('올림한다 — 마지막 1초가 온전히 보인다', () => {
    expect(breakRemaining(59_400)).toBe(1)
    expect(breakRemaining(59_990)).toBe(1)
  })

  it('다 흐르면 0에서 멈춘다. 음수로 내려가지 않는다', () => {
    expect(breakRemaining(60_000)).toBe(0)
    expect(breakRemaining(90_000)).toBe(0)
  })

  it('탭을 오래 비웠다 돌아와도 흐른 시간만으로 계산된다', () => {
    // 중간 호출이 하나도 없어도 결과가 같다 — 절대 시각 기준이라 그렇다
    expect(breakRemaining(37_500)).toBe(23)
  })
})

describe('경고 단계', () => {
  it('넉넉할 때는 조용하다', () => {
    expect(breakTone(60)).toBe('CALM')
    expect(breakTone(BREAK_WARN_SECONDS + 1)).toBe('CALM')
  })

  it('마지막 15초에 경고로 바뀐다', () => {
    expect(breakTone(BREAK_WARN_SECONDS)).toBe('WARN')
    expect(breakTone(1)).toBe('WARN')
  })

  it('0이면 끝났다', () => {
    expect(breakTone(0)).toBe('OVER')
  })

  it('경고 시점은 브리핑을 읽고 손을 옮길 만큼 남아 있다', () => {
    expect(BREAK_WARN_SECONDS).toBeGreaterThanOrEqual(10)
    expect(BREAK_WARN_SECONDS).toBeLessThan(BREAK_SECONDS / 2)
  })

  it('단계마다 다른 말을 한다 — 색만으로 구분하지 않는다', () => {
    const calm = breakMessage(60)
    const warn = breakMessage(5)
    const over = breakMessage(0)
    expect(new Set([calm, warn, over]).size).toBe(3)
    expect(warn).toContain('곧')
    expect(warn).toContain('현재 지시대로')
  })
})

describe('표시', () => {
  it('분:초로 적는다', () => {
    expect(formatBreak(60)).toBe('1:00')
    expect(formatBreak(47)).toBe('0:47')
    expect(formatBreak(9)).toBe('0:09')
    expect(formatBreak(0)).toBe('0:00')
  })

  it('음수가 들어와도 0으로 적는다', () => {
    expect(formatBreak(-3)).toBe('0:00')
  })

  it('막대는 0과 1 사이에 머문다', () => {
    expect(breakRatio(60)).toBe(1)
    expect(breakRatio(30)).toBe(0.5)
    expect(breakRatio(0)).toBe(0)
    expect(breakRatio(-5)).toBe(0)
    expect(breakRatio(99)).toBe(1)
  })
})
