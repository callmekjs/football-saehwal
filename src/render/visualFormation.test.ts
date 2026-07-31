import { describe, expect, it } from 'vitest'
import { FREE_POSITION } from '../sim/constants'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { effectivePos, formationRoleOf } from '../sim/squad'
import { changeFormation } from '../ui/useMatch'
import { VisualMatch } from './visual'

const stateOf = (id: string) => {
  const problem = PROBLEMS.find((entry) => entry.id === id)!
  return { problem, state: createState(problem) }
}

describe('중앙 경기장의 포메이션 배치', () => {
  it('수비수 결원 열 명은 공격수 11번까지 앞선에 남긴다', () => {
    const { problem, state: rolled } = stateOf('p04')
    /**
     * 앞 감독의 지시를 걷어내고 대형만 본다. 지시는 판마다 다른 선수에게
     * 걸리고 `PUSH_UP` 하나면 중원이 앞선으로 세어진다. 여기서 볼 것은
     * **한 명이 빠진 대형의 줄 수**이지 그 무작위가 아니다.
     */
    const state = {
      ...rolled,
      players: rolled.players.map((player) => ({
        ...player,
        order: 'NONE' as const,
        position: null,
      })),
    }
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

  it('5-4-1의 다섯 번째 수비 자리는 화면과 계산에서 모두 수비 역할이다', () => {
    const { problem, state: base } = stateOf('p02')
    const changed = changeFormation(base, '5-4-1').next
    const visual = new VisualMatch(changed, problem.seed)
    const stateEleven = changed.players.find((player) => player.id === 'FW11')!
    const shownEleven = visual.players.find(
      (player) => player.side === 'HOME' && player.num === 11,
    )!

    expect(formationRoleOf(stateEleven)).toBe('DF')
    expect(effectivePos(stateEleven)).toBe('DF')
    expect(shownEleven.pos).toBe('DF')
    expect(shownEleven.homeX).toBe(26)
  })

  it('자유 좌표를 중앙 경기장의 기준 자리로 그대로 쓴다', () => {
    const { problem, state: base } = stateOf('p02')
    const position = {
      x: FREE_POSITION.pitch.maxX,
      y: FREE_POSITION.pitch.minY,
    }
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === 'MF06' ? { ...player, position } : player,
      ),
    }
    const visual = new VisualMatch(base, problem.seed)
    visual.sync(state)
    const six = visual.players.find((player) => player.side === 'HOME' && player.num === 6)!

    expect(six.homeX).toBe(position.x)
    expect(six.homeY).toBe(position.y)
    expect(six.pos).toBe('FW')

    // 팀 라인·폭을 바꿔도 손으로 놓은 선수의 기준 자리는 덮어쓰지 않는다.
    visual.sync({
      ...state,
      tactics: { ...state.tactics, line: 2, width: 2 },
    })
    expect(six.homeX).toBe(position.x)
    expect(six.homeY).toBe(position.y)
  })
})
