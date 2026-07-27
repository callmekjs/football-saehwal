import { LINE, PRESS, WIDTH, MENTALITY, COUNT_PENALTY } from './constants'
import type { Mentality, Tactics } from './types'

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
): Coefficients {
  const line = LINE[tactics.line]
  const press = PRESS[tactics.press]
  const width = WIDTH_BY_LEVEL[tactics.width]
  const ment = MENTALITY[mentality]

  const congestion = Math.min(
    1,
    ment.congestion + (oppTenMan ? COUNT_PENALTY.oppTenManCongestion : 0),
  )

  // 우리가 열 명이면 담당 구역이 넓어져 상대의 모든 공격 경로가 살아난다
  const cover = homeTenMan ? COUNT_PENALTY.tenManCover : 1

  return {
    behind: line.behind * ment.behind * cover,
    steal: line.steal * press.steal,
    drain: line.drain * press.drain,
    entryXg: line.entryXg,
    setPiece: line.setPiece * cover,
    // 폭을 벌리면 중앙이 열린다. 이 대가가 없으면 넓게가 공짜가 된다
    oppOpen:
      press.oppOpen *
      width.oppOpen *
      ment.oppVolume *
      cover *
      (oppTenMan ? COUNT_PENALTY.oppTenManVolume : 1),
    foul: press.foul,
    widthK: width.base + width.congestion * congestion,
    openness: ment.openness,
  }
}
