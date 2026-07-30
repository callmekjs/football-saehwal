import { awaySlots, type AwayFormationId } from './sim/awayShape'
import { getPlayer } from './sim/squad'
import type { PlayerState, Position } from './sim/types'

interface CaptainCandidate {
  num: number
  pos: Position
}

/**
 * 주장 완장이 누구에게 가는지 정하는 단일 규칙.
 *
 * 명단에 완장 데이터가 따로 없으므로 기존 주장 브리핑이 쓰던 규칙을
 * 그대로 공유한다. 피치 위 필드 플레이어 중 등번호가 가장 작은 선수다.
 */
export function captainNumber(candidates: readonly CaptainCandidate[]): number {
  let best = Infinity
  for (const player of candidates) {
    if (player.pos !== 'GK' && player.num < best) best = player.num
  }
  return best === Infinity ? 0 : best
}

/** 현재 우리 팀 피치 위 주장. 빠지면 다음 낮은 등번호가 이어받는다. */
export function homeCaptainNumber(players: readonly PlayerState[]): number {
  return captainNumber(
    players
      .filter((player) => player.onPitch && !player.out)
      .map((player) => getPlayer(player.id)),
  )
}

/** 현재 상대 배치판과 관전 화면에 실제 남아 있는 선수 중 주장. */
export function awayCaptainNumber(formation: AwayFormationId, count: number): number {
  return captainNumber(
    awaySlots(formation, count).map(([pos, , , num]) => ({ pos, num })),
  )
}
