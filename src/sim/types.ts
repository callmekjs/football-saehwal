import type { FormationId } from './formations'

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
 * 감독이 배치판에서 지정한 실제 피치 좌표(m).
 *
 * x 는 우리 골문(0)에서 상대 골문(105) 방향, y 는 위 터치라인(0)에서
 * 아래 터치라인(68) 방향이다.
 */
export interface PlayerPosition {
  x: number
  y: number
}

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
/**
 * 선수 한 명에게 내리는 개별 지시.
 *
 * 레버는 팀 전체에 걸리는 전역 설정이라 "지금 저 선수 하나에게 무엇을
 * 시킨다"가 성립하지 않았다. 감독이 판 위의 특정한 한 점을 고르는 조작이
 * 없으면 조작 개수를 아무리 늘려도 같은 불만이 남는다.
 *
 * 다섯은 **서로 다른 종류의 통로**를 쓴다. 같은 종류를 다섯 개 만드는 것보다
 * 다른 종류를 다섯 개 만드는 것이 실제로 판을 넓힌다.
 * - `HOLD` 는 계수 (세트피스 실점에 곱해진다)
 * - `BACK_OFF` 는 이산 집합 (반칙·퇴장 후보에서 빠진다)
 * - `CONSERVE` 는 적분 (체력이 덜 닳아 부상 임계를 피한다)
 * - `DROP_BACK` · `PUSH_UP` 은 **자리 자체를 바꾼다** — 실점은 수비 자원 중
 *   가장 느린 하나로, 득점은 공격 자원 중 마무리가 가장 좋은 하나로
 *   정해지므로, 누가 어느 줄에 서 있느냐가 곧 확률이다. 다섯 중 가장 굵다
 */
export type PlayerOrder =
  | 'NONE'
  | 'HOLD'
  | 'BACK_OFF'
  | 'CONSERVE'
  | 'DROP_BACK'
  | 'PUSH_UP'

export interface PlayerState {
  id: string
  onPitch: boolean
  stamina: number
  /** 경고 보유. 강 압박 유지 시 퇴장 확률이 활성화된다 */
  booked: boolean
  /** 퇴장이나 부상으로 이탈 */
  out: boolean
  /**
   * 감독이 이 선수에게 내린 개별 지시.
   *
   * `NONE` 일 때 모든 계수가 정확히 1.0이어야 한다. 지시가 하나도 없는
   * 경기는 이 칸이 생기기 전과 **비트 단위로 같은 결과**를 내야 하고,
   * 그래야 저장된 시드와 밸런스 기준선이 살아남는다.
   */
  order: PlayerOrder
  /**
   * 배치판에서 직접 정한 자리. null 이면 포메이션과 앞뒤 줄 지시를 따른다.
   *
   * 값이 있는 선수만 새 위치 계수를 받는다. 전원이 null 인 기존 경기는
   * 이 기능을 넣기 전과 비트 단위로 같아야 한다.
   */
  position: PlayerPosition | null
}

export interface Objective {
  /** SURVIVE = 리드 지키기, EQUALIZE = 동점 이상 */
  type: 'SURVIVE' | 'EQUALIZE'
  /** 이기면 평점에 가산할지 (국면 3의 "욕심의 값") */
  bonusOnWin: boolean
}

/**
 * 급수 타임에 주장이 전하는 팀 컨디션.
 *
 * 같은 값이 브리핑 문장과 선수들의 실제 시작 체력을 함께 정한다.
 */
export type CaptainEffect =
  | 'TEAM_RECOVERED'
  | 'TEAM_FATIGUED'
  | 'BACK_LINE_RECOVERED'
  | 'BACK_LINE_FATIGUED'
  | 'FRONT_LINE_RECOVERED'
  | 'FRONT_LINE_FATIGUED'

/**
 * 국면을 여러 번 재현해 찾은 권장 전술.
 *
 * 확률 상수가 아니라 국면 데이터다. 새 국면은 이 값을 JSON에 함께 적기만
 * 하면 분석 화면이 같은 코드로 설명할 수 있다.
 */
