import type { FormationId } from './formations'
import type { AwayFormationId } from './awayShape'

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
 * 오늘 만나는 상대 팀.
 *
 * 사용자가 정했다 — *"상대방도 좀 선택이 가능한가? 너무 단조로워서"*.
 *
 * **국면 데이터가 아니라 플레이어가 고르는 값이다.** 같은 국면을 아래
 * 순위 팀과도 최상위권 팀과도 만날 수 있어야 한다. 그래서 `Problem` 이
 * 아니라 `MatchState` 에 실린다.
 *
 * 팀 목록의 단일 원본은 `constants.ts` 의 `OPPONENTS` 다. 선수 개인
 * 이름은 넣지 않는다 — 실점 공식이 선수를 기계적으로 지목하기 때문이다.
 */
export type OpponentId = (typeof import('./constants'))['OPPONENTS']['teams'][number]['id']

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
  /** 1~20 능력치 서른여섯 개. 전부 창작이다 */
  attributes: PlayerAttributes
  /** 능력치가 아닌 신상. 화면에만 쓰인다 */
  profile: PlayerProfile
}

/**
 * 1~20 눈금이 아닌 신상.
 *
 * **확률에 닿지 않는다.** 화면이 선수를 구별해 기억하게 하는 값이며,
 * 등번호와 함께 "그 큰 왼발 수비수"처럼 부를 수 있게 한다. 이름을 넣지
 * 않기로 한 대신 이런 것들이 사람을 구별해 준다.
 */
export interface PlayerProfile {
  /** 잘 쓰는 발 */
  foot: '왼발' | '오른발' | '양발'
  /** 신장(cm) */
  height: number
  /** 체중(kg) */
  weight: number
  /** 골키퍼 등급 1~20. 골키퍼가 아니면 낮다 */
  goalkeeping: number
}

/**
 * 선수 능력치. 축구 게임의 관례대로 **1~20** 이며 전부 창작이다.
 *
 * `speed` · `stamina0` · `finishing` 과 **따로 노는 장식이 아니다.**
 * 속도는 `(pace + speed) / 2 × 5`, 마무리는 `0.55 + 0.045 × finish` 와
 * 어긋나지 않아야 하고 `squad.test.ts` 가 그것을 지킨다. 반대로
 * `stamina0` 은 능력이 아니라 **이 국면을 시작하는 시점의 컨디션**이라
 * 능력치와 묶지 않는다 — 벤치가 100인 것은 잘 뛰어서가 아니라 아직 안
 * 뛰었기 때문이다.
 *
 * 여기 있는 값이 확률에 어떻게 닿는지는 `constants.ts` 의 `ABILITY` 가
 * 정한다. **0 이어도 효과가 0 이 되지는 않는다** — 체력이 그렇듯 바닥값을
 * 두고 그 위에서 폭이 열린다.
 */
export interface PlayerAttributes {
  /** ── 기술적 능력 ── */
  /** 개인기 */
  technique: number
  /** 골 결정력 — 엔진의 `finishing` 과 묶인다 */
  finish: number
  /** 드리블 */
  dribble: number
  /** 일대일 마크 */
  marking: number
  /** 장거리 스로인 */
  longThrow: number
  /** 중거리 슛 */
  longShot: number
  /** 코너킥 */
  corner: number
  /** 크로스 */
  cross: number
  /** 태클 */
  tackle: number
  /** 패스 */
  pass: number
  /** 퍼스트 터치 */
  firstTouch: number
  /** 페널티킥 */
  penalty: number
  /** 프리킥 */
  setPiece: number
  /** 헤더 */
  header: number

  /** ── 정신적 능력 ── */
  /** 공 없을 때 움직임 */
  offTheBall: number
  /** 대담성 */
  bravery: number
  /** 리더십 */
  leadership: number
  /** 수비 위치 */
  positioning: number
  /** 승부욕 */
  determination: number
  /** 시야 */
  vision: number
  /** 예측력 */
  anticipation: number
  /** 적극성 */
  aggression: number
  /** 집중력 */
  concentration: number
  /** 천재성 */
  flair: number
  /** 침착성 */
  composure: number
  /** 팀워크 */
  teamwork: number
  /** 판단력 */
  judgement: number
  /** 활동량 */
  workRate: number

