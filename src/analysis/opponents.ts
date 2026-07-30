import { OPPONENTS } from '../sim/constants'
import type { OpponentId } from '../sim/types'

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

/** 순위 묶음별로 갈라 놓은 목록. 화면이 이 순서로 그린다 */
export function teamsByTier(): Array<{ tier: OpponentTeam['tier']; teams: OpponentTeam[] }> {
  const order: Array<OpponentTeam['tier']> = ['TOP', 'MID', 'LOWER']
  return order.map((tier) => ({
    tier,
    teams: OPPONENTS.teams.filter((team) => team.tier === tier),
  }))
}
