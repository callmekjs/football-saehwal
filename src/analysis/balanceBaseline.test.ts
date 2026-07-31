import { describe, expect, it } from 'vitest'
import raw from '../data/problems.json' with { type: 'json' }
import { noActionRate, referenceNoActionRate } from './balanceBaseline'
import { OPPONENT_TEAMS, REFERENCE_TEAM } from './opponents'

describe('무개입 통과율 실측표', () => {
  it('모든 국면에 기준팀 측정값이 있고 합격선 아래다', () => {
    for (const problem of raw) {
      const rate = referenceNoActionRate(problem.id)
      expect(rate).toBeGreaterThanOrEqual(0)
      expect(rate).toBeLessThanOrEqual(0.5)
    }
  })

  it('열세 팀 × 다섯 국면이 하나도 비지 않는다', () => {
    for (const team of OPPONENT_TEAMS) {
      for (const problem of raw) {
        const rate = noActionRate(problem.id, team.id)
        expect(rate, `${team.name} ${problem.id}`).toBeGreaterThan(0)
        expect(rate, `${team.name} ${problem.id}`).toBeLessThan(1)
      }
    }
  })

  /**
   * 60% 를 넘으면 아무것도 안 해도 통과해서 감독이 판단할 것이 사라진다.
   * 이 저장소가 옛 난이도에서 한 번 겪고 정한 선이다.
   */
  it('어느 상대에서도 무개입 통과율이 60% 를 넘지 않는다', () => {
    for (const team of OPPONENT_TEAMS) {
      for (const problem of raw) {
        expect(
          noActionRate(problem.id, team.id),
          `${team.name} ${problem.id}`,
        ).toBeLessThan(0.6)
      }
    }
  })

  /**
   * 약한 상대일수록 아무것도 안 했을 때 더 많이 살아남아야 한다. 순서가
   * 뒤집히면 화면의 순위와 실제 체감이 어긋난다.
   */
  it('아래 순위 팀이 위 순위 팀보다 만만하다', () => {
    for (const problem of raw) {
      expect(noActionRate(problem.id, 'VIE'), problem.id).toBeGreaterThan(
        noActionRate(problem.id, 'ARG'),
      )
    }
  })

  it('기준팀 함수는 실제 기준팀을 본다', () => {
    for (const problem of raw) {
      expect(referenceNoActionRate(problem.id)).toBe(
        noActionRate(problem.id, REFERENCE_TEAM),
      )
    }
  })

  it('재지 않은 국면이나 상대를 조용히 0% 로 보여주지 않는다', () => {
    expect(() => referenceNoActionRate('없는-국면')).toThrow()
    // 타입을 우회해 들어온 값도 조용히 넘어가지 않아야 한다
    expect(() => noActionRate('p01', 'NOPE' as never)).toThrow()
  })
})
