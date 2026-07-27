/**
 * 확률과 승수 상수 전부.
 *
 * 숫자 리터럴을 다른 파일에 흩뿌리지 않는다. 여러 곳에 퍼지면 8월 1일
 * 동결 이후 어디를 손댔는지 추적할 수 없고, 하나 고칠 때마다 정답 경로와
 * 측정한 통과율이 전부 무효가 된다.
 *
 * 값은 docs/design.md 4장에서 가져왔다. 전부 초기값이며 봇 검증으로
 * 조정한 뒤 8/1 저녁에 동결한다.
 */

/** 게임 내 15분을 실시간 75초로 압축. 10Hz × 75초 */
export const TOTAL_TICKS = 750

/** 기본 발생 확률 (틱당). 승수는 여기에 곱해진다 */
export const BASE = {
  /** 우리 전진 시도 — 750틱에 13.5회 */
  A0: 0.018,
  /** 상대 전진 시도 — 750틱에 7.1회 */
  O0: 0.0095,
  /** 상대 배후 침투 시도 — 750틱에 1.2회 */
  B0: 0.0016,
  /** 세트피스 획득 — 750틱에 4.5회 */
  S0: 0.006,
  /** 전진 시도가 슈팅 상황까지 갈 확률 */
  P_ENTER: 0.35,
  P_ENTER_OPP: 0.35,
} as const

/**
 * 수비라인 3단계. 인덱스 = Level.
 *
 * setPiece 열이 이 게임에서 가장 중요한 숫자다. 이것이 없으면 라인 낮음이
 * 배후 침투를 0.45배로 깎기만 해서 전 국면 지배 전략이 되고, "잠글수록
 * 더 맞는다"(국면 2·4의 반전)가 원리적으로 불가능해진다.
 *
 * entryXg 는 기획서의 "공격 시작점 +12m"를 배선한 것이다. 없으면 라인의
 * 최적값이 전 국면에서 '보통'으로 수렴해 축이 죽는다.
 */
export const LINE = [
  { behind: 0.45, steal: 0.8, drain: 0.9, entryXg: 0.7, setPiece: 3.4 },
  { behind: 1.0, steal: 1.0, drain: 1.0, entryXg: 1.0, setPiece: 1.0 },
  { behind: 2.2, steal: 1.25, drain: 1.15, entryXg: 1.3, setPiece: 0.6 },
] as const

/** 압박 강도 3단계. drain 이 압박의 유일한 진짜 비용이다 */
export const PRESS = [
  { steal: 0.7, drain: 0.65, oppOpen: 1.25, foul: 0.8 },
  { steal: 1.0, drain: 1.0, oppOpen: 1.0, foul: 1.0 },
  { steal: 1.4, drain: 1.8, oppOpen: 0.8, foul: 1.5 },
] as const

/**
 * 수비 폭. 상대 밀집도에 연동한다.
 *
 * 넓게가 항상 좋으면 축이 죽고, 항상 나쁘면 국면 1·5의 정답이 사라진다.
 * 상대가 뭉쳐 있을 때만 강하게 만들면 하나의 계수로 지키는 판과 쫓는 판의
 * 정답이 반대가 된다. 이 축이 국면 간 부호가 뒤집히는 유일한 축이다.
 */
export const WIDTH = {
  narrow: { base: 0.95, congestion: -0.2 },
  normal: { base: 1.0, congestion: 0.0 },
  wide: { base: 1.05, congestion: 0.3 },
} as const

/** 상대 성향별 계수. congestion 은 0(활짝 열림) ~ 1(꽉 막힘) */
export const MENTALITY = {
  ALL_OUT: { oppVolume: 1.35, behind: 1.3, openness: 1.4, congestion: 0.1 },
  BALANCED: { oppVolume: 1.0, behind: 1.0, openness: 1.0, congestion: 0.5 },
  PARK_BUS: { oppVolume: 0.7, behind: 0.55, openness: 0.6, congestion: 1.0 },
} as const

/** 슈팅 기대값. 골키퍼 실력은 여기 이미 포함된 것으로 본다 */
export const XG = {
  boxCentre: 0.12,
  boxSide: 0.052,
  outsideBox: 0.031,
  oneOnOne: 0.185,
  setPiece: 0.035,
  penalty: 0.76,
  shotSelectCentre: 0.42,
  shotSelectOneOnOne: 0.75,
} as const

/**
 * 체력. cliff 아래에서 추가 페널티가 붙는다.
 *
 * 소모가 선형이면 강 압박의 이득과 비용이 정확히 상쇄되어 압박 축이
 * 평평해지고 고를 이유가 사라진다. 절벽을 붙여야 비용이 볼록해진다.
 */
export const STAMINA = {
  drainBase: 0.03,
  cliff: 35,
  cliffPenalty: 0.85,
  floorFactor: 0.55,
  rangeFactor: 0.45,
} as const

/** 수적 변화 보정 */
export const COUNT_PENALTY = {
  /** 우리가 10명일 때 상대 전 채널에 곱해지는 커버 공백 계수 */
  tenManCover: 1.22,
  /** 상대가 10명일 때 상대 공격 볼륨 */
  oppTenManVolume: 0.75,
  /** 상대가 10명이면 더 촘촘히 선다 */
  oppTenManCongestion: 0.3,
} as const
