import { STAMINA } from './constants'

/** 한 틱 분량의 체력 소모. 0 아래로 내려가지 않는다 */
export function drainTick(current: number, drainCoefficient: number): number {
  const next = current - STAMINA.drainBase * drainCoefficient
  return next < 0 ? 0 : next
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
  const base = STAMINA.floorFactor + STAMINA.rangeFactor * (stamina / 100)
  return stamina < STAMINA.cliff ? base * STAMINA.cliffPenalty : base
}
