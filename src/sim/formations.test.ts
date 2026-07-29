import { describe, expect, it } from 'vitest'
import { createState } from './engine'
import {
  assignFormationSlots,
  getFormation,
  slotsForPlayers,
} from './formations'
import { PROBLEMS } from './problems'
import { getPlayer } from './squad'

const problem = (id: string) => PROBLEMS.find((entry) => entry.id === id)!

describe('실제 인원에 맞춘 포메이션 자리', () => {
  it('수비수 결원인 열 명 4-4-2는 3-4-2가 된다', () => {
    const state = createState(problem('p04'))
    const onPitch = state.players.filter((player) => player.onPitch && !player.out)
    const slots = slotsForPlayers(
      state.formation,
      onPitch.map((player) => getPlayer(player.id).pos),
    )
    const counts = (['DF', 'MF', 'FW'] as const).map(
      (pos) => slots.filter((slot) => slot.pos === pos).length,
    )
    expect(counts).toEqual([3, 4, 2])

    const placed = assignFormationSlots(onPitch, slots, (player) => getPlayer(player.id).pos)
    const eleven = placed.placed.find(({ player }) => getPlayer(player.id).num === 11)
    expect(eleven?.slot.pos).toBe('FW')
  })

  it('포메이션이 바뀌면 예전 자리 번호 대신 등록 역할부터 다시 맞춘다', () => {
    const state = createState(problem('p02'))
    const onPitch = state.players.filter((player) => player.onPitch && !player.out)
    const positions = onPitch.map((player) => getPlayer(player.id).pos)
    const oldSlots = slotsForPlayers('4-4-2', positions)
    const old = assignFormationSlots(onPitch, oldSlots, (player) => getPlayer(player.id).pos)
    const six = onPitch.find((player) => getPlayer(player.id).num === 6)!
    const oldIndex = old.seats.get(six.id)!

    // 4-4-2의 첫 미드필더 자리 번호는 5-4-1에서는 수비수 자리다.
    expect(getFormation('5-4-1').slots[oldIndex].pos).toBe('DF')

    const newSlots = slotsForPlayers('5-4-1', positions)
    const remapped = assignFormationSlots(
      onPitch,
      newSlots,
      (player) => getPlayer(player.id).pos,
      new Map(),
    )
    expect(remapped.placed.find(({ player }) => player.id === six.id)?.slot.pos).toBe('MF')
  })
})
