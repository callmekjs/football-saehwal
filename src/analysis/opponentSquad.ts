/**
 * 상대 팀 선수 명단 — 화면에 보여주기 위해 **세기 계수에서 유도한다.**
 *
 * 엔진은 상대를 선수 단위로 추적하지 않는다. 성향 표 하나로 다루고, 매 틱
 * 곱해지는 것은 팀 계수다. 그래서 상대의 개별 능력치는 **존재하지 않는다.**
 *
 * 그렇다고 아무 숫자나 지어내면 화면이 거짓말을 한다. 대신 이미 있는 값에서
 * 되짚어 만든다.
 *
 * - **얼마나 센가** 는 `atk`·`def` 가 정한다 (`opponentAbilityAverage`)
 * - **어떤 축구를 하는가** 는 `shape` 가 정한다. 배후 비중이 크면 앞선이
 *   빠르고, 오픈플레이 비중이 크면 중원이 좋고, 마무리가 좋으면 공격수가
 *   골을 넣는다
 * - **누가 어느 자리인가** 는 `AWAY_SHAPES` 의 실제 대형이 정한다
 *
 * 그래서 화면에 뜨는 명단은 그 팀이 실제로 경기에서 하는 것과 어긋나지
 * 않는다. 계수를 튜닝하면 명단도 저절로 따라온다.
 *
 * ## 지키는 것
 *
 * - **선수 이름을 쓰지 않는다.** 등번호와 포지션뿐이다. 우리 팀과 같은 규칙이다
 * - **확률에 닿지 않는다.** 여기서 만든 값은 경기 계산에 한 번도 들어가지 않는다
 * - **난수를 쓰지 않는다.** 팀 id 와 등번호에서 계산하므로 같은 팀은 언제나
 *   같은 명단을 보여준다
 */
import { ATTRIBUTE_DEFAULTS, fixedNoise } from '../sim/squad'
import { AWAY_SHAPES, AWAY_SHAPE_BY_MOOD, type AwayFormationId } from '../sim/awayShape'
import type { OpponentId, PlayerAttributes, Position } from '../sim/types'
import { OUR_ABILITY_AVERAGE, opponentAbilityAverage, opponentInfo } from './opponents'

export interface OpponentPlayer {
  num: number
  pos: Position
  attributes: PlayerAttributes
  /** 이 선수의 평균 능력치. 정렬과 표시에 쓴다 */
  rating: number
  /** 그 팀에서 가장 눈에 띄는 세 명 안에 드는가 */
  key: boolean
  /**
   * 이 선수를 한마디로 설명하는 능력치.
   *
   * **한국어 이름표를 여기서 붙이지 않는다.** 분석 계층은 값만 정하고
   * 화면이 이름을 붙인다. 그래야 능력치 이름표의 단일 원본이 하나로 남는다.
   */
  best: { key: keyof PlayerAttributes; value: number }
}

export interface OpponentSquad {
  formation: AwayFormationId
  players: OpponentPlayer[]
  /** 주요 선수 셋 */
  keyPlayers: OpponentPlayer[]
  /** 팀 평균 능력치 */
  average: number
}

/** 능력치가 팀 안에서 흩어지는 폭 */
const SPREAD = 3

/**
 * 세기를 곱한 뒤의 천장.
 *
 * 우리 평균의 1.5배는 1~20 눈금에서 평균 17.8 을 뜻한다. 그대로 곱하면
 * 강팀의 능력치가 전부 20 에 붙어버려 **성향이 사라진다** — 브라질과
 * 이탈리아의 앞선이 똑같이 20 이 되면 "브라질은 등 뒤로 넘긴다"가 화면에
 * 안 보인다. 곱한 값을 여기서 한 번 눌러 성향과 편차가 얹힐 자리를 남긴다.
 */
const SCALED_CEILING = 17

/** 성향이 능력치를 얼마나 끌어당기는가 */
const SHAPE_PULL = 4

/**
 * 성향이 밀어 올리는 능력치.
 *
 * `shape` 는 1.0 이 기준이다. 브라질의 배후 1.5 는 "등 뒤로 한 번에 넘긴다"
 * 는 뜻이고, 그런 팀의 앞선은 빠르고 뒤를 노린다. 스페인의 오픈플레이
 * 1.26 은 "짧은 패스로 엮는다" 는 뜻이라 중원의 패스와 시야가 좋다.
 */
const SHAPE_KEYS = {
  behind: ['pace', 'speed', 'offTheBall', 'anticipation'],
  open: ['pass', 'vision', 'technique', 'firstTouch'],
  finish: ['finish', 'composure', 'longShot'],
} as const satisfies Record<string, readonly (keyof PlayerAttributes)[]>