  /** ── 신체 ── */
  /** 균형 감각 */
  balance: number
  /** 몸싸움 */
  strength: number
  /** 민첩성 */
  agility: number
  /** 순간 속도 — 엔진의 `speed` 와 묶인다 */
  pace: number
  /** 점프 거리 */
  jump: number
  /** 주력 — 엔진의 `speed` 와 묶인다 */
  speed: number
  /** 지구력 */
  endurance: number
  /** 타고난 체력 */
  naturalFitness: number
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
  /**
   * 이 판의 능력. **판마다 다시 뽑는다.**
   *
   * 사용자가 정했다 — *"선수들의 능력치는 랜덤이야. 게임이 끝나고 다시
   * 플레이를 하면 능력치가 각자 다 다를 거야. 저번처럼 6번만 집중하는 거
   * 하지 말고."*
   *
   * 값을 새로 뽑는 것이 아니라 **누가 어떤 능력을 갖는지**를 다시 뽑는다.
   * 팀이 가진 능력 묶음이 그대로라 가장 느린 수비수의 속도와 가장 좋은
   * 마무리 값이 보존되고, 달라지는 것은 그게 누구냐다. 값 자체를 흔들면
   * 판마다 팀 전력이 널뛰어 다섯 국면의 합격선이 무너진다.
   *
   * 없으면 명단의 고정값을 쓴다. 이 칸이 생기기 전에 쓰인 검사 픽스처가
   * 그대로 살아 있어야 하기 때문이다.
   */
  ability?: MatchAbility
}

/**
 * 한 판 동안 이 선수가 갖는 능력 한 벌.
 *
 * 셋을 **묶어서** 옮긴다. 속도만 섞고 능력치를 그대로 두면 카드에는 발이
 * 느리다고 적힌 선수가 실제로는 배후를 지키게 된다.
 */
export interface MatchAbility {
  speed: number
  finishing: number
  attributes: PlayerAttributes
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
  /**
   * 오늘 만난 상대 팀. 플레이어가 킥오프 전에 고른다.
   *
   * 기준팀(`USA`)이면 모든 계수가 정확히 1.0이라 이 칸이 생기기 전과
   * **비트 단위로 같은 경기**가 된다. 다섯 국면의 합격 기준선은 그
   * 기준팀에서만 잰다.
   */
  opponentTeam: OpponentId
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
  /**
   * 상대 팀의 남은 체력(0~100).
   *
   * 상대도 같이 뛴다. 우리가 세게 누를수록 더 닳고, 전면 공세로 나오면
   * 더 닳는다. 후반으로 그대로 넘어가므로 두 반을 뛰면 후반의 상대는
   * 실제로 지쳐 있다.
   *
   * 선수 개인이 아니라 팀 하나의 값이다 — 상대는 개별로 추적하지 않고
   * 성향 테이블로 다루기 때문이다.
   */
  awayStamina: number
  /**
   * 이번 판에 만난 상대.
   *
   * 사용자가 정했다 — *"각 play마다 상대 포메이션 그리고 상대 팀 경고나
   * 체력 그리고 부상 등 랜덤으로 인카운터하게 해줘"*. 전에는 상대가
   * 성향과 인원수뿐이라 같은 국면을 열 번 해도 언제나 똑같은 팀을 만났다.
   */
  away: AwaySetup
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
   * 국면 카드에 뜨는 한 줄 요약. 화면 표시 전용.
   *
   * **시작 분과 반은 여기 없다.** 모든 국면이 전반판과 후반판을 함께
   * 가지고 플레이어가 고르므로 같은 국면이 두 개의 시작 분을 갖는다.
   * 그래서 시각은 국면이 아니라 **고른 반**이 정한다 —
   * `src/matchClock.ts` 를 보라.
   */
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
 * 이번 판에 만난 상대 한 벌.
 *
 * 국면 시드에서 파생한 **별도 스트림**으로 경기 시작 전에 한 번만 뽑는다.
 * `drawTick()` 의 매 틱 18슬롯은 한 톨도 건드리지 않는다.
 *
 * **확률에 닿는 것은 `stamina` 하나뿐이다.** 나머지는 화면과 브리핑이
 * 읽는 상태다 — 대형과 경고와 부상이 확률을 가르게 하려면 다섯 국면
 * 밸런스를 처음부터 다시 재야 하고, 파라미터 동결을 앞두고 할 일이 아니다.
 * 그래도 지어낸 값은 하나도 없다 — 전부 시드에서 나온 실제 상태이고,
 * 같은 시드는 언제나 같은 상대를 만든다.
 */
export interface AwaySetup {
  /** 상대가 서는 대형. 성향에 어울리는 것만 뽑는다 */
  formation: AwayFormationId
  /** 경고를 이미 안고 있는 상대 등번호 */
  booked: number[]
  /** 무릎이 안 좋은 상대 등번호. 없으면 null */
  injured: number | null
  /** 상대의 시작 체력(0~100). 여기서부터 매 틱 닳는다 */
  stamina: number
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
  /**
   * 이번 판에 만나는 상대를 흔드는 범위.
   *
   * **코드가 아니라 국면 데이터에 적는다.** 새 국면은 자기 띠만 적으면
   * 되고 엔진을 고칠 일이 없다.
   */
  away?: {
    /** 상대 경고 보유 인원 */
    booked?: [number, number]
    /** 상대 시작 체력 */
    stamina?: [number, number]
    /** 무릎이 안 좋은 선수가 있을 확률(0~1) */
    injuryChance?: number
  }
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
