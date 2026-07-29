import type { MatchState } from '../sim/types'

export interface OpponentView {
  mentality: MatchState['opponent']
  formation: MatchState['away']['formation']
}

export const opponentViewOf = (state: MatchState): OpponentView => ({
  mentality: state.opponent,
  formation: state.away.formation,
})

/**
 * 화면에 보여줄 상대 성향과 대형을 고른다.
 *
 * 엔진은 골이 확정된 틱에 상대 성향을 즉시 바꾸지만 점수판은 골 장면을
 * 기다린다. 이때 엔진 값을 바로 보여주면 상대 대형이 아직 안 보인 골을
 * 먼저 알려준다. 보이는 점수가 시뮬 점수를 따라온 뒤에만 새 정보를
 * 공개하고, 그 전에는 직전 화면을 유지한다.
 */
export function nextOpponentView(
  previous: OpponentView,
  state: MatchState,
  visibleScore: readonly [number, number],
): OpponentView {
  const caughtUp =
    visibleScore[0] === state.score[0] && visibleScore[1] === state.score[1]
  return caughtUp ? opponentViewOf(state) : previous
}

/** 상대 패널만 지연된 값을 읽게 하고 엔진 상태는 그대로 둔다 */
export function withOpponentView(state: MatchState, view: OpponentView): MatchState {
  if (state.opponent === view.mentality && state.away.formation === view.formation) {
    return state
  }
  return {
    ...state,
    opponent: view.mentality,
    away: { ...state.away, formation: view.formation },
  }
}
