import raw from '../data/squads.json' with { type: 'json' }
import { FREE_POSITION, ROSTER } from './constants'
import type {
  MatchAbility,
  Player,
  PlayerAttributes,
  PlayerProfile,
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

/**
 * 이름 하나에서 0~1 사이 값을 만든다. FNV-1a.
 *
 * **난수가 아니다.** 같은 이름이면 언제나 같은 값이라 `src/sim/` 의
 * 결정성 규칙을 깨지 않고, 매 틱 18슬롯이나 시작 조건 스트림도 건드리지
 * 않는다. 모듈을 읽을 때 한 번 계산되고 끝난다.
 */
function fixedNoise(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

/** 능력치를 손으로 적지 않았을 때 흩뿌리는 폭 */
const ATTRIBUTE_SPREAD = 3

/**
 * 적지 않은 능력치를 포지션 기준값 둘레로 흩뿌린다.
 *
 * 서른여섯 개를 스물여섯 명분 손으로 적으면 구백 개가 넘고, 그중 대부분은
 * 화면에만 쓰이는 값이라 실수만 늘어난다. 대신 **기준값 + 선수 고유의
 * 고정 편차**로 만든다. 같은 포지션이라도 선수마다 다르고, 같은 선수는
 * 언제나 같다.
 */
function spreadAttribute(id: string, key: string, base: number): number {
  return toAttribute(base + (fixedNoise(`${id}:${key}`) * 2 - 1) * ATTRIBUTE_SPREAD)
}

/** 포지션마다 흔한 키의 범위(cm). 골키퍼와 중앙 수비가 크다 */
const HEIGHT_RANGE: Record<Position, readonly [number, number]> = {
  GK: [186, 196],
  DF: [177, 190],
  MF: [170, 183],
  FW: [174, 189],
}

/**
 * 능력치가 아닌 신상을 만든다.
 *
 * `fixedNoise` 를 쓰므로 난수가 아니다. 같은 등번호는 언제나 같은 키와
 * 같은 주발을 갖는다. 확률에 닿지 않는 화면 전용 값이다.
 */
function buildProfile(id: string, pos: Position): PlayerProfile {
  const [lo, hi] = HEIGHT_RANGE[pos]
  const height = Math.round(lo + fixedNoise(`${id}:height`) * (hi - lo))
  // 축구 선수의 몸무게는 대체로 (키 − 100) 언저리에서 몇 kg 흔들린다
  const weight = Math.round(height - 100 + (fixedNoise(`${id}:weight`) * 2 - 1) * 5)

  const footRoll = fixedNoise(`${id}:foot`)
  const foot: PlayerProfile['foot'] =
    footRoll < 0.06 ? '양발' : footRoll < 0.3 ? '왼발' : '오른발'

  // 골키퍼가 아니면 골문에 세워봐야 소용이 없다는 뜻으로 낮게 둔다
  const goalkeeping =
    pos === 'GK'
      ? toAttribute(14 + fixedNoise(`${id}:gk`) * 6)
      : toAttribute(1 + fixedNoise(`${id}:gk`) * 4)

  return { foot, height, weight, goalkeeping }
}

/**
 * 명단을 다시 뽑는다. 감독이 새로고침을 누를 때만 쓴다.
 *
 * **난수 발생기를 쓰지 않는다.** 씨앗과 등번호에서 값을 계산하므로 같은
 * 씨앗은 언제나 같은 선수단을 만들고, 매 틱 18슬롯이나 시작 조건 스트림을
 * 한 톨도 건드리지 않는다.
 *
 * 낮은 확률로 **스타**가 나온다. 스타는 모든 능력치가 1.5~2배가 되며,
 * 1~20 눈금이라 사실상 열여덟 위로 몰린다. 그 선수 하나로 팀의 성격이
 * 바뀌는 것이 이 기능의 목적이다.
 *
 * 속도와 마무리는 뽑힌 능력치에서 되돌려 만든다. 그래야 카드에 적힌
 * 숫자와 경기가 실제로 쓰는 값이 어긋나지 않는다.
 */
export function rollRoster(seed: number): Map<string, MatchAbility> {
  const [lo, hi] = ROSTER.starBoost
  const out = new Map<string, MatchAbility>()

  for (const player of HOME_SQUAD) {
    const base = ATTRIBUTE_DEFAULTS[player.pos] as Record<string, number>
    const starRoll = fixedNoise(`${seed}:${player.id}:star`)
    const isStar = starRoll < ROSTER.starChance
    const boost = isStar ? lo + fixedNoise(`${seed}:${player.id}:boost`) * (hi - lo) : 1

    const attributes = Object.fromEntries(
      Object.entries(base).map(([key, value]) => {
        const jitter = (fixedNoise(`${seed}:${player.id}:${key}`) * 2 - 1) * ROSTER.spread
        return [key, toAttribute((value + jitter) * boost)]
      }),
    ) as unknown as PlayerAttributes

    out.set(player.id, {
      // 뽑힌 능력치가 원본이다. 엔진 값은 여기서 나온다
      speed: Math.max(0, Math.min(100, Math.round(((attributes.pace + attributes.speed) / 2) * 5))),
      finishing: Math.max(0.7, Math.min(1.3, 0.55 + 0.045 * attributes.finish)),
      attributes,
    })
  }
  return out
}

/** 이 선수가 이번 명단에서 스타인가. 화면이 표시에 쓴다 */
export function isStarAbility(ability: MatchAbility): boolean {
  const values = Object.values(ability.attributes)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return mean >= 16
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
  const id = playerId(e.pos, e.num)
  const base = ATTRIBUTE_DEFAULTS[e.pos] as Record<string, number>
  // 적지 않은 칸은 포지션 기준값 둘레로 흩뿌린다
  const spread = Object.fromEntries(
    Object.entries(base).map(([key, value]) => [key, spreadAttribute(id, key, value)]),
  ) as unknown as PlayerAttributes
  const attributes = {
    ...spread,
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
    id,
    num: e.num,
    pos: e.pos,
    side,
    onBench,
    speed,
    stamina0: e.stamina0 ?? d.stamina0,
    finishing,
    attributes,
    profile: buildProfile(id, e.pos),
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
export function initialPlayers(
  problem: Problem,
  /**
   * 감독이 고른 선발 열한 명. 없으면 명단에 적힌 기본 선발로 시작한다.
   *
   * 밸런스 검증은 이 인자를 넘기지 않으므로 다섯 국면의 기준선은 언제나
   * 기본 선발에서 잰다.
   */
  starters?: ReadonlySet<string>,
  /** 다시 뽑은 명단. 없으면 기본 능력을 쓴다 */
  roster?: ReadonlyMap<string, MatchAbility>,
): PlayerState[] {
  for (const id of [...problem.booked, ...problem.unavailable, ...Object.keys(problem.staminaOverrides)]) {
    getPlayer(id)
  }
  return HOME_SQUAD.map((p) => ({
    id: p.id,
    onPitch: (starters ? starters.has(p.id) : !p.onBench) && !problem.unavailable.includes(p.id),
    stamina: problem.staminaOverrides[p.id] ?? p.stamina0,
    booked: problem.booked.includes(p.id),
    out: problem.unavailable.includes(p.id),
    order: 'NONE',
    position: null,
    ability: roster?.get(p.id) ?? {
      speed: p.speed,
      finishing: p.finishing,
      attributes: p.attributes,
    },
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
