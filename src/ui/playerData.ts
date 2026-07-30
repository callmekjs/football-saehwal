import { effectivePos, getPlayer } from '../sim/squad'
import type { PlayerState, Position } from '../sim/types'

export type PlayerAvailability = 'PLAYING' | 'BENCH' | 'OUT'

export interface PlayerData {
  id: string
  number: number
  basePosition: Position
  currentPosition: Position
  availability: PlayerAvailability
  stamina: number
  rosterStamina: number
  speed: number
  finishing: number
  booked: boolean
  hasOrder: boolean
  hasFreePosition: boolean
}

/**
 * 화면에 보여줄 선수 데이터.
 *
 * 종합 평점처럼 계산하지 않는 값은 만들지 않는다. 명단과 현재 경기 상태에서
 * 실제로 결정되는 값만 같은 모양으로 묶는다.
 */
export function playerDataOf(state: PlayerState): PlayerData {
  const player = getPlayer(state.id)
  return {
    id: state.id,
    number: player.num,
    basePosition: player.pos,
    currentPosition: effectivePos(state),
    availability: state.out ? 'OUT' : state.onPitch ? 'PLAYING' : 'BENCH',
    stamina: Math.max(0, Math.min(100, state.stamina)),
    rosterStamina: player.stamina0,
    speed: player.speed,
    finishing: player.finishing,
    booked: state.booked,
    hasOrder: state.order !== 'NONE',
    hasFreePosition: state.position !== null,
  }
}
