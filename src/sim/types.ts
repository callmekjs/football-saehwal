/** 전술 레버의 3단계. 0 = 낮음/약/좁게, 1 = 보통/중/보통, 2 = 높음/강/넓게 */
export type Level = 0 | 1 | 2

export interface Tactics {
  line: Level
  press: Level
  width: Level
}

/**
 * 상대 성향. 국면 데이터에 직접 쓰지 않고 매 틱 스코어에서 도출한다.
 * 고정값으로 두면 경기 중 동점이 되어도 상대가 계속 내려앉아 있는다.
 */
export type Mentality = 'PARK_BUS' | 'BALANCED' | 'ALL_OUT'

export interface Objective {
  /** SURVIVE = 리드 지키기, EQUALIZE = 동점 이상 */
  type: 'SURVIVE' | 'EQUALIZE'
  /** 이기면 평점에 가산할지 (국면 3의 "욕심의 값") */
  bonusOnWin: boolean
}

export interface MatchState {
  tick: number
  /** [우리, 상대] */
  score: [number, number]
  tactics: Tactics
  stamina: Record<string, number>
  opponent: Mentality
  homeCount: number
  awayCount: number
}

export interface Problem {
  id: string
  title: string
  /** 난이도 사다리에서의 순서 */
  order: number
  score: [number, number]
  /**
   * 앞 감독이 이미 걸어놓은 지시. 이 게임의 성립 조건이다.
   * 중립에서 시작하면 아무것도 안 해도 통과해버려 퍼즐이 되지 않는다.
   */
  initialTactics: Tactics
  homeCount: number
  awayCount: number
  seed: number
  objective: Objective
  /** 우리 수비수 중 가장 느린 선수의 속도. 배후 실점 확률을 직접 결정한다 */
  minDefenderSpeed: number
  startStamina: Record<string, number>
}

export type Decision = {
  tick: number
  type: 'LINE' | 'PRESS' | 'WIDTH'
  value: Level
}
