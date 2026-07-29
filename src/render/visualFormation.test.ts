import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { changeFormation } from '../ui/useMatch'
import { VisualMatch } from './visual'

const stateOf = (id: string) => {
  const problem = PROBLEMS.find((entry) => entry.id === id)!
  return { problem, state: createState(problem) }
}

describe('중앙 경기장의 포메이션 배치', () => {
  it('수비수 결원 열 명은 공격수 11번까지 앞선에 남긴다', () => {
    const { problem, state } = stateOf('p04')
    const visual = new VisualMatch(state, problem.seed)
    const home = visual.players.filter((player) => player.side === 'HOME')
    expect(home.filter((player) => player.pos === 'DF')).toHaveLength(3)
    expect(home.filter((player) => player.pos === 'MF')).toHaveLength(4)
    expect(home.filter((player) => player.pos === 'FW')).toHaveLength(2)
    expect(home.find((player) => player.num === 11)?.pos).toBe('FW')
  })

  it('4-4-2의 raw 자리 번호를 5-4-1에 그대로 쓰지 않는다', () => {
    const { problem, state: base } = stateOf('p02')
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === 'MF06' ? { ...player, order: 'PUSH_UP' as const } : player,
      ),
    }
    const visual = new VisualMatch(state, problem.seed)
    const changed = changeFormation(state, '5-4-1')
    visual.sync(changed.next)

    const six = visual.players.find((player) => player.side === 'HOME' && player.num === 6)!
    expect(six.pos).toBe('MF')
    expect(six.order).toBe('NONE')
  })
})
