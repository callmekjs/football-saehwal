import { describe, expect, it } from 'vitest'
import { OPPONENT_DATA_NOTICE } from './opponents'

describe('상대 데이터 안내', () => {
  it('실제 참고값과 창작 계산값의 경계를 숨기지 않는다', () => {
    expect(OPPONENT_DATA_NOTICE).toContain('국가명과 참고 순위만')
    expect(OPPONENT_DATA_NOTICE).toContain('경기 계산에는 쓰이지 않습니다')
    expect(OPPONENT_DATA_NOTICE).toContain('창작 데이터')
    expect(OPPONENT_DATA_NOTICE).not.toContain('실제 월드컵 경기 데이터')
  })
})