export interface Recommendation {
  formation: FormationId
  tactics: Tactics
  explanation: string
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
  /** 주장이 전한 팀 컨디션. 선수 시작 체력에도 이미 반영돼 있다 */
  captainEffect: CaptainEffect
  /** 우리 팀 포메이션. 바꾸면 확률이 즉시 바뀐다 */
  formation: FormationId
  /**
   * 볼 위치. x 0(우리 골대) ~ 1(상대 골대), y 0(위) ~ 1(아래).
   * 판정에 쓰이지 않고 화면에만 쓰인다 — 이미 뽑은 난수에서 파생하므로
   * 별도로 난수를 소비하지 않는다.
   */
  /**
   * `tilt` 은 경기가 어느 쪽으로 기울어 있는지다. -1이면 우리가 밀리고
   * +1이면 우리가 밀어붙인다. 점유가 넘어가도 즉시 뒤집히지 않고 약 2초에
   * 걸쳐 옮겨간다 — 실제 축구에서도 공을 뺏긴다고 전원이 즉시 뒤로 튀지
   * 않는다. 화면의 선수 배치가 이 값을 읽는다.
   */
  ball: { x: number; y: number; owner: 'HOME' | 'AWAY'; tilt: number }
  /** 화면의 양상 지표가 읽는 누적 집계. 판정에는 쓰이지 않는다 */
  stats: {
    homeAttempt: number
    awayAttempt: number
    homeShot: number
    awayShot: number
    setPiece: number
    behind: number
  }
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
  /**
   * 이 국면이 **전반(1)인가 후반(2)인가.** 화면 표시에만 쓰인다.
   *
   * 급수 타임은 전반에도 있고 후반에도 있다. 전반 급수 타임에서 시작한
   * 국면은 **45분 + 추가시간**에 끝나고 그것은 경기 종료가 아니라 **전반
   * 종료**다. 후반이면 90분 + 추가시간이고 그때가 경기 종료다.
   *
   * 이 하나로 시계의 기준선(45분/90분), 추가시간 계산, 종료 문구,
   * 하프타임 주장 정리가 전부 갈린다. 국면마다 코드를 고치지 않도록
   * **데이터에 적는다.**
   */
  half?: 1 | 2
  /**
   * 이 국면이 시작하는 분. **화면 표시에만 쓰인다.**
   *
   * 축구의 반은 45분·90분에 딱 끝나지 않는다. 정규 시간을 채우고 주심이
   * 정한 추가시간을 더 뛰고 끝난다. 이 화면은 15분 구간을 다루므로,
   * 끝나는 시각이 **그 반의 정규 시간 + 추가시간(1~5분)** 이 되도록 시작
   * 분을 잡는다. 즉 전반이면 `30 + 추가시간`, 후반이면 `75 + 추가시간`이다.
   *
   * 국면마다 다르다 — 추가시간은 주심이 그 경기의 지연을 보고 정하는
   * 것이지 고정값이 아니다. 퇴장이 나온 경기는 그만큼 더 준다.
   *
   * 경기 길이는 750틱으로 고정이라 이 숫자를 바꿔도 확률은 움직이지 않는다.
   * 전에는 화면(`App.tsx`)에 국면 id 별 표로 박혀 있었다. 그러면 국면을
   * 하나 넣을 때마다 코드를 고쳐야 해서 "국면은 데이터"라는 전제가 깨진다.
   */
  kickoff?: number
  /** 국면 카드에 뜨는 한 줄 요약. 화면 표시 전용 */
  summary?: string
  score: [number, number]
  /**
   * 앞 감독이 이미 걸어놓은 지시. 이 게임의 성립 조건이다.
   * 중립에서 시작하면 아무것도 안 해도 통과해버려 퍼즐이 되지 않는다.
   */
  initialTactics: Tactics
  /** 앞 감독이 세워둔 포메이션 */
  initialFormation: FormationId
  objective: Objective
  /** 경기 종료 뒤 무개입·사용자 판단과 비교할 검증된 전술 */
  recommendation?: Recommendation
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
  /**
   * 판마다 흔들 범위. 없으면 아무것도 흔들지 않는다.
   *
   * 국면 추가에 코드 수정이 없어야 하므로 허용 범위는 국면 데이터에 적고
   * 코드는 읽기만 한다. 새 국면은 자기 띠만 적으면 된다.
   */
  variation?: Variation
}

/**
 * 시작 조건을 판마다 흔드는 범위.
 *
 * **흔드는 것은 세부이고 전제는 고정이다.** 스코어·목표·인원, 그리고 앞
 * 감독이 걸어둔 전술의 *성격*은 국면의 정체성이라 안 흔든다. 「잠긴 문」은
 * 앞 감독이 잠가놨기 때문에 「잠긴 문」이다 — 잠긴 상태는 유지하고
 * **어떻게 잠겼는지만** 흔든다.
 */
export interface Variation {
  /** 선수별 시작 체력을 자기 기준값에서 이만큼 위아래로 흔든다 */
  staminaSpread?: number
  /** 흔든 체력이 벗어나면 안 되는 범위 */
  staminaRange?: [number, number]
  /** 경고를 이미 안고 시작하는 인원. 반칙이 나오는 자리(DF·MF)에서 뽑는다 */
  booked?: [number, number]
  /**
   * 앞 감독이 이미 걸어둔 선수 지시.
   *
   * **잘못 걸린 것이어야 한다.** 발 빠른 수비수에게 "올라가라",
   * 핵심 선수에게 "아껴 뛰어라" 같은 것이다. 감독의 첫 과제가 그걸
   * 알아채고 푸는 것이므로, 여기에 좋은 지시를 넣으면 국면이 무너진다.
   */
  orders?: [number, number]
  /** 걸 수 있는 잘못된 지시의 종류 */
  orderKinds?: PlayerOrder[]
  /** 레버별로 뽑을 수 있는 값. 적지 않은 레버는 `initialTactics` 그대로 */
  tactics?: { line?: Level[]; press?: Level[]; width?: Level[] }
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
  | { tick: number; type: 'FORMATION'; value: FormationId }
  | { tick: number; type: 'ORDER'; target: string; order: PlayerOrder }
  | { tick: number; type: 'POSITION'; target: string; position: PlayerPosition | null }
