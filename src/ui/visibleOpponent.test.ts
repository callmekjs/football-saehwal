import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import type { MatchState } from '../sim/types'
import {
  nextOpponentView,
  opponentViewOf,
  withOpponentView,
} from './visibleOpponent'

describe('점수 장면과 상대 정보의 공개 순서', () => {
  const before = createState(PROBLEMS.find((problem) => problem.id === 'p01')!)
  const previous = opponentViewOf(before)
  const afterGoal: MatchState = {
    ...before,
    score: [before.score[0] + 1, before.score[1]] as [number, number],
    opponent: before.opponent === 'ALL_OUT' ? 'PARK_BUS' : 'ALL_OUT',
    away: {
      ...before.away,
      formation: before.away.formation === '4-3-3' ? '5-4-1' : '4-3-3',
    },
  }

  it('시뮬 골만 확정되고 보이는 점수가 늦으면 직전 대형과 성향을 유지한다', () => {
    const held = nextOpponentView(previous, afterGoal, before.score)
    const visible = withOpponentView(afterGoal, held)

    expect(held).toEqual(previous)
    expect(visible.score).toEqual(afterGoal.score)
    expect(visible.opponent).toBe(before.opponent)
    expect(visible.away.formation).toBe(before.away.formation)
  })

  it('골 장면과 점수판이 따라온 뒤에만 새 대형과 성향을 공개한다', () => {
    const revealed = nextOpponentView(previous, afterGoal, afterGoal.score)

    expect(revealed).toEqual(opponentViewOf(afterGoal))
    expect(revealed).not.toEqual(previous)
  })
})
