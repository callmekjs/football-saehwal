import { describe, expect, it } from 'vitest'
import { TOTAL_TICKS } from '../sim/constants'
import { createState, tick } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { createRng } from '../sim/rng'
import { VisualClock } from './visualClock'

describe('관전 소리 사건 시계', () => {
  it('느린 화면 한 번 사이에 생겼다가 끝난 아웃도 사건 장부에서 놓치지 않는다', () => {
    const problem = PROBLEMS.find((item) => item.id === 'p02')!
    const rng = createRng(problem.seed)
    let state = createState(problem)
    const clock = new VisualClock(state, problem.seed)
    let outCues = 0
    let boundaryTransitions = 0
    let lastRestart = ''

    /**
     * 2초마다 한 번만 깨운다. 아웃 재개는 0.35초라 이 사이에 생겼다가
     * 끝날 수 있다. 예전처럼 `restart`의 현재 값만 비교하면 놓치지만,
     * 순번이 있는 사건 장부는 모두 돌려준다.
     */
    for (let i = 0; i < TOTAL_TICKS; i++) {
      state = tick(state, rng)
      if ((i + 1) % 20 !== 0) continue
      const update = clock.update(state)
      outCues += update.cues.filter((cue) => cue.kind === 'OUT').length
      const restart = clock.vm.restart?.kind ?? ''
      if (restart && restart !== lastRestart) boundaryTransitions += 1
      lastRestart = restart
    }
    outCues += clock.update(state, 100).cues.filter((cue) => cue.kind === 'OUT').length

    expect(outCues).toBeGreaterThan(0)
    expect(outCues).toBeGreaterThan(boundaryTransitions)
  })

  it('숨긴 탭처럼 성긴 갱신이어도 들어간 골마다 함성 사건이 한 번씩 남는다', () => {
    const problem = PROBLEMS.find((item) => item.id === 'p02')!
    const rng = createRng(problem.seed)
    let state = createState(problem)
    const clock = new VisualClock(state, problem.seed)
    const sequences: number[] = []
    let goalCues = 0

    for (let i = 0; i < TOTAL_TICKS; i++) {
      state = tick(state, rng)
      if ((i + 1) % 20 !== 0) continue
      const update = clock.update(state)
      sequences.push(...update.cues.map((cue) => cue.sequence))
      goalCues += update.cues.filter((cue) => cue.kind === 'GOAL').length
    }
    const finalUpdate = clock.update(state, 100)
    sequences.push(...finalUpdate.cues.map((cue) => cue.sequence))
    goalCues += finalUpdate.cues.filter((cue) => cue.kind === 'GOAL').length

    const scoreIncrease =
      state.score[0] + state.score[1] - problem.score[0] - problem.score[1]
    expect(scoreIncrease).toBeGreaterThan(0)
    expect(goalCues).toBe(scoreIncrease)
    expect(new Set(sequences).size).toBe(sequences.length)
  })
})