/** 그 자리에서 이 성향이 얼마나 의미 있는가 */
const SHAPE_WEIGHT: Record<keyof typeof SHAPE_KEYS, Partial<Record<Position, number>>> = {
  behind: { FW: 1, MF: 0.5, DF: 0.2 },
  open: { MF: 1, DF: 0.4, FW: 0.4 },
  finish: { FW: 1, MF: 0.4 },
}

const clamp = (v: number) => Math.max(1, Math.min(20, Math.round(v)))

/** 그 팀이 즐겨 서는 대형 하나. 성향에 어울리는 것 중에서 고른다 */
function formationOf(id: OpponentId): AwayFormationId {
  const team = opponentInfo(id)
  // 센 팀은 나와서 하고 약한 팀은 내려선다. 화면과 브리핑이 어긋나지 않게
  const pool =
    team.atk >= 0.5
      ? AWAY_SHAPE_BY_MOOD.ALL_OUT
      : team.def <= -0.6
        ? AWAY_SHAPE_BY_MOOD.PARK_BUS
        : AWAY_SHAPE_BY_MOOD.BALANCED
  const at = Math.floor(fixedNoise(`${id}:shape`) * pool.length)
  return pool[Math.min(pool.length - 1, at)]
}

/** 이 선수에게서 가장 높은 능력치 하나 */
function bestOf(attributes: PlayerAttributes): OpponentPlayer['best'] {
  const entries = Object.entries(attributes) as Array<[keyof PlayerAttributes, number]>
  const [key, value] = entries.reduce((a, b) => (b[1] > a[1] ? b : a))
  return { key, value }
}

/** 이 상대의 명단을 만든다 */
export function opponentSquad(id: OpponentId): OpponentSquad {
  const team = opponentInfo(id)
  const formation = formationOf(id)
  const average = opponentAbilityAverage(id)
  // 우리 평균을 1.0 으로 본 이 팀의 눈금. 17.8 / 11.9 = 1.50 처럼 나온다
  const scale = average / OUR_ABILITY_AVERAGE

  const players: OpponentPlayer[] = AWAY_SHAPES[formation].map(([pos, , , num]) => {
    const base = ATTRIBUTE_DEFAULTS[pos] as unknown as Record<string, number>
    const seed = `${id}:${num}`

    const attributes = Object.fromEntries(
      Object.entries(base).map(([key, value]) => {
        // 팀 세기로 전체를 올리고 내리되, 성향이 얹힐 자리를 남긴다
        let next = Math.min(SCALED_CEILING, value * scale)
        // 성향이 어울리는 능력치를 그 자리만큼 끌어올린다
        for (const [shapeKey, keys] of Object.entries(SHAPE_KEYS)) {
          if (!(keys as readonly string[]).includes(key)) continue
          const weight = SHAPE_WEIGHT[shapeKey as keyof typeof SHAPE_KEYS][pos] ?? 0
          const pull = team.shape[shapeKey as keyof typeof team.shape] - 1
          next += pull * weight * SHAPE_PULL
        }
        // 같은 팀 안에서도 선수마다 다르다
        next += (fixedNoise(`${seed}:${key}`) * 2 - 1) * SPREAD
        return [key, clamp(next)]
      }),
    ) as unknown as PlayerAttributes

    const values = Object.values(attributes)
    const rating = values.reduce((a, b) => a + b, 0) / values.length

    return {
      num,
      pos,
      attributes,
      rating,
      key: false,
      best: bestOf(attributes),
    }
  })

  /**
   * 주요 선수는 **자기 자리 기준으로 얼마나 튀는가**로 뽑는다.
   *
   * 평균만 보면 언제나 미드필더가 뽑힌다. 중원의 기준값이 전 능력치에
   * 걸쳐 고르게 높아서 평균이 가장 크기 때문이다. 그러면 어느 팀을 봐도
   * 주요 선수가 미드필더 셋이라 아무것도 말해주지 않는다.
   *
   * 골키퍼는 뽑지 않는다. 감독이 대비할 대상은 필드 선수다.
   */
  const field = players.filter((p) => p.pos !== 'GK')
  const meanByPos = new Map<Position, number>()
  for (const pos of new Set(field.map((p) => p.pos))) {
    const group = field.filter((p) => p.pos === pos)
    meanByPos.set(pos, group.reduce((a, p) => a + p.rating, 0) / group.length)
  }
  const ranked = [...field]
    .sort((a, b) => b.rating - (meanByPos.get(b.pos) ?? 0) - (a.rating - (meanByPos.get(a.pos) ?? 0)))
    .slice(0, 3)
  for (const p of ranked) p.key = true

  return { formation, players, keyPlayers: ranked, average }
}
