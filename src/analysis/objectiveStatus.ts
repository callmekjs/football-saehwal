import type { Objective } from '../sim/types'

export type ScoreStanding = 'AHEAD' | 'LEVEL' | 'BEHIND'

export interface ImmediateObjective {
  standing: ScoreStanding
  /** 지금 점수에서 목표 판정을 다시 만족하는 데 필요한 최소 득점 */
  goalsNeeded: number
  /** 경기 화면의 짧은 목표 이름 */
  label: string
  /** 급수 타임에서 주장이 점수 뒤에 붙여 말하는 문장 */
  briefing: string
  met: boolean
}

/**
 * 현재 점수와 국면 목표를 함께 읽는다.
 *
 * `SURVIVE`는 동점으로는 통과하지 못하므로, 동점이면 한 골, 한 골 뒤지면
 * 두 골이 필요하다. 경기 판정은 바꾸지 않고 `judge()`가 이미 쓰는 기준을
 * 사람이 읽을 말로만 옮긴다.
 */
export function immediateObjective(
  objective: Objective,
  score: readonly [number, number],
): ImmediateObjective {
  const [us, them] = score
  const standing: ScoreStanding = us > them ? 'AHEAD' : us < them ? 'BEHIND' : 'LEVEL'

  if (objective.type === 'SURVIVE') {
    const goalsNeeded = Math.max(0, them - us + 1)
    if (goalsNeeded === 0) {
      return {
        standing,
        goalsNeeded,
        label: '리드를 지켜라',
        briefing: '이대로 끝까지 지켜야 합니다.',
        met: true,
      }
    }
    return {
      standing,
      goalsNeeded,
      label: `${goalsNeeded}골을 넣어 다시 앞서라`,
      briefing: `다시 앞서려면 ${goalsNeeded}골이 필요합니다.`,
      met: false,
    }
  }

  const goalsNeeded = Math.max(0, them - us)
  if (goalsNeeded > 0) {
    return {
      standing,
      goalsNeeded,
      label: `${goalsNeeded}골을 넣어 따라가라`,
      briefing: `최소 동점까지 ${goalsNeeded}골이 필요합니다.`,
      met: false,
    }
  }
  return {
    standing,
    goalsNeeded,
    label: standing === 'AHEAD' ? '앞선 채 끝내라' : '동점을 지켜라',
    briefing: '이 상태로 끝까지 지켜야 합니다.',
    met: true,
  }
}
