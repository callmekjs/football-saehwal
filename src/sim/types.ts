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

export type Position = 'GK' | 'DF' | 'MF' | 'FW'

/**
 * 선수. 전부 창작된 가상 인물이며 이름 칸이 없다.
 *
 * 실존 선수의 이름을 붙이지 않는 이유는 저작권 회피만이 아니다. 이 게임의
 * 실점 공식은 "우리 수비수 중 가장 느린 선수"를 실점 원인으로 기계적으로
 * 지목하므로, 실명이 붙으면 "이 선수 때문에 졌다"가 자동으로 생산된다.
 * 문구를 조심해서 막을 수 있는 것이 아니라 구조가 그렇게 생겼다.
 */
export interface Player {
  /** "DF04" 형태. 포지션 + 등번호 두 자리 */
  id: string
  num: number
  pos: Position
  side: 'HOME' | 'AWAY'
  onBench: boolean
  /** 0~100. 수비수의 최솟값이 배후 실점 확률을 직접 결정한다 */
  speed: number
  /** 국면에서 덮어쓰지 않았을 때의 시작 체력 */
  stamina0: number
  /** 0.7~1.3. 슈팅 기대값에 곱해진다 */
  finishing: number
}

/** 경기 중 변하는 선수 상태 */
export interface PlayerState {
  id: string
  onPitch: boolean
  stamina: number
  /** 경고 보유. 강 압박 유지 시 퇴장 확률이 활성화된다 */
  booked: boolean
  /** 퇴장이나 부상으로 이탈 */
  out: boolean
}

export interface Objective {
  /** SURVIVE = 리드 지키기, EQUALIZE = 동점 이상 */
  type: 'SURVIVE' | 'EQUALIZE'
  /** 이기면 평점에 가산할지 (국면 3의 "욕심의 값") */
  bonusOnWin: boolean
}

/** 지시했지만 아직 데드볼을 기다리는 교체 */
export interface PendingSub {
  out: string
  in: string
  /** 이 틱에 반영된다 */
  atTick: number
}

export interface MatchState {
  tick: number
  /** [우리, 상대] */
  score: [number, number]
  tactics: Tactics
  players: PlayerState[]
  opponent: Mentality
  homeCount: number
  awayCount: number
  subsLeft: number
  pendingSubs: PendingSub[]
  /** 경기 중 일어난 사건 기록. 코멘터리와 분석 화면이 읽는다 */
  log: MatchEventLog[]
}

export interface MatchEventLog {
  tick: number
  kind: 'FOUL' | 'CARD' | 'SEND_OFF' | 'PENALTY' | 'INJURY' | 'SUB' | 'GOAL' | 'CONCEDE'
  target?: string
  detail?: string
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
  objective: Objective
  seed: number
  subsLeft: number
  /** 국면별 시작 체력 덮어쓰기. 없는 선수는 명단의 stamina0 을 쓴다 */
  staminaOverrides: Record<string, number>
  /** 경고를 이미 보유한 선수 */
  booked: string[]
  /** 퇴장이나 부상으로 이미 빠진 선수 */
  unavailable: string[]
  /** 상대 인원. 상대 퇴장 국면에서 10 */
  awayCount: number
}

/**
 * 감독의 개입 하나. 결과가 아니라 이것을 저장해야 경기를 재현할 수 있다.
 *
 * 레버(LINE·PRESS·WIDTH)는 확률에 곱해지는 승수라 곱셈 순서가 없다.
 * 순서가 실제로 의미를 갖는 것은 교체(SUB)뿐이다 — 카드는 유한하고
 * 회수할 수 없으며, 반영에 시간이 걸린다.
 */
export type Decision =
  | { tick: number; type: 'LINE' | 'PRESS' | 'WIDTH'; value: Level }
  | { tick: number; type: 'SUB'; out: string; in: string }
