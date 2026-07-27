import type { Position } from './types'

export type FormationId = '4-4-2' | '4-2-3-1' | '4-3-3' | '5-4-1' | '3-4-3'

/** 피치 좌표. x 0~105(우리 골대 → 상대 골대), y 0~68 */
export interface Slot {
  pos: Position
  x: number
  y: number
}

export interface Formation {
  id: FormationId
  label: string
  /** 한 줄 설명. 화면에 그대로 뜬다 */
  hint: string
  /** 열한 자리. 첫 자리는 항상 골키퍼 */
  slots: Slot[]
  /** 이 형태가 확률에 미치는 영향 */
  coef: {
    /** 상대 배후 침투 */
    behind: number
    /** 상대 오픈플레이 */
    oppOpen: number
    /** 우리 전진 시도 횟수 */
    attack: number
    /** 우리 진입 성공 */
    enter: number
    /** 볼 탈취 */
    steal: number
    /** 체력 소모 */
    drain: number
  }
}

const GK: Slot = { pos: 'GK', x: 5, y: 34 }

/**
 * 포메이션 다섯 종.
 *
 * 계수는 수비수 수를 축으로 잡았다. 뒤에 사람이 많을수록 배후가 막히고
 * 앞으로 나가는 힘이 준다. 미드필더 수는 볼 탈취에, 공격수 수는 진입에
 * 걸린다. 이 세 축이 서로 맞물려 있어 "다 좋은 형태"가 존재하지 않는다.
 *
 * 계수는 전부 초기값이며 봇 검증으로 조정한 뒤 8/1 저녁에 동결한다.
 */
export const FORMATIONS: Record<FormationId, Formation> = {
  '4-4-2': {
    id: '4-4-2',
    label: '4-4-2',
    hint: '균형. 어느 쪽으로도 치우치지 않는다',
    slots: [
      GK,
      { pos: 'DF', x: 22, y: 10 },
      { pos: 'DF', x: 18, y: 26 },
      { pos: 'DF', x: 18, y: 42 },
      { pos: 'DF', x: 22, y: 58 },
      { pos: 'MF', x: 45, y: 10 },
      { pos: 'MF', x: 42, y: 27 },
      { pos: 'MF', x: 42, y: 41 },
      { pos: 'MF', x: 45, y: 58 },
      { pos: 'FW', x: 70, y: 27 },
      { pos: 'FW', x: 70, y: 41 },
    ],
    coef: { behind: 1.0, oppOpen: 1.0, attack: 1.0, enter: 1.0, steal: 1.0, drain: 1.0 },
  },

  '4-2-3-1': {
    id: '4-2-3-1',
    label: '4-2-3-1',
    hint: '중원 장악. 공을 뺏지만 골 넣을 사람이 하나뿐이다',
    slots: [
      GK,
      { pos: 'DF', x: 22, y: 10 },
      { pos: 'DF', x: 18, y: 26 },
      { pos: 'DF', x: 18, y: 42 },
      { pos: 'DF', x: 22, y: 58 },
      { pos: 'MF', x: 36, y: 27 },
      { pos: 'MF', x: 36, y: 41 },
      { pos: 'MF', x: 58, y: 12 },
      { pos: 'MF', x: 55, y: 34 },
      { pos: 'MF', x: 58, y: 56 },
      { pos: 'FW', x: 76, y: 34 },
    ],
    coef: { behind: 0.92, oppOpen: 0.88, attack: 0.95, enter: 1.05, steal: 1.18, drain: 1.05 },
  },

  '4-3-3': {
    id: '4-3-3',
    label: '4-3-3',
    hint: '측면을 넓게 쓴다. 상대가 뭉쳐 있을 때 길이 난다',
    slots: [
      GK,
      { pos: 'DF', x: 24, y: 10 },
      { pos: 'DF', x: 18, y: 26 },
      { pos: 'DF', x: 18, y: 42 },
      { pos: 'DF', x: 24, y: 58 },
      { pos: 'MF', x: 42, y: 20 },
      { pos: 'MF', x: 38, y: 34 },
      { pos: 'MF', x: 42, y: 48 },
      { pos: 'FW', x: 72, y: 12 },
      { pos: 'FW', x: 76, y: 34 },
      { pos: 'FW', x: 72, y: 56 },
    ],
    coef: { behind: 1.22, oppOpen: 1.2, attack: 1.24, enter: 1.06, steal: 0.94, drain: 1.1 },
  },

  '5-4-1': {
    id: '5-4-1',
    label: '5-4-1',
    hint: '뒤를 두껍게. 버티지만 공이 앞으로 안 나간다',
    slots: [
      GK,
      { pos: 'DF', x: 26, y: 8 },
      { pos: 'DF', x: 16, y: 22 },
      { pos: 'DF', x: 14, y: 34 },
      { pos: 'DF', x: 16, y: 46 },
      { pos: 'DF', x: 26, y: 60 },
      { pos: 'MF', x: 42, y: 14 },
      { pos: 'MF', x: 38, y: 28 },
      { pos: 'MF', x: 38, y: 40 },
      { pos: 'MF', x: 42, y: 54 },
      { pos: 'FW', x: 68, y: 34 },
    ],
    coef: { behind: 0.5, oppOpen: 0.66, attack: 0.76, enter: 0.86, steal: 0.92, drain: 0.9 },
  },

  '3-4-3': {
    id: '3-4-3',
    label: '3-4-3',
    hint: '전부 앞으로. 뚫리면 그대로 실점이다',
    slots: [
      GK,
      { pos: 'DF', x: 20, y: 22 },
      { pos: 'DF', x: 18, y: 34 },
      { pos: 'DF', x: 20, y: 46 },
      { pos: 'MF', x: 46, y: 8 },
      { pos: 'MF', x: 40, y: 28 },
      { pos: 'MF', x: 40, y: 40 },
      { pos: 'MF', x: 46, y: 60 },
      { pos: 'FW', x: 74, y: 14 },
      { pos: 'FW', x: 78, y: 34 },
      { pos: 'FW', x: 74, y: 54 },
    ],
    coef: { behind: 1.6, oppOpen: 1.5, attack: 1.4, enter: 1.18, steal: 0.86, drain: 1.15 },
  },
}

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[]

export function getFormation(id: FormationId): Formation {
  const f = FORMATIONS[id]
  if (!f) throw new Error(`알 수 없는 포메이션: ${id}`)
  return f
}

/** 이 형태에서 각 포지션이 몇 자리인가 */
export function shapeOf(id: FormationId): Record<Position, number> {
  const counts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const s of getFormation(id).slots) counts[s.pos] += 1
  return counts
}

/**
 * 열 명이 됐을 때의 배치.
 *
 * 공격수를 한 명 빼고 남은 선수가 그 폭을 나눠 메운다. 실제 감독도
 * 대개 앞에서 한 명을 뺀다.
 */
export function slotsForTenMen(id: FormationId): Slot[] {
  const slots = getFormation(id).slots
  const forwards = slots.filter((s) => s.pos === 'FW')
  const drop = forwards[forwards.length - 1]
  const kept = slots.filter((s) => s !== drop)

  // 남은 선수를 가운데 쪽으로 조금씩 당긴다
  return kept.map((s) => (s.pos === 'GK' ? s : { ...s, y: s.y + (34 - s.y) * 0.18 }))
}
