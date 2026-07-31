import { describe, expect, it } from 'vitest'
import { createState } from './sim/engine'
import { PROBLEMS } from './sim/problems'
import { abilityOf, getPlayer } from './sim/squad'
import { awayCaptainNumber, captainNumber, homeCaptainNumber } from './captain'
import type { PlayerState } from './sim/types'

/** 피치 위 필드 플레이어를 리더십 순으로 */
function fieldByLeadership(players: readonly PlayerState[]) {
  return players
    .filter((player) => player.onPitch && !player.out)
    .filter((player) => getPlayer(player.id).pos !== 'GK')
    .map((player) => ({
      num: getPlayer(player.id).num,
      leadership: abilityOf(player).attributes.leadership,
    }))
    .sort((a, b) => b.leadership - a.leadership || a.num - b.num)
}

describe('주장 완장', () => {
  it('리더십이 가장 높은 필드 플레이어가 완장을 찬다', () => {
    const state = createState(PROBLEMS[0])
    expect(homeCaptainNumber(state.players)).toBe(fieldByLeadership(state.players)[0].num)
  })

  it('주장이 빠지면 남은 선수 중 리더십이 가장 높은 선수가 이어받는다', () => {
    const state = createState(PROBLEMS[0])
    const first = homeCaptainNumber(state.players)
    const players = state.players.map((player) =>
      getPlayer(player.id).num === first
        ? { ...player, onPitch: false, out: true }
        : player,
    )
    const next = homeCaptainNumber(players)
    expect(next).not.toBe(first)
    expect(next).toBe(fieldByLeadership(players)[0].num)
  })

  /**
   * 사용자가 정했다 — *"주장도 랜덤이야. 2번만 주장이 아니고."*
   * 등번호가 가장 작은 선수로 굳어 있으면 안 된다.
   */
  it('판마다 주장이 달라지고 2번으로 굳지 않는다', () => {
    const seen = new Set<number>()
    for (const problem of PROBLEMS) {
      for (let i = 0; i < 40; i += 1) {
        const state = createState({ ...problem, seed: problem.seed + i * 7919 })
        seen.add(homeCaptainNumber(state.players))
      }
    }
    expect(seen.size).toBeGreaterThan(3)
  })

  it('골키퍼는 완장을 차지 않는다', () => {
    for (const problem of PROBLEMS) {
      const state = createState(problem)
      const captain = homeCaptainNumber(state.players)
      const player = state.players.find((s) => getPlayer(s.id).num === captain)!
      expect(getPlayer(player.id).pos).not.toBe('GK')
    }
  })

  it('상대도 팀마다 주장이 다르다', () => {
    const seen = new Set<number>()
    for (const id of ['ARG', 'ESP', 'BRA', 'USA', 'JPN', 'CHN', 'VIE'] as const) {
      const captain = awayCaptainNumber('4-2-3-1', 11, id)
      expect(captain).toBeGreaterThan(0)
      seen.add(captain)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('상대 팀을 모르면 예전처럼 등번호로 정한다', () => {
    expect(awayCaptainNumber('4-2-3-1', 11)).toBe(2)
    expect(awayCaptainNumber('5-4-1', 10)).toBe(2)
  })

  it('골키퍼만 남았으면 필드 주장을 지어내지 않는다', () => {
    expect(captainNumber([{ num: 1, pos: 'GK' }])).toBe(0)
  })
})
