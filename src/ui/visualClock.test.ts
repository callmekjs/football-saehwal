import { describe, expect, it } from 'vitest'
import { TOTAL_TICKS } from '../sim/constants'
import { createState, tick } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { createRng } from '../sim/rng'
import { VisualClock } from './visualClock'

describe('관전 소리 사건 시계', () => {
  it('느린 화면 한 번 사이에 생겼다가 끝난 아웃도 사건 장부에서 놓치지 않는다', () => {
    /**
     * 여러 판을 합쳐서 센다.
     *
     * 한 판만 보면 아웃이 대여섯 번뿐이라, 그 몇 번이 우연히 전부 깨어 있는
     * 순간에 걸리면 장부와 눈대중이 같은 수를 낸다. 그러면 장부가 실제로
     * 무엇을 더 잡는지 증명하지 못한 채 통과하거나 실패한다 — 재려는 것은
     * 아웃의 **빈도**가 아니라 **놓치지 않는 성질**이다. 표본을 늘려
     * 우연을 걷어낸다.
     */
    let outCues = 0
    let boundaryTransitions = 0

    for (const problem of PROBLEMS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const seeded = { ...problem, seed: problem.seed + attempt * 977 }
        const rng = createRng(seeded.seed)
        let state = createState(seeded)
        const clock = new VisualClock(state, seeded.seed)
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
          /**
           * **프리킥은 빼고 센다.** 아웃 소리는 프리킥에서 나지 않는다
           * (`beginRestart` 가 `kind !== 'FREE_KICK'` 일 때만 사건을 남긴다).
           * 반칙까지 같이 세면 아웃 사건 수를 반칙 수와 견주는 셈이 되어,
           * 장부가 무엇을 더 잡는지와 무관한 값이 비교된다.
           */
          const kind = clock.vm.restart?.kind ?? ''
          const restart = kind === 'FREE_KICK' ? '' : kind
          if (restart && restart !== lastRestart) boundaryTransitions += 1
          lastRestart = restart
        }
        outCues += clock.update(state, 100).cues.filter((cue) => cue.kind === 'OUT').length
      }
    }

    expect(outCues).toBeGreaterThan(0)
    // 눈대중으로 세면 놓치는 것이 반드시 있다. 그것이 장부를 둔 이유다
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
