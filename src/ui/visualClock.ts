import { VisualMatch, type VisualAudioCue } from '../render/visual'
import type { MatchState } from '../sim/types'

/** 시뮬 한 틱이 관전 연출에서 차지하는 시간 */
const TICK_SECONDS = 0.1
/** 선수와 공의 물리를 한 번에 진행하는 폭 */
const STEP_SECONDS = 1 / 60

export interface VisualClockUpdate {
  cues: VisualAudioCue[]
  score: [number, number]
}

/**
 * 관전 연출의 시계.
 *
 * 이 시계는 `requestAnimationFrame`을 모른다. 화면을 그리는 프레임이
 * 멈춰도 일반 타이머가 이 시계를 진행하고, 다시 깨어났을 때 남은 시간을
 * 버리지 않고 이어 간다. 짧은 아웃 재개가 한 호출 안에서 생겼다가
 * 사라져도 `VisualMatch.audioCues`의 순번으로 반드시 전달된다.
 */
export class VisualClock {
  vm: VisualMatch
  private time = 0
  private cueSequence = 0

  constructor(
    state: MatchState,
    private readonly seed: number,
  ) {
    this.vm = new VisualMatch(state, seed)
  }

  /**
   * 최신 시뮬 시각을 향해 진행한다.
   *
   * 한 번에 처리할 양은 제한하지만 뒤처진 시간을 건너뛰지는 않는다.
   * 숨긴 탭이 오래 멈췄다가 돌아오면 여러 호출에 나눠 따라잡으며, 그
   * 사이에 생긴 소리 사건도 순서대로 남는다.
   */
  update(
    state: MatchState,
    maxAdvanceSeconds = 5,
    settlementSeconds = 0,
  ): VisualClockUpdate {
    const stateTarget = state.tick * TICK_SECONDS
    // 종료 직전 예약된 골은 시뮬 시계가 멈춘 뒤에도 실제 골 장면을
    // 마칠 시간이 필요하다. 이미 진행한 연출 시간을 뒤로 감지는 않는다.
    const target = Math.max(stateTarget + Math.max(0, settlementSeconds), this.time)

    // 같은 화면에서 다시 풀었다. 지난 경기의 연출과 사건 장부를 버린다.
    if (state.tick < 1 && this.time > 0.5) {
      this.vm = new VisualMatch(state, this.seed)
      this.time = stateTarget
      this.cueSequence = 0
    }

    this.vm.sync(state)
    let budget = Math.max(0, maxAdvanceSeconds)
    while (this.time + 1e-6 < target && budget > 0) {
      const step = Math.min(STEP_SECONDS, target - this.time, budget)
      this.vm.advance(state, step)
      this.time += step
      budget -= step
    }

    const cues = this.vm.audioCues.filter((cue) => cue.sequence > this.cueSequence)
    if (cues.length > 0) this.cueSequence = cues[cues.length - 1].sequence

    return {
      cues,
      score: [...this.vm.displayScore] as [number, number],
    }
  }
}
