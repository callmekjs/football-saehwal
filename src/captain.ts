import { awaySlots, type AwayFormationId } from './sim/awayShape'
import { abilityOf, getPlayer } from './sim/squad'
import { opponentSquad } from './analysis/opponentSquad'
import type { OpponentId, PlayerState, Position } from './sim/types'

interface CaptainCandidate {
  num: number
  pos: Position
  /** 리더십 1~20. 모르면 생략한다 */
  leadership?: number
}

/**
 * 주장 완장이 누구에게 가는지 정하는 단일 규칙.
 *
 * **리더십이 가장 높은 필드 플레이어가 찬다.**
 *
 * 사용자가 정했다 — *"주장도 랜덤이야. 2번만 주장이 아니고. 그건 상대편도
 * 마찬가지고."* 전에는 등번호가 가장 작은 선수였고, 그래서 우리도 상대도
 * 언제나 2번이 주장이었다.
 *
 * **난수를 쓰지 않는다.** 능력치가 판마다 주인이 바뀌므로
 * (`shuffleAbility`) 리더십이 가장 높은 선수도 판마다 달라진다. 그러면서
 * "왜 저 선수가 주장인가"에 답이 생긴다 — 완장은 제비뽑기로 주는 것이
 * 아니다.
 *
 * 골키퍼는 뽑지 않는다. 실제 축구에 골키퍼 주장이 없지는 않지만, 이
 * 시뮬레이션의 주장은 급수 타임과 하프타임에 **필드에서 본 것**을 말하는
 * 화자다.
 *
 * 리더십이 같으면 등번호가 작은 쪽이다. 같은 상황에서 언제나 같은 사람이
 * 나와야 화면이 흔들리지 않는다.
 */
export function captainNumber(candidates: readonly CaptainCandidate[]): number {
  let best: CaptainCandidate | null = null
  for (const player of candidates) {
    if (player.pos === 'GK') continue
    if (best === null) {
      best = player
      continue
    }
    const mine = player.leadership ?? 0
    const theirs = best.leadership ?? 0
    if (mine > theirs || (mine === theirs && player.num < best.num)) best = player
  }
  return best?.num ?? 0
}

/**
 * 현재 우리 팀 피치 위 주장.
 *
 * 주장이 교체·퇴장·부상으로 빠지면 남은 선수 중 리더십이 가장 높은 선수가
 * 완장을 이어받는다.
 */
export function homeCaptainNumber(players: readonly PlayerState[]): number {
  return captainNumber(
    players
      .filter((player) => player.onPitch && !player.out)
      .map((player) => ({
        ...getPlayer(player.id),
        // 이 판의 능력에서 읽는다. 명단의 고정값이 아니다
        leadership: abilityOf(player).attributes.leadership,
      })),
  )
}

/**
 * 현재 상대 배치판과 관전 화면에 실제 남아 있는 선수 중 주장.
 *
 * 상대도 같은 규칙을 쓴다. 상대 능력치는 그 팀의 세기 계수에서 유도되므로
 * (`opponentSquad`), 팀이 바뀌면 주장도 바뀐다. 팀을 모르면 예전처럼
 * 등번호로 정한다 — 이 칸이 생기기 전에 만들어진 호출부를 위해서다.
 */
export function awayCaptainNumber(
  formation: AwayFormationId,
  count: number,
  opponent?: OpponentId,
): number {
  const leadership = opponent
    ? new Map(
        opponentSquad(opponent).players.map((player) => [
          player.num,
          player.attributes.leadership,
        ]),
      )
    : null

  return captainNumber(
    awaySlots(formation, count).map(([pos, , , num]) => ({
      pos,
      num,
      leadership: leadership?.get(num),
    })),
  )
}
