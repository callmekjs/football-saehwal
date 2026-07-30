import { describe, expect, it } from 'vitest'
import { createState, simulate } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'

/**
 * 「같은 판 다시」가 성립하는 근거.
 *
 * 바둑 사활문제집의 기본 동작은 *"틀렸지? 같은 자리 다시 놔봐"* 다. 답을
 * 알고 같은 자리에 다시 앉아야 배운 것이 확인된다.
 *
 * 화면은 `App.tsx` 에서 **시드를 그대로 둔 채** 경기 화면만 다시 마운트해
 * 이것을 만든다. 그 전제가 여기 고정돼 있다 — 같은 시드는 언제나 같은
 * 시작 조건과 같은 결과를 낸다.
 *
 * **이 검사가 깨지면 「같은 판 다시」가 거짓말이 된다.** 버튼은 같은
 * 판이라고 말하는데 체력도 경고도 다른 판이 나온다.
 */

/** 화면이 새 판을 만들 때 시드를 옮기는 폭. `App.tsx` 와 같은 값이다 */
const NEW_MATCH_STEP = 7919

/** 시작 조건을 비교 가능한 한 덩어리로 */
const fingerprint = (problem: (typeof PROBLEMS)[number]) => {
  const s = createState(problem)
  return JSON.stringify({
    tactics: s.tactics,
    captain: s.captainEffect,
    away: s.away,
    players: s.players.map((p) => [p.id, p.stamina, p.booked, p.order, p.position]),
  })
}

describe('같은 판 다시 하기', () => {
  it('같은 시드는 시작 조건이 한 톨도 다르지 않다', () => {
    /**
     * 체력·경고·앞 감독이 걸어둔 지시·상대까지 전부 같아야 한다.
     * 하나라도 흔들리면 "판단만 바꿔봅니다"가 성립하지 않는다.
     */
    for (const problem of PROBLEMS) {
      expect(fingerprint(problem), problem.title).toBe(fingerprint(problem))
    }
  })

  it('같은 시드는 아무것도 안 했을 때 결과도 같다', () => {
    for (const problem of PROBLEMS) {
      const a = simulate(problem, [])
      const b = simulate(problem, [])
      expect(a.final.score, problem.title).toEqual(b.final.score)
      expect(a.passed, problem.title).toBe(b.passed)
    }
  })

  it('새 판은 실제로 다른 판이다', () => {
    /**
     * 두 갈래가 갈리는 것이 이 기능의 핵심이다. 새 판이 같은 판과 똑같이
     * 나오면 버튼이 둘일 이유가 없다.
     *
     * 실측으로 다섯 국면 전부가 달라지므로 전부를 요구한다. 하나라도
     * 같아지면 흔드는 폭(`variation`)이 좁아진 것이니 들여다봐야 한다.
     */
    const changed = PROBLEMS.filter((problem) => {
      const next = { ...problem, seed: problem.seed + NEW_MATCH_STEP }
      return fingerprint(problem) !== fingerprint(next)
    })
    expect(changed.length).toBe(PROBLEMS.length)
  })

  it('한 번 더 새 판을 눌러도 계속 다른 판이 나온다', () => {
    // 두 번째 재도전이 첫 번째와 같으면 두 번 눌러도 제자리다
    for (const problem of PROBLEMS) {
      const first = { ...problem, seed: problem.seed + NEW_MATCH_STEP }
      const second = { ...problem, seed: problem.seed + NEW_MATCH_STEP * 2 }
      expect(fingerprint(first), problem.title).not.toBe(fingerprint(second))
    }
  })
})
