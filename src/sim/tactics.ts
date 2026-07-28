import { LINE, PRESS, WIDTH, MENTALITY, COUNT_PENALTY, ORDERS } from './constants'
import { getFormation, type FormationId } from './formations'
import type { Mentality, PlayerState, Tactics } from './types'

/** 레버 3개와 상대 성향이 합쳐져 나오는 최종 승수 묶음 */
export interface Coefficients {
  /** 상대 배후 침투 확률 */
  behind: number
  /** 볼 탈취 (현재 미사용, 수요일 볼 경합에서 쓴다) */
  steal: number
  /** 체력 소모 */
  drain: number
  /** 우리 진입 시 슈팅 가치 */
  entryXg: number
  /** 세트피스 획득 빈도 */
  setPiece: number
  /**
   * 상대 슛 한 번이 골이 될 기대값 배수.
   *
   * "골문 앞을 지켜라" 지시가 여기 걸린다. 상대 공격을 **덜 내주는** 것이
   * 아니라 내준 공격에서 **덜 먹는** 것이다 — 골문 앞에 사람이 남아
   * 있으면 코너도 크로스도 그대로 오지만 마지막에 몸을 던지는 사람이 있다.
   *
   * 오픈플레이와 세트피스 양쪽에 걸린다. 처음에는 세트피스에만 걸었는데
   * 그 채널이 경기당 0.16골뿐이라 두 명을 세워도 실점이 0.03골 줄었다 —
   * 시드 1200개의 노이즈 바닥(±3.8%p)의 10분의 1도 안 되는 효과였다.
   *
   * 배후 침투(`behind`)는 건드리지 않는다. 그쪽은 "느린 수비수를
   * 교체하라"가 이미 쓰고 있는 축이라 겹치면 둘 다 흐려진다.
   */
  oppShotXg: number
  /** 상대 오픈플레이 빈도 */
  oppOpen: number
  /** 파울 빈도 (수요일 경고·퇴장에서 쓴다) */
  foul: number
  /** 우리 전진 시도 횟수 배수 — 폭이 여기 걸린다 */
  widthK: number
  /** 우리 전진 시도가 슈팅 상황까지 갈 확률 배수 */
  openness: number
}

const WIDTH_BY_LEVEL = [WIDTH.narrow, WIDTH.normal, WIDTH.wide] as const

/**
 * 폭을 슛 구역표가 아니라 전진 시도 "횟수"에 건다.
 *
 * 구역 재분배로 표현하면 골문 앞 중앙이 측면보다 세 배 값비싸서 오히려
 * '좁게'가 이겨버린다. 횟수에 걸고 상대 밀집도로 게이트를 두면, 상대가
 * 뭉쳐 있을 때만 넓게가 강력해지고 지키는 판에서는 자동으로 약해진다.
 */
export function resolveCoefficients(
  tactics: Tactics,
  mentality: Mentality,
  oppTenMan: boolean,
  homeTenMan = false,
  formation: FormationId = '4-4-2',
): Coefficients {
  const line = LINE[tactics.line]
  const press = PRESS[tactics.press]
  const width = WIDTH_BY_LEVEL[tactics.width]
  const ment = MENTALITY[mentality]
  const form = getFormation(formation).coef

  const congestion = Math.min(
    1,
    ment.congestion + (oppTenMan ? COUNT_PENALTY.oppTenManCongestion : 0),
  )

  // 우리가 열 명이면 담당 구역이 넓어져 상대의 모든 공격 경로가 살아난다
  const cover = homeTenMan ? COUNT_PENALTY.tenManCover : 1

  return {
    behind: line.behind * ment.behind * cover * form.behind,
    steal: line.steal * press.steal * form.steal,
    drain: line.drain * press.drain * form.drain,
    entryXg: line.entryXg,
    setPiece: line.setPiece * cover,
    // 지시가 걸리기 전의 기본값. `applyOrders` 가 여기에 곱한다
    oppShotXg: 1,
    // 폭을 벌리면 중앙이 열린다. 이 대가가 없으면 넓게가 공짜가 된다
    oppOpen:
      press.oppOpen *
      width.oppOpen *
      ment.oppVolume *
      cover *
      form.oppOpen *
      (oppTenMan ? COUNT_PENALTY.oppTenManVolume : 1),
    foul: press.foul,
    widthK: (width.base + width.congestion * congestion) * form.attack,
    openness: ment.openness * form.enter,
  }
}

/**
 * 개별 지시를 계수에 반영한다.
 *
 * 레버가 정한 계수 위에 얹는다. **순수 함수다** — 인자만 읽고 아무것도
 * 바꾸지 않으며, 시계도 난수도 브라우저도 모른다.
 *
 * ★ **`drawTick()` 은 한 줄도 건드리지 않는다.** 지시가 바꾸는 것은
 * 이미 뽑아둔 난수와 비교되는 **계수**뿐이고(`HOLD`·`CONSERVE`),
 * `BACK_OFF` 는 계수조차 없이 **후보 집합의 원소 수**만 바꾼다. 난수
 * 소비 개수와 순서는 지시가 몇 개 걸리든 언제나 똑같다.
 *
 * ★ **지시가 하나도 없으면 항등이다.** 아래 반복문이 한 번도 돌지 않아
 * 들어온 계수가 비트 단위로 그대로 나간다. 이 성질이 깨지면 저장된 모든
 * 시드의 결과가 달라지고 밸런스 기준선을 처음부터 다시 재야 한다.
 *
 * 기준선을 상수로 박지 않는다. 예컨대 "수비수 4명"을 가정하고 보정하면
 * 5-4-1·3-4-3에서 지시가 없는데도 값이 움직인다.
 */
export function applyOrders(c: Coefficients, players: PlayerState[]): Coefficients {
  let oppShotXg = c.oppShotXg
  let widthK = c.widthK
  let oppOpen = c.oppOpen

  for (const s of players) {
    if (!s.onPitch || s.out) continue
    if (s.order === 'HOLD') {
      // 골문 앞에 남으면 내준 세트피스에서 덜 먹는다.
      // 대신 그만큼 공격에 나갈 몸이 준다
      oppShotXg *= ORDERS.holdOppShotXg
      widthK *= ORDERS.holdWidthK
    } else if (s.order === 'CONSERVE') {
      // 아껴 뛰면 체력이 남지만(그건 engine 쪽 소모 계수다) 그 선수가
      // 맡던 공간이 그만큼 헐거워진다
      oppOpen *= ORDERS.conserveOppOpen
    }
    // BACK_OFF 는 계수를 만지지 않는다. events.ts 의 후보 집합에서 빠진다
  }

  return { ...c, oppShotXg, widthK, oppOpen }
}

/** 이 선수의 체력 소모 배수. 아껴 뛰라고 하면 덜 닳는다 */
export function drainFactorOf(order: PlayerState['order']): number {
  return order === 'CONSERVE' ? ORDERS.conserveDrain : 1
}
