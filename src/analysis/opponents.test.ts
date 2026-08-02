import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { rollRoster } from '../sim/squad'
import { OPPONENT_DATA_NOTICE, homeAbilityAverage } from './opponents'

describe('상대 데이터 안내', () => {
  it('실제 참고값과 창작 계산값의 경계를 숨기지 않는다', () => {
    expect(OPPONENT_DATA_NOTICE).toContain('국가명과 참고 순위만')
    expect(OPPONENT_DATA_NOTICE).toContain('경기 계산에는 쓰이지 않습니다')
    expect(OPPONENT_DATA_NOTICE).toContain('창작 데이터')
    expect(OPPONENT_DATA_NOTICE).not.toContain('실제 월드컵 경기 데이터')
  })
})

describe('우리 팀 능력치 비교 기준', () => {
  it('고정 명단이 아니라 이 판에 다시 뽑힌 선발 능력을 읽는다', () => {
    const base = createState(PROBLEMS[0])
    const rerolled = createState(PROBLEMS[0], 'USA', undefined, rollRoster(1))

    expect(homeAbilityAverage(rerolled.players)).not.toBeCloseTo(
      homeAbilityAverage(base.players),
      5,
    )
    expect(homeAbilityAverage(rerolled.players, 'FW')).not.toBeCloseTo(
      homeAbilityAverage(base.players, 'FW'),
      5,
    )
  })
})
