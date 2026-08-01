import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import type { Objective } from '../sim/types'
import { buildBriefing } from './briefing'
import { buildHalftime } from './halftime'
import { immediateObjective } from './objectiveStatus'

const SURVIVE: Objective = { type: 'SURVIVE', bonusOnWin: false }

describe('현재 점수에 맞춘 즉시 목표', () => {
  it.each([
    {
      name: '앞서면 리드를 지키라고 한다',
      score: [2, 1] as const,
      label: '리드를 지켜라',
      briefing: '이대로 끝까지 지켜야 합니다.',
      goals: 0,
    },
    {
      name: '동점이면 한 골을 넣어 다시 앞서라고 한다',
      score: [1, 1] as const,
      label: '1골을 넣어 다시 앞서라',
      briefing: '다시 앞서려면 1골이 필요합니다.',
      goals: 1,
    },
    {
      name: '한 골 뒤지면 두 골을 넣어 다시 앞서라고 한다',
      score: [1, 2] as const,
      label: '2골을 넣어 다시 앞서라',
      briefing: '다시 앞서려면 2골이 필요합니다.',
      goals: 2,
    },
  ])('$name', ({ score, label, briefing, goals }) => {
    const result = immediateObjective(SURVIVE, score)

    expect(result.label).toBe(label)
    expect(result.briefing).toBe(briefing)
    expect(result.goalsNeeded).toBe(goals)
    expect(result.met).toBe(goals === 0)
  })

  it.each([
    { score: [2, 1] as const, briefing: '이대로 끝까지 지켜야 합니다.' },
    { score: [1, 1] as const, briefing: '다시 앞서려면 1골이 필요합니다.' },
    { score: [1, 2] as const, briefing: '다시 앞서려면 2골이 필요합니다.' },
  ])('SURVIVE $score 브리핑도 같은 판단을 말한다', ({ score, briefing }) => {
    const problem = PROBLEMS.find((item) => item.objective.type === 'SURVIVE')!
    const state = { ...createState(problem), score: [...score] as [number, number] }
    const line = buildBriefing(problem, state).core[0]

    expect(line.text).toContain(briefing)
    expect(line.tone).toBe(score[0] > score[1] ? 'FACT' : 'ALERT')
  })

  it('1 대 2 하프타임과 후반 급수 타임이 모두 두 골이 필요하다고 말한다', () => {
    const problem = PROBLEMS.find((item) => item.objective.type === 'SURVIVE')!
    const state = { ...createState(problem), score: [1, 2] as [number, number] }
    const halftimeGoal = buildHalftime(problem, state).lines.find((line) => line.id === 'goal')
    const breakGoal = buildBriefing(problem, state).core[0]

    expect(halftimeGoal?.text).toBe('역전당했습니다. 2골이 필요합니다.')
    expect(breakGoal.text).toContain('다시 앞서려면 2골이 필요합니다.')
  })
})
