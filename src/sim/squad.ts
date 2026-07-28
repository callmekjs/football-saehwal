import raw from '../data/squads.json' with { type: 'json' }
import type { Player, PlayerState, Position, Problem } from './types'

type RawEntry = { num: number; pos: string; speed?: number; stamina0?: number; finishing?: number }

const DEFAULTS = raw.positionDefaults

function isPosition(v: string): v is Position {
  return v === 'GK' || v === 'DF' || v === 'MF' || v === 'FW'
}

/** "DF04" — 포지션 + 등번호 두 자리 */
export function playerId(pos: Position, num: number): string {
  return `${pos}${String(num).padStart(2, '0')}`
}

/**
 * 명단 항목을 Player 로 만든다.
 *
 * 값이 비어 있으면 포지션 평균에서 물려받는다. 22명 전원의 모든 능력치를
 * 손으로 채우면 시간이 몇 배로 드는데, 계산에 실제로 쓰이는 것은 수비수의
 * 속도와 공격수의 마무리뿐이다.
 */
function build(e: RawEntry, side: 'HOME' | 'AWAY', onBench: boolean): Player {
  if (!isPosition(e.pos)) throw new Error(`알 수 없는 포지션: ${e.pos} (등번호 ${e.num})`)
  const d = DEFAULTS[e.pos]
  const speed = e.speed ?? d.speed
  const finishing = e.finishing ?? d.finishing

  if (speed < 0 || speed > 100) throw new Error(`${e.pos}${e.num}: 속도가 0~100 밖이다 (${speed})`)
  if (finishing < 0.7 || finishing > 1.3) {
    throw new Error(`${e.pos}${e.num}: 마무리가 0.7~1.3 밖이다 (${finishing})`)
  }

  return {
    id: playerId(e.pos, e.num),
    num: e.num,
    pos: e.pos,
    side,
    onBench,
    speed,
    stamina0: e.stamina0 ?? d.stamina0,
    finishing,
  }
}

export const HOME_XI: Player[] = (raw.home as RawEntry[]).map((e) => build(e, 'HOME', false))
export const BENCH: Player[] = (raw.bench as RawEntry[]).map((e) => build(e, 'HOME', true))

/**
 * 상대는 등번호·포지션·속도만 있으면 된다. 상대 선수를 개별로 추적하지
 * 않고 성향 테이블로 다루기 때문이다. 속도는 내일 볼 경합에서 쓴다.
 * 우리 팀과 등번호가 겹치므로 id 앞에 A_ 를 붙인다.
 */
export const AWAY_XI: Player[] = (raw.away as RawEntry[]).map((e) => {
  const p = build(e, 'AWAY', false)
  return { ...p, id: `A_${p.id}` }
})

/** 우리 팀 전원 (선발 + 벤치) */
export const HOME_SQUAD: Player[] = [...HOME_XI, ...BENCH]

const BY_ID = new Map<string, Player>(
  [...HOME_SQUAD, ...AWAY_XI].map((p) => [p.id, p]),
)

export function getPlayer(id: string): Player {
  const p = BY_ID.get(id)
  if (!p) throw new Error(`명단에 없는 선수: ${id}`)
  return p
}

/**
 * 국면의 시작 선수 상태를 만든다.
 *
 * 벤치도 포함한다. 교체로 들어온 선수의 체력을 따로 챙길 필요가 없어진다.
 */
export function initialPlayers(problem: Problem): PlayerState[] {
  for (const id of [...problem.booked, ...problem.unavailable, ...Object.keys(problem.staminaOverrides)]) {
    getPlayer(id)
  }
  return HOME_SQUAD.map((p) => ({
    id: p.id,
    onPitch: !p.onBench && !problem.unavailable.includes(p.id),
    stamina: problem.staminaOverrides[p.id] ?? p.stamina0,
    booked: problem.booked.includes(p.id),
    out: problem.unavailable.includes(p.id),
    order: 'NONE',
  }))
}

/**
 * 피치 위 수비수 중 가장 느린 선수의 속도.
 *
 * 배후 실점 확률이 이 값 하나로 결정되므로, "느린 수비수를 빠른 수비수로
 * 교체한다"가 이 게임의 대표 승부처가 된다. 골키퍼는 세지 않는다 — 배후
 * 침투는 최종 수비 라인과 골키퍼 사이 공간에서 일어난다.
 */
export function minDefenderSpeed(players: PlayerState[]): number {
  let min = Infinity
  for (const s of players) {
    if (!s.onPitch || s.out) continue
    const p = getPlayer(s.id)
    if (p.pos !== 'DF') continue
    if (p.speed < min) min = p.speed
  }
  // 수비수가 전멸하면 골키퍼만 남은 상황이다. 최악값으로 처리한다.
  return min === Infinity ? 50 : min
}

/** 피치 위 우리 선수의 평균 체력 */
export function meanStamina(players: PlayerState[]): number {
  let sum = 0
  let n = 0
  for (const s of players) {
    if (!s.onPitch || s.out) continue
    sum += s.stamina
    n += 1
  }
  return n === 0 ? 100 : sum / n
}

/** 피치 위 우리 선수 중 마무리가 가장 좋은 공격 자원 */
export function bestFinishing(players: PlayerState[]): number {
  let best = 0.7
  for (const s of players) {
    if (!s.onPitch || s.out) continue
    const p = getPlayer(s.id)
    if (p.pos !== 'FW' && p.pos !== 'MF') continue
    if (p.finishing > best) best = p.finishing
  }
  return best
}

/** 피치 위 우리 인원 */
export function onPitchCount(players: PlayerState[]): number {
  return players.filter((s) => s.onPitch && !s.out).length
}
