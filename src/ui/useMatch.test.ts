import { describe, expect, it } from 'vitest'
import { createState, simulate } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import type { Decision } from '../sim/types'
import { changeFormation } from './useMatch'

const problem = PROBLEMS.find((entry) => entry.id === 'p02')!

describe('포메이션 변경', () => {
  it('4-4-2에서 올라간 선수를 풀고 5-4-1을 새 모양 그대로 세운다', () => {
    const base = createState(problem)
    const state = {
      ...base,
      players: base.players.map((player) => {
        if (player.id === 'MF06') return { ...player, order: 'PUSH_UP' as const }
        if (player.id === 'DF04') return { ...player, order: 'HOLD' as const }
        if (player.id === 'MF07') return { ...player, order: 'CONSERVE' as const }
        return player
      }),
    }
    const changed = changeFormation(state, '5-4-1')

    expect(changed.next.formation).toBe('5-4-1')
    expect(changed.next.players.find((player) => player.id === 'MF06')?.order).toBe('NONE')
    expect(changed.next.players.find((player) => player.id === 'DF04')?.order).toBe('HOLD')
    expect(changed.next.players.find((player) => player.id === 'MF07')?.order).toBe('CONSERVE')
    expect(changed.records).toContainEqual({ type: 'FORMATION', value: '5-4-1' })
    expect(changed.records).toContainEqual({
      type: 'ORDER',
      target: 'MF06',
      order: 'NONE',
    })
  })

  it('자동 해제도 결정 이력으로 재현된다', () => {
    const base = createState(problem)
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === 'MF06' ? { ...player, order: 'PUSH_UP' as const } : player,
      ),
    }
    const changed = changeFormation(state, '5-4-1')
    const decisions = changed.records.map((record) => ({ ...record, tick: 0 })) as Decision[]
    const replay = simulate(
      {
        ...problem,
        initialFormation: state.formation,
        variation: undefined,
      },
      [
        { tick: 0, type: 'ORDER', target: 'MF06', order: 'PUSH_UP' },
        ...decisions,
      ],
    )
    expect(replay.final.formation).toBe(changed.next.formation)
    expect(replay.final.players.find((player) => player.id === 'MF06')?.order).toBe('NONE')
  })
})
