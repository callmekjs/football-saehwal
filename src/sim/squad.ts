import raw from '../data/squads.json' with { type: 'json' }
import { FREE_POSITION } from './constants'
import type {
  MatchAbility,
  Player,
  PlayerAttributes,
  PlayerState,
  Position,
  Problem,
} from './types'

type RawEntry = {
  num: number
  pos: string
  speed?: number
  stamina0?: number
  finishing?: number
  attributes?: Partial<PlayerAttributes>
}

const DEFAULTS = raw.positionDefaults
/** 능력치를 적지 않은 선수가 물려받는 포지션 평균 */
const ATTRIBUTE_DEFAULTS = raw.attributeDefaults

function isPosition(v: string): v is Position {
  return v === 'GK' || v === 'DF' || v === 'MF' || v === 'FW'
}

/** 1~20 정수로 맞춘다 */
function toAttribute(value: number): number {
  return Math.max(1, Math.min(20, Math.round(value)))
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

  /**
   * 능력치를 안 적은 선수는 포지션 평균에서 물려받되, **엔진이 실제로 쓰는
   * 값과 어긋나지 않게** 속도와 마무리는 그 값에서 되돌려 만든다.
   *
   * 상대 열한 명이 이 경우다. 성향 테이블로 다루므로 능력치를 손으로 적지
   * 않지만, 속도만은 개별로 적혀 있어서 평균을 그대로 쓰면 발이 80인
   * 선수의 카드에 70이 뜬다.
   */
  const attributes = {
    ...ATTRIBUTE_DEFAULTS[e.pos],
    pace: toAttribute(speed / 5),
    speed: toAttribute(speed / 5),
    finish: toAttribute((finishing - 0.55) / 0.045),
    ...(e.attributes ?? {}),
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      throw new Error(`${e.pos}${e.num}: ${key} 능력치가 1~20 정수가 아니다 (${value})`)
    }
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
    attributes,
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
    position: null,
    ability: { speed: p.speed, finishing: p.finishing, attributes: p.attributes },
  }))
}

/**
 * 이 판에 이 선수가 실제로 가진 능력.
 *
 * 판마다 섞이므로 명단의 고정값이 아니라 상태에서 읽어야 한다. 값이 없는
 * 것은 이 칸이 생기기 전에 만들어진 검사 픽스처뿐이라 명단으로 돌아간다.
 */
export function abilityOf(state: PlayerState): MatchAbility {
  if (state.ability) return state.ability
  const p = getPlayer(state.id)
  return { speed: p.speed, finishing: p.finishing, attributes: p.attributes }
}

/**
 * 지시를 얹은 실제 포지션.
 *
 * 감독이 "너는 내려가서 수비해라"라고 하면 그 선수는 그 순간부터
 * 수비수다. 등번호에 적힌 포지션이 아니라 지금 서 있는 자리가 실점과
 * 득점을 정한다.
 *
 * 이게 개별 지시 중 유일하게 **굵은 통로**다. 배후 실점은 수비 자원 중
 * 가장 느린 선수 하나로 정해지므로, 발 빠른 미드필더를 내리면 그 값이
 * 즉시 바뀐다. 난수를 하나도 더 뽑지 않고 확률이 움직인다.
 *
 * 골키퍼는 어떤 지시로도 자리를 옮기지 않는다.
 */
export function effectivePos(s: PlayerState): Position {
  const base = getPlayer(s.id).pos
  if (base === 'GK') return base
  if (s.position) {
    if (s.position.x <= FREE_POSITION.zones.defenceMaxX) return 'DF'
    if (s.position.x <= FREE_POSITION.zones.midfieldMaxX) return 'MF'
    return 'FW'
  }
  if (s.order === 'DROP_BACK') return 'DF'
  if (s.order === 'PUSH_UP') return 'FW'
  return base
}

/**
 * 피치 위 수비수 중 가장 느린 선수의 속도.
 *
 * 배후 실점 확률이 이 값 하나로 결정되므로, "느린 수비수를 빠른 수비수로
 * 교체한다"가 이 시뮬레이션의 대표 승부처가 된다. 골키퍼는 세지 않는다 —
 * 배후 침투는 최종 수비 라인과 골키퍼 사이 공간에서 일어난다.
 *
 * 내려가라고 지시받은 선수도 여기 포함된다. 다만 그 선수가 원래 수비수보다
 * 느리면 오히려 이 값이 내려가 실점이 는다 — 아무나 내리면 손해다.
 */
export function minDefenderSpeed(players: PlayerState[]): number {
  let min = Infinity
  for (const s of players) {
    if (!s.onPitch || s.out) continue
    if (effectivePos(s) !== 'DF') continue
    const speed = abilityOf(s).speed
    if (speed < min) min = speed
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

/**
 * 피치 위 우리 선수 중 마무리가 가장 좋은 공격 자원.
 *
 * 내려가라고 지시받은 선수는 여기서 빠진다 — 뒤로 내리면 골 넣을 사람이
 * 하나 준다. 올려보낸 수비수는 반대로 들어온다. 지시의 대가와 이득이
 * 같은 자리에서 갈린다.
 */
export function bestFinishing(players: PlayerState[]): number {
  let best = 0.7
  for (const s of players) {
    if (!s.onPitch || s.out) continue
    const pos = effectivePos(s)
    if (pos !== 'FW' && pos !== 'MF') continue
    const finishing = abilityOf(s).finishing
    if (finishing > best) best = finishing
  }
  return best
}

/** 피치 위 우리 인원 */
export function onPitchCount(players: PlayerState[]): number {
  return players.filter((s) => s.onPitch && !s.out).length
}
