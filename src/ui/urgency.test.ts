import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { TOTAL_TICKS } from '../sim/constants'
import { clockRatio, clockTone, secondsLeft, urgencyOf } from './urgency'
import type { MatchState } from '../sim/types'

const P = PROBLEMS[0]
const base = (): MatchState => createState(P)

/** 피치 위 선수 전원의 체력을 정한다 */
const withStamina = (state: MatchState, stamina: number): MatchState => ({
  ...state,
  players: state.players.map((s) => (s.onPitch && !s.out ? { ...s, stamina } : s)),
})

describe('지금 위험 — 한 줄만 고른다', () => {
  it('평온할 때는 균형을 유지한다고 말한다', () => {
    const calm: MatchState = {
      ...withStamina(base(), 90),
      tactics: { line: 1, press: 1, width: 1 },
      stats: { ...base().stats, homeShot: 3, awayShot: 3 },
    }
    expect(urgencyOf(calm)).toMatchObject({ id: 'calm', tone: 'CALM' })
  })

  it('되돌릴 수 없는 위험이 가장 먼저다', () => {
    /**
     * 퇴장은 되돌릴 수 없고 교체는 되돌릴 수 있다. 그래서 압박+체력이
     * 라인·평균체력보다 위에 있어야 한다. 순서가 곧 설계다.
     */
    const state: MatchState = {
      ...withStamina(base(), 30),
      // 라인 낮음과 평균 체력 미달도 동시에 참이지만 이게 이겨야 한다
      tactics: { line: 0, press: 2, width: 1 },
    }
    expect(urgencyOf(state).id).toBe('press-spent')
    expect(urgencyOf(state).tone).toBe('DANGER')
  })

  it('압박이 강해도 지친 선수가 없으면 퇴장 경고를 안 한다', () => {
    // 겁을 주는 것이 아니라 지금 참인 것만 말한다
    const state: MatchState = {
      ...withStamina(base(), 90),
      tactics: { line: 1, press: 2, width: 1 },
      stats: { ...base().stats, homeShot: 3, awayShot: 3 },
    }
    expect(urgencyOf(state).id).not.toBe('press-spent')
  })

  it('상대가 뚜렷이 더 두드리면 배후부터 막으라고 한다', () => {
    const state: MatchState = {
      ...withStamina(base(), 90),
      tactics: { line: 1, press: 1, width: 1 },
      stats: { ...base().stats, homeShot: 1, awayShot: 5 },
    }
    expect(urgencyOf(state)).toMatchObject({ id: 'outshot', tone: 'DANGER' })
  })

  it('한두 개 차이는 밀린 것으로 세지 않는다', () => {
    // 노이즈로 경고를 띄우면 감독이 경고를 안 믿게 된다
    const state: MatchState = {
      ...withStamina(base(), 90),
      tactics: { line: 1, press: 1, width: 1 },
      stats: { ...base().stats, homeShot: 2, awayShot: 4 },
    }
    expect(urgencyOf(state).id).not.toBe('outshot')
  })

  it('라인이 낮으면 세트피스 대가를 알려준다', () => {
    const state: MatchState = {
      ...withStamina(base(), 90),
      tactics: { line: 0, press: 1, width: 1 },
      stats: { ...base().stats, homeShot: 3, awayShot: 3 },
    }
    expect(urgencyOf(state)).toMatchObject({ id: 'low-line', tone: 'WARN' })
  })

  it('교체 카드가 없으면 교체하라고 하지 않는다', () => {
    /**
     * 할 수 없는 일을 시키면 그건 경고가 아니라 잔소리다. 카드가 없으면
     * 다른 말을 하거나 아무 말도 안 한다.
     */
    const tired: MatchState = {
      ...withStamina(base(), 40),
      tactics: { line: 1, press: 1, width: 1 },
      stats: { ...base().stats, homeShot: 3, awayShot: 3 },
    }
    expect(urgencyOf({ ...tired, subsLeft: 2 }).id).toBe('team-tired')
    expect(urgencyOf({ ...tired, subsLeft: 0 }).id).not.toBe('team-tired')
  })

  it('등급이 바뀌면 문장도 바뀐다', () => {
    /**
     * ★ 색만으로 구분하지 않는다는 규칙을 코드로 지킨다.
     *
     * 색을 못 가리는 사람에게 tone 은 존재하지 않는 정보다. 문장이 같은데
     * 색만 다르면 그 사람에게는 아무 일도 안 일어난 화면이다.
     */
    const seen = new Map<string, string>()
    const states: MatchState[] = [
      { ...withStamina(base(), 30), tactics: { line: 1, press: 2, width: 1 } },
      {
        ...withStamina(base(), 90),
        tactics: { line: 0, press: 1, width: 1 },
        stats: { ...base().stats, homeShot: 3, awayShot: 3 },
      },
      {
        ...withStamina(base(), 90),
        tactics: { line: 1, press: 1, width: 1 },
        stats: { ...base().stats, homeShot: 3, awayShot: 3 },
      },
    ]
    for (const s of states) {
      const u = urgencyOf(s)
      // 같은 문장이 두 등급에 걸쳐 나오면 안 된다
      expect(seen.has(u.text)).toBe(false)
      seen.set(u.text, u.tone)
    }
    expect(new Set(seen.values()).size).toBe(3)
  })

  it('어떤 상태에서도 반드시 한 줄은 나온다', () => {
    // 빈 화면이 되면 감독은 "고장났나" 를 먼저 생각한다
    for (const problem of PROBLEMS) {
      const u = urgencyOf(createState(problem))
      expect(u.text.length).toBeGreaterThan(0)
      expect(['DANGER', 'WARN', 'CALM']).toContain(u.tone)
    }
  })
})

describe('남은 시간', () => {
  it('킥오프에 75초, 종료에 0초다', () => {
    expect(secondsLeft(0)).toBe(75)
    expect(secondsLeft(TOTAL_TICKS)).toBe(0)
  })

  it('종료를 지나도 음수가 되지 않는다', () => {
    expect(secondsLeft(TOTAL_TICKS + 50)).toBe(0)
    expect(clockRatio(TOTAL_TICKS + 50)).toBe(0)
  })

  it('30초와 15초에서 급함이 바뀐다', () => {
    expect(clockTone(75)).toBe('CALM')
    expect(clockTone(31)).toBe('CALM')
    expect(clockTone(30)).toBe('WARN')
    expect(clockTone(16)).toBe('WARN')
    expect(clockTone(15)).toBe('DANGER')
    expect(clockTone(0)).toBe('DANGER')
  })

  it('진행 바는 1에서 0으로 줄어든다', () => {
    expect(clockRatio(0)).toBe(1)
    expect(clockRatio(TOTAL_TICKS / 2)).toBeCloseTo(0.5)
    expect(clockRatio(TOTAL_TICKS)).toBe(0)
  })
})
