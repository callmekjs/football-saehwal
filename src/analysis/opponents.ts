import { OPPONENTS } from '../sim/constants'
import { HOME_XI } from '../sim/squad'
import type { OpponentId, PlayerAttributes } from '../sim/types'

/**
 * 오늘 만나는 상대 팀을 사람 말로.
 *
 * 사용자가 정했다 — *"상대방도 좀 선택이 가능한가? 너무 단조로워서"* 그리고
 * *"FIFA 순위를 참고해서 10~15개 팀을 만들어봐"*.
 *
 * **표를 두 곳에 두지 않는다.** 국면 선택 화면 · 경기 중 상대 패널 ·
 * 주장 브리핑 · 감독 보고서가 같은 표를 봐야 한다. 나뉘어 있으면 한쪽만
 * 고쳐져서 화면과 주장이 다른 말을 하게 된다. `presets.ts` 와 같은 이유다.
 *
 * 숫자의 단일 원본은 `constants.ts` 의 `OPPONENTS` 이고 여기서는 그것을
 * 읽어 화면 문구로 만들기만 한다.
 */
export type OpponentTeam = (typeof OPPONENTS)['teams'][number]

export const OPPONENT_TEAMS: readonly OpponentTeam[] = OPPONENTS.teams

/** 순위 묶음. 화면에서 팀을 세 줄로 나눠 보여준다 */
export const TIER_LABEL: Record<OpponentTeam['tier'], string> = {
  TOP: '최상위권',
  MID: '중상위권',
  LOWER: '중하위권',
}

/**
 * 밸런스를 재는 기준팀.
 *
 * 이 팀만 계수가 전부 1.0이라, 다섯 국면의 합격 기준선(무개입 50% 이하 ·
 * 격차 20%p 이상)은 언제나 여기서 잰다.
 */
export const REFERENCE_TEAM: OpponentId = 'USA'

export function opponentInfo(id: OpponentId): OpponentTeam {
  const found = OPPONENTS.teams.find((team) => team.id === id)
  if (!found) throw new Error(`없는 상대 팀: ${id}`)
  return found
}

/**
 * 상대 평균 능력치를 **세기 계수에서 유도한다.**
 *
 * 사용자가 정했다 — *"강팀은 선수들의 평균 능력치가 1.5배 높고, 중위권
 * 팀은 우리랑 평균 능력치가 비슷하고, 하위팀은 평균이 우리보다 1.5배
 * 낮겠지?"*
 *
 * **숫자를 따로 적지 않는다.** 능력치 표를 손으로 또 만들면 계수를 튜닝할
 * 때마다 둘이 어긋나서, 화면에는 약하다고 적힌 팀이 실제로는 강하게
 * 플레이하는 일이 생긴다. 세기의 단일 원본은 `atk`·`def` 이고 여기서는
 * 그것을 능력치 눈금으로 옮기기만 한다.
 *
 * `SCALE` 은 사용자가 말한 1.5배가 실제로 나오도록 맞춘 값이다. 계수가
 * 가장 센 아르헨티나가 1.50배, 기준팀 미국이 1.00배, 가장 약한 베트남이
 * 0.68배(≈ 1/1.47)로 나온다.
 */
const SCALE = 0.526

const ATTRIBUTE_KEYS = Object.keys(HOME_XI[0].attributes) as Array<keyof PlayerAttributes>

/** 우리 선발 열한 명의 평균 능력치. 상대를 견주는 기준선이다 */
export const OUR_ABILITY_AVERAGE =
  HOME_XI.reduce(
    (sum, player) =>
      sum +
      ATTRIBUTE_KEYS.reduce((acc, key) => acc + player.attributes[key], 0) /
        ATTRIBUTE_KEYS.length,
    0,
  ) / HOME_XI.length

/** 이 상대의 평균 능력치. 1~20 눈금이며 계수에서 유도한다 */
export function opponentAbilityAverage(id: OpponentId): number {
  const team = opponentInfo(id)
  const strength = (team.atk + team.def) / 2
  const value = OUR_ABILITY_AVERAGE * (1 + strength * SCALE)
  return Math.max(1, Math.min(20, value))
}

/** 우리 대비 몇 배인가. 화면이 `1.5배` 처럼 읽어준다 */
export function opponentAbilityRatio(id: OpponentId): number {
  return opponentAbilityAverage(id) / OUR_ABILITY_AVERAGE
}

/** 순위 묶음별로 갈라 놓은 목록. 화면이 이 순서로 그린다 */
export function teamsByTier(): Array<{ tier: OpponentTeam['tier']; teams: OpponentTeam[] }> {
  const order: Array<OpponentTeam['tier']> = ['TOP', 'MID', 'LOWER']
  return order.map((tier) => ({
    tier,
    teams: OPPONENTS.teams.filter((team) => team.tier === tier),
  }))
}
