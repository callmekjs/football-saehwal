import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import type { MatchState } from '../sim/types'
import { buildSurvivalStory } from './survivalStory'

function stateWith(
  base: MatchState,
  patch: Partial<MatchState>,
): MatchState {
  return { ...base, ...patch }
}

describe('사활 복기', () => {
  it('같은 시각의 여러 결정을 하나의 대응 묶음으로 만든다', () => {
    const problem = PROBLEMS[0]
    const initial = createState(problem)
    const final = stateWith(initial, { score: [1, 1], log: [] })
    const story = buildSurvivalStory({
      problem,
      initialState: initial,
      finalState: final,
      decisions: [
        { tick: 20, type: 'FORMATION', value: '5-4-1' },
        { tick: 20, type: 'PRESS', value: 2 },
      ],
      kickoffHalf: 2,
      passed: true,
    })

    expect(story.response.beats).toHaveLength(1)
    expect(story.response.beats[0].items).toEqual(['5-4-1 전환', '압박 강'])
  })

  it('결정이 없으면 대응을 지어내지 않는다', () => {
    const problem = PROBLEMS[0]
    const initial = createState(problem)
    const story = buildSurvivalStory({
      problem,
      initialState: initial,
      finalState: initial,
      decisions: [],
      kickoffHalf: 2,
      passed: false,
    })

    expect(story.response.beats).toEqual([])
  })

  it('데이터 기본값 대신 이 판의 실제 시작 상태를 위기에 반영한다', () => {
    const problem = PROBLEMS[0]
    const created = createState(problem)
    const players = created.players.map((player, index) => ({
      ...player,
      stamina: index === 0 ? 20 : 60,
      booked: index === 0,
      order: index === 1 ? ('PUSH_UP' as const) : player.order,
    }))
    const initial = stateWith(created, {
      formation: '3-4-3',
      homeCount: 10,
      players,
    })
    const story = buildSurvivalStory({
      problem,
      initialState: initial,
      finalState: initial,
      decisions: [],
      kickoffHalf: 2,
      passed: false,
    })

    expect(story.crisis.inheritedSetup).toBe('3-4-3')
    expect(story.crisis.homeCount).toBe(10)
    expect(story.crisis.bookedCount).toBeGreaterThanOrEqual(1)
    expect(story.crisis.inheritedOrders).toBeGreaterThanOrEqual(1)
    expect(story.crisis.meanStamina).not.toBe(100)
  })

  it('추격 경기의 동점 골을 목표선 진입으로 표시한다', () => {
    const problem = PROBLEMS.find((item) => item.objective.type === 'EQUALIZE')!
    const initial = createState(problem)
    const final = stateWith(initial, {
      score: [problem.score[0] + 1, problem.score[1]],
      log: [{ tick: 300, kind: 'GOAL' }],
    })
    const story = buildSurvivalStory({
      problem,
      initialState: initial,
      finalState: final,
      decisions: [],
      kickoffHalf: 2,
      passed: true,
    })

    expect(story.flow.integrity).toBe('VERIFIED')
    expect(story.flow.events[0].objectiveShift).toBe('ENTERED')
  })

  it('지키는 경기의 동점 실점을 목표선 이탈로 표시한다', () => {
    const problem = PROBLEMS.find((item) => item.objective.type === 'SURVIVE')!
    const initial = createState(problem)
    const final = stateWith(initial, {
      score: [problem.score[0], problem.score[1] + 1],
      log: [{ tick: 410, kind: 'CONCEDE' }],
    })
    const story = buildSurvivalStory({
      problem,
      initialState: initial,
      finalState: final,
      decisions: [],
      kickoffHalf: 2,
      passed: false,
    })

    expect(story.flow.integrity).toBe('VERIFIED')
    expect(story.flow.events[0].objectiveShift).toBe('LEFT')
  })

  it('로그로 복원한 점수가 맞지 않으면 사건을 만들지 않는다', () => {
    const problem = PROBLEMS[0]
    const initial = createState(problem)
    const final = stateWith(initial, { score: [9, 9], log: [] })
    const story = buildSurvivalStory({
      problem,
      initialState: initial,
      finalState: final,
      decisions: [],
      kickoffHalf: 2,
      passed: false,
    })

    expect(story.flow.integrity).toBe('UNAVAILABLE')
    expect(story.flow.events).toEqual([])
  })
})
