import { describe, expect, it } from 'vitest'
import { createState } from './sim/engine'
import { PROBLEMS } from './sim/problems'
import { getPlayer } from './sim/squad'
import { awayCaptainNumber, captainNumber, homeCaptainNumber } from './captain'

describe('주장 완장', () => {
  it('우리 팀 피치 위 필드 플레이어 중 가장 낮은 등번호가 주장이다', () => {
    const state = createState(PROBLEMS[0])
    expect(homeCaptainNumber(state.players)).toBe(2)
  })

  it('주장이 빠지면 다음 낮은 등번호가 완장을 이어받는다', () => {
    const state = createState(PROBLEMS[0])
    const players = state.players.map((player) =>
      getPlayer(player.id).num === 2
        ? { ...player, onPitch: false, out: true }
        : player,
    )
    expect(homeCaptainNumber(players)).toBe(3)
  })

  it('상대도 화면에 실제 남아 있는 필드 플레이어 중 주장을 고른다', () => {
    expect(awayCaptainNumber('4-2-3-1', 11)).toBe(2)
    expect(awayCaptainNumber('5-4-1', 10)).toBe(2)
  })

  it('골키퍼만 남았으면 필드 주장을 지어내지 않는다', () => {
    expect(captainNumber([{ num: 1, pos: 'GK' }])).toBe(0)
  })
})
