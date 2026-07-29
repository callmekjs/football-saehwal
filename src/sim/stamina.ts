import { HALFTIME_RECOVERY, STAMINA } from './constants'

/** 한 틱 분량의 체력 소모. 0 아래로 내려가지 않는다 */
export function drainTick(current: number, drainCoefficient: number): number {
  const next = current - STAMINA.drainBase * drainCoefficient
  return next < 0 ? 0 : next
}

const clampStamina = (stamina: number): number =>
  Math.max(0, Math.min(STAMINA.max, stamina))

/**
 * 하프타임에 되찾는 체력.
 *
 * `rate` 를 인자로 열어둔 것은 밸런스 검증에서 되돌림 상태(0)를 같은 식으로
 * 재기 위해서다. 경기에서는 기본값만 쓰며 난수는 전혀 소비하지 않는다.
 *
 * 첫 항은 많이 지친 선수일수록 회복 폭도 작게 만든다. 둘째 항은 남은
 * 빈칸의 일부만 채우게 해, 어떤 입력도 하프타임 회복 때문에 최대 체력에
 * 도달하지 않게 한다.
 */
export function halftimeRecoveryAmount(
  stamina: number,
  rate: number = HALFTIME_RECOVERY.rate,
): number {
  const current = clampStamina(stamina)
  const headroom = STAMINA.max - current
  return Math.min(
    current * Math.max(0, rate),
    headroom * HALFTIME_RECOVERY.maxLostShare,
  )
}

/** 회복량을 더한 후반 시작 체력 */
export function recoverAtHalftime(
  stamina: number,
  rate: number = HALFTIME_RECOVERY.rate,
): number {
  const current = clampStamina(stamina)
  return current + halftimeRecoveryAmount(current, rate)
}

/**
 * 체력이 실효 능력에 곱해지는 계수.
 *
 * 35 아래에 절벽을 둔다. 소모가 선형이면 강 압박의 이득과 비용이 정확히
 * 상쇄되어 압박 축이 평평해지고 고를 이유가 사라진다. 절벽을 붙여야
 * 비용이 볼록해지고 "언제 압박을 풀 것인가"가 판단이 된다.
 *
 * 국면 3은 주전 셋이 절벽 직전에서 시작하므로 이 함수가 그 국면의
 * 난이도를 직접 결정한다.
 */
export function effectiveFactor(stamina: number): number {
  const base = STAMINA.floorFactor + STAMINA.rangeFactor * (stamina / STAMINA.max)
  return stamina < STAMINA.cliff ? base * STAMINA.cliffPenalty : base
}
