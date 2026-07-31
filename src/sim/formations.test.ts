import { describe, expect, it } from 'vitest'
import { applySub, createState } from './engine'
import {
  assignFormationSlots,
  FORMATION_IDS,
  getFormation,
  slotsForPlayers,
  type FormationId,
} from './formations'
import { PROBLEMS } from './problems'
import {
  assignFormationRoles,
  effectivePos,
  formationRoleOf,
  getPlayer,
} from './squad'

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

describe('배치판과 경기 계산의 포메이션 역할', () => {
  const base = createState(problem('p02')).players.map((player) => ({
    ...player,
    order: 'NONE' as const,
    position: null,
  }))
  const rosterStates = [
    { label: '정상 11명', removed: [] },
    { label: '수비수 한 명 없음', removed: ['DF04'] },
    { label: '미드필더 한 명 없음', removed: ['MF06'] },
    { label: '공격수 한 명 없음', removed: ['FW11'] },
    { label: '수비수·미드필더 각 한 명 없음', removed: ['DF04', 'MF06'] },
  ]
  const cases = rosterStates.flatMap((roster) =>
    FORMATION_IDS.map((formation) => ({ ...roster, formation })),
  )

  it.each(cases)(
    '$label · $formation에서 화면 슬롯과 계산 역할이 같다',
    ({ removed, formation }: { removed: string[]; formation: FormationId }) => {
      const removedIds = new Set(removed)
      const players = assignFormationRoles(
        base.map((player) =>
          removedIds.has(player.id)
            ? { ...player, onPitch: false, out: true }
            : player,
        ),
        formation,
      )
      const onPitch = players.filter((player) => player.onPitch && !player.out)
      const slots = slotsForPlayers(
        formation,
        onPitch.map((player) => getPlayer(player.id).pos),
      )
      const assigned = assignFormationSlots(onPitch, slots, formationRoleOf)
      const mismatches = assigned.placed.filter(
        ({ player, slot }) =>
          formationRoleOf(player) !== slot.pos || effectivePos(player) !== slot.pos,
      )

      expect(assigned.placed).toHaveLength(onPitch.length)
      expect(mismatches).toHaveLength(0)
      expect(assigned.placed.filter(({ slot }) => slot.pos === 'GK')).toHaveLength(1)
      expect(assigned.placed.filter(({ slot }) => slot.pos === 'DF').length).toBeGreaterThanOrEqual(3)
    },
  )

  it('교체 선수는 나가는 선수의 포메이션 역할을 이어받는다', () => {
    const players = assignFormationRoles(base, '5-4-1')
    const outgoing = players.find(
      (player) =>
        player.onPitch &&
        getPlayer(player.id).pos === 'FW' &&
        formationRoleOf(player) === 'DF',
    )!
    const incoming = players.find(
      (player) => !player.onPitch && !player.out && getPlayer(player.id).pos === 'FW',
    )!
    const changed = applySub(players, outgoing.id, incoming.id)
    const entered = changed.find((player) => player.id === incoming.id)!

    expect(formationRoleOf(outgoing)).toBe('DF')
    expect(formationRoleOf(entered)).toBe('DF')
  })
})
