import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { getPlayer } from '../sim/squad'
import { playerDataOf } from './playerData'

describe('선수 데이터', () => {
  it('가짜 평점 없이 현재 체력과 명단 능력치를 그대로 보여준다', () => {
    const state = createState(PROBLEMS[0])
    const playerState = state.players.find((player) => player.onPitch)!
    const player = getPlayer(playerState.id)
    const data = playerDataOf({ ...playerState, stamina: 43 })

    expect(data.number).toBe(player.num)
    expect(data.stamina).toBe(43)
    expect(data.rosterStamina).toBe(player.stamina0)
    expect(data.speed).toBe(player.speed)
    expect(data.finishing).toBe(player.finishing)
  })

  it('지시로 달라진 현재 역할과 등록 포지션을 구분한다', () => {
    const state = createState(PROBLEMS[0])
    const midfielder = state.players.find(
      (player) => player.onPitch && getPlayer(player.id).pos === 'MF',
    )!
    const data = playerDataOf({ ...midfielder, order: 'DROP_BACK' })

    expect(data.basePosition).toBe('MF')
    expect(data.currentPosition).toBe('DF')
    expect(data.hasOrder).toBe(true)
  })

  it('벤치와 이탈 상태를 실제 선수 상태에서 구분한다', () => {
    const state = createState(PROBLEMS[0])
    const bench = state.players.find((player) => !player.onPitch && !player.out)!

    expect(playerDataOf(bench).availability).toBe('BENCH')
    expect(playerDataOf({ ...bench, out: true }).availability).toBe('OUT')
  })

  it('직접 배치 여부와 경고를 현재 상태에서 읽는다', () => {
    const state = createState(PROBLEMS[0])
    const playerState = state.players.find((player) => player.onPitch)!
    const data = playerDataOf({
      ...playerState,
      booked: true,
      position: { x: 0.7, y: 0.2 },
    })

    expect(data.booked).toBe(true)
    expect(data.hasFreePosition).toBe(true)
  })
})
