import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { getPlayer, HOME_SQUAD } from '../sim/squad'
import { attributeLabel, playerDataOf, summaryRowsOf } from './playerData'
import type { Position } from '../sim/types'

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

/**
 * 사용자가 잡아낸 것 — *"포지션이 4개가 있는데 스펙은 다 같네?"*
 *
 * 목록 줄이 네 포지션에 같은 세 칸을 세우면 수비수와 미드필더가 같은
 * 선수로 보인다. 값은 방향과 비율로 지킨다. 특정 숫자를 박으면 명단을
 * 손볼 때마다 깨진다.
 */
describe('줄에 세우는 세 칸', () => {
  const POSITIONS: readonly Position[] = ['GK', 'DF', 'MF', 'FW']

  const summaryKeysOf = (pos: Position) => {
    const player = HOME_SQUAD.find((p) => p.pos === pos)!
    const state = createState(PROBLEMS[0]).players.find((s) => s.id === player.id)!
    return summaryRowsOf(playerDataOf(state)).map((row) => row.key)
  }

  it('포지션마다 세 칸씩 세우고 네 포지션이 서로 다르다', () => {
    const sets = POSITIONS.map((pos) => summaryKeysOf(pos))
    for (const keys of sets) expect(keys).toHaveLength(3)

    const signatures = sets.map((keys) => keys.join(','))
    expect(new Set(signatures).size).toBe(POSITIONS.length)
  })

  it('세운 칸이 실제로 그 포지션을 가른다', () => {
    // 그 포지션의 평균이 나머지 세 포지션의 평균보다 높아야 한다
    const meanOf = (pos: Position, key: string) => {
      const group = HOME_SQUAD.filter((p) => p.pos === pos)
      const values = group.map(
        (p) => (p.attributes as unknown as Record<string, number>)[key],
      )
      return values.reduce((a, b) => a + b, 0) / values.length
    }

    for (const pos of POSITIONS) {
      for (const key of summaryKeysOf(pos)) {
        const mine = meanOf(pos, key)
        const others = POSITIONS.filter((p) => p !== pos).map((p) => meanOf(p, key))
        expect(mine).toBeGreaterThan(Math.max(...others))
      }
    }
  })

  it('능력치 이름표는 화면 목록에서 온다', () => {
    expect(attributeLabel('finish')).toBe('골 결정력')
    expect(attributeLabel('pace')).toBe('순간 속도')
  })
})
