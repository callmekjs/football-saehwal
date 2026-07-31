import { EVENTS, XG } from './constants'
import { effectivePos } from './squad'
import type { TickDraws } from './attack'
import type { Coefficients } from './tactics'
import type { PlayerState } from './types'

export type EventKind = 'FOUL' | 'CARD' | 'SEND_OFF' | 'PENALTY' | 'INJURY'

export interface MatchEvent {
  tick: number
  kind: EventKind
  /** 대상 선수. 없는 사건도 있다 */
  target?: string
  /** 이 사건으로 실점했는가 (페널티) */
  conceded?: boolean
}

export interface EventOutcome {
  events: MatchEvent[]
  awayGoals: number
  /** 새로 경고를 받은 선수 */
  booked: string | null
  /** 퇴장 또는 부상으로 이탈한 선수 */
  removed: string | null
  /** 부상이면 교체 카드 한 장이 강제로 소모된다 */
  forcedSub: boolean
}

const EMPTY: EventOutcome = {
  events: [],
  awayGoals: 0,
  booked: null,
  removed: null,
  forcedSub: false,
}

/**
 * 파울을 저지를 선수를 고른다.
 *
 * 수비수와 미드필더만 대상으로 한다. 공격수와 골키퍼도 파울을 하지만,
 * 이 게임에서 파울이 의미를 갖는 것은 퇴장 위험을 통해서이고 그 위험을
 * 지는 것은 압박에 나서는 선수들이다.
 */
function pickFouler(players: PlayerState[], draw: number): string | null {
  const candidates = players.filter((s) => {
    if (!s.onPitch || s.out) return false
    // 물러서라고 한 선수는 몸을 안 던진다. 반칙 후보에서 빠진다
    if (s.order === 'BACK_OFF') return false
    const pos = effectivePos(s)
    return pos === 'DF' || pos === 'MF'
  })
  if (candidates.length === 0) return null
  // ★ 난수는 이미 뽑아둔 `d.foulTarget` 을 그대로 쓴다. 지시가 바꾸는 것은
  //   이 배열의 **길이**뿐이고 소비 개수와 순서는 언제나 같다
  return candidates[Math.floor(draw * candidates.length)].id
}

/** 체력이 임계 아래인 선수 중 하나를 고른다 */
function pickExhausted(players: PlayerState[], draw: number): string | null {
  const candidates = players.filter(
    (s) => s.onPitch && !s.out && s.stamina < EVENTS.injuryThreshold,
  )
  if (candidates.length === 0) return null
  return candidates[Math.floor(draw * candidates.length)].id
}

/**
 * 한 틱의 사건 판정.
 *
 * 순서는 파울 → (경고 또는 퇴장) → 페널티 → 별도 퇴장 해저드 → 부상이다.
 * 한 틱에 두 명이 동시에 빠지지는 않는다. 실제로도 드물고, 허용하면
 * 인원이 순식간에 무너져 국면이 운으로 결정된다.
 */
export function resolveEvents(
  d: TickDraws,
  c: Coefficients,
  players: PlayerState[],
  press: number,
  tick: number,
): EventOutcome {
  const events: MatchEvent[] = []
  let awayGoals = 0
  let booked: string | null = null
  let removed: string | null = null
  let forcedSub = false

  // 1. 파울
  if (d.foul < EVENTS.foulBase * c.foul) {
    const fouler = pickFouler(players, d.foulTarget)
    if (fouler) {
      events.push({ tick, kind: 'FOUL', target: fouler })
      const already = players.find((s) => s.id === fouler)?.booked ?? false

      if (d.card < EVENTS.cardOnFoul) {
        if (already) {
          // 두 번째 경고 — 퇴장
          removed = fouler
          events.push({ tick, kind: 'SEND_OFF', target: fouler })
        } else {
          booked = fouler
          events.push({ tick, kind: 'CARD', target: fouler })
        }
      }

      // 자기 진영 박스 안이었다면 페널티
      if (d.penalty < EVENTS.penaltyOnFoul) {
        const scored = d.penaltyShot < XG.penalty
        if (scored) awayGoals += 1
        events.push({ tick, kind: 'PENALTY', target: fouler, conceded: scored })
      }
    }
  }

  // 2. 경고 보유 선수가 강 압박을 버티다 퇴장
  //    압박 축이 실제로 값을 갖는 유일한 통로다
  if (!removed && press === 2) {
    // 물러서라고 한 선수는 이 위험에서도 빠진다. 경고를 안고 있는 선수를
    // 강 압박 속에서 지키는 유일한 방법이라, 이 지시가 값을 갖는 자리다
    const atRisk = players.filter(
      (s) => s.onPitch && !s.out && s.booked && s.order !== 'BACK_OFF',
    )
    if (atRisk.length > 0 && d.sendOff < EVENTS.sendOffHazard * atRisk.length) {
      const victim = atRisk[Math.floor(d.foulTarget * atRisk.length)]
      removed = victim.id
      events.push({ tick, kind: 'SEND_OFF', target: victim.id })
    }
  }

  // 3. 부상 — 체력이 바닥난 선수만
  if (!removed && d.injury < EVENTS.injuryHazard) {
    const victim = pickExhausted(players, d.injuryTarget)
    if (victim) {
      removed = victim
      forcedSub = true
      events.push({ tick, kind: 'INJURY', target: victim })
    }
  }

  if (events.length === 0) return EMPTY
  return { events, awayGoals, booked, removed, forcedSub }
}
