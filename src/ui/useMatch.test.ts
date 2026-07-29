import { describe, expect, it } from 'vitest'
import { createState, simulate } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { effectivePos } from '../sim/squad'
import type { Decision } from '../sim/types'
import { changeFormation, changePosition } from './useMatch'

const problem = PROBLEMS.find((entry) => entry.id === 'p02')!

describe('포메이션 변경', () => {
  it('4-4-2에서 올라간 선수를 풀고 5-4-1을 새 모양 그대로 세운다', () => {
    const base = createState(problem)
    const state = {
      ...base,
      players: base.players.map((player) => {
        if (player.id === 'MF06') return { ...player, order: 'PUSH_UP' as const }
        if (player.id === 'DF04') {
          return { ...player, order: 'HOLD' as const, position: { x: 24, y: 12 } }
        }
        if (player.id === 'MF07') return { ...player, order: 'CONSERVE' as const }
        return player
      }),
    }
    const changed = changeFormation(state, '5-4-1')

    expect(changed.next.formation).toBe('5-4-1')
    expect(changed.next.players.find((player) => player.id === 'MF06')?.order).toBe('NONE')
    expect(changed.next.players.find((player) => player.id === 'DF04')?.order).toBe('HOLD')
    expect(changed.next.players.find((player) => player.id === 'DF04')?.position).toBeNull()
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
        player.id === 'MF06'
          ? { ...player, order: 'PUSH_UP' as const, position: { x: 58, y: 18 } }
          : player,
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
        { tick: 0, type: 'POSITION', target: 'MF06', position: { x: 58, y: 18 } },
        { tick: 0, type: 'ORDER', target: 'MF06', order: 'PUSH_UP' },
        ...decisions,
      ],
    )
    expect(replay.final.formation).toBe(changed.next.formation)
    expect(replay.final.players.find((player) => player.id === 'MF06')?.order).toBe('NONE')
    expect(replay.final.players.find((player) => player.id === 'MF06')?.position).toBeNull()
  })
})

describe('자유 위치 결정', () => {
  it('실제 좌표를 저장하고 POSITION 결정으로 기록하며 앞뒤 줄 지시를 푼다', () => {
    const base = createState(problem)
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === 'MF06' ? { ...player, order: 'PUSH_UP' as const } : player,
      ),
    }
    const changed = changePosition(state, 'MF06', { x: 58, y: 12 })

    expect(changed.error).toBeNull()
    expect(changed.record).toEqual({
      type: 'POSITION',
      target: 'MF06',
      position: { x: 58, y: 12 },
    })
    expect(changed.next.players.find((player) => player.id === 'MF06')).toMatchObject({
      order: 'NONE',
      position: { x: 58, y: 12 },
    })
  })

  it('기본 자리로 돌리는 것도 POSITION null 결정으로 남는다', () => {
    const base = createState(problem)
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === 'MF06' ? { ...player, position: { x: 60, y: 20 } } : player,
      ),
    }
    const changed = changePosition(state, 'MF06', null)
    expect(changed.error).toBeNull()
    expect(changed.record).toEqual({
      type: 'POSITION',
      target: 'MF06',
      position: null,
    })
    expect(changed.next.players.find((player) => player.id === 'MF06')?.position).toBeNull()
  })

  it('골키퍼 이동과 수비 셋 아래 이동은 엔진의 한국어 사유로 막는다', () => {
    const goalkeeper = changePosition(createState(problem), 'GK01', { x: 30, y: 34 })
    expect(goalkeeper.error).toBe('골키퍼는 자리를 옮길 수 없다')

    const shortProblem = PROBLEMS.find((entry) => entry.id === 'p03')!
    const shortBase = createState(shortProblem)
    const defenders = shortBase.players.filter(
      (player) => player.onPitch && !player.out && effectivePos(player) === 'DF',
    )
    const removed = defenders.at(-1)!
    const short = {
      ...shortBase,
      players: shortBase.players.map((player) =>
        player.id === removed.id ? { ...player, onPitch: false, out: true } : player,
      ),
    }
    expect(
      short.players.filter(
        (player) => player.onPitch && !player.out && effectivePos(player) === 'DF',
      ),
    ).toHaveLength(3)
    const defender = short.players.find(
      (player) =>
        player.onPitch &&
        !player.out &&
        effectivePos(player) === 'DF',
    )!
    const tooHigh = changePosition(short, defender.id, { x: 80, y: 34 })
    expect(tooHigh.error).toBe('뒤에 수비가 셋은 남아야 한다')
    expect(tooHigh.record).toBeNull()
    expect(tooHigh.next).toBe(short)
  })

  it('POSITION 결정은 종료 분석 재현에서도 같은 좌표가 된다', () => {
    const replay = simulate(
      {
        ...problem,
        variation: undefined,
      },
      [{ tick: 0, type: 'POSITION', target: 'MF06', position: { x: 62, y: 18 } }],
    )
    expect(replay.final.players.find((player) => player.id === 'MF06')?.position).toEqual({
      x: 62,
      y: 18,
    })
  })
})
