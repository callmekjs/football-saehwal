import type { Position } from './types'

export type FormationId =
  | '4-4-2'
  | '4-2-3-1'
  | '4-3-3'
  | '5-4-1'
  | '3-4-3'
  | '3-5-2'
  | '4-1-4-1'
  | '4-4-2D'
  | '4-2-2-2'

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

  /*
   * 아래 넷은 전술의 폭을 넓히려고 뒤에 더한 것이다.
   *
   * 다섯 개일 때는 "수비형 하나 · 균형 하나 · 공격형 셋"이라 고르는 축이
   * 사실상 앞뒤 하나뿐이었다. 넷을 더해 **중원의 모양**과 **측면을 누가
   * 맡는가**라는 축을 새로 만들었다. 같은 공격형이라도 4-3-3은 윙어가,
   * 3-5-2는 윙백이, 4-2-2-2는 처진 공격수가 폭을 만든다 — 셋의 대가가
   * 서로 다르다.
   *
   * 계수는 기존 다섯과 같은 규칙으로 잡았다. 수비수 수가 배후와 전진에,
   * 미드필더 수가 탈취에, 공격수 수가 진입에 걸린다. 여기에 중원의 모양이
   * 상대 오픈플레이에 걸린다 — 좁게 모으면 중앙은 막히지만 바깥이 열린다.
   */

  '3-5-2': {
    id: '3-5-2',
    label: '3-5-2',
    hint: '윙백이 위아래를 다 뛴다. 폭은 나오지만 가장 힘들다',
    slots: [
      GK,
      { pos: 'DF', x: 20, y: 21 },
      { pos: 'DF', x: 17, y: 34 },
      { pos: 'DF', x: 20, y: 47 },
      { pos: 'MF', x: 48, y: 7 },
      { pos: 'MF', x: 40, y: 24 },
      { pos: 'MF', x: 36, y: 34 },
      { pos: 'MF', x: 40, y: 44 },
      { pos: 'MF', x: 48, y: 61 },
      { pos: 'FW', x: 72, y: 27 },
      { pos: 'FW', x: 72, y: 41 },
    ],
    // 백3라 배후가 열리지만 미드가 다섯이라 3-4-3보다는 덜 열린다.
    // 윙백이 경기장 세로를 왕복하므로 체력 소모가 아홉 중 가장 크다.
    //
    // 처음 잡은 값(attack 1.16 · enter 1.02 · drain 1.20)으로 재보니 세
    // 국면에서 전부 꼴찌권이었다. 배후와 체력을 둘 다 물면서 얻는 것이
    // 없으면 아무도 안 고르고, 안 고르는 선택지는 폭이 아니라 장식이다.
    // 윙백 둘이 만드는 폭을 전진과 진입에 제대로 얹었다
    coef: { behind: 1.34, oppOpen: 1.24, attack: 1.24, enter: 1.1, steal: 1.16, drain: 1.14 },
  },

  '4-1-4-1': {
    id: '4-1-4-1',
    label: '4-1-4-1',
    hint: '수비 앞에 한 명을 세워 길을 막는다. 대신 공격이 외롭다',
    slots: [
      GK,
      { pos: 'DF', x: 22, y: 10 },
      { pos: 'DF', x: 18, y: 26 },
      { pos: 'DF', x: 18, y: 42 },
      { pos: 'DF', x: 22, y: 58 },
      { pos: 'MF', x: 31, y: 34 },
      { pos: 'MF', x: 49, y: 10 },
      { pos: 'MF', x: 45, y: 27 },
      { pos: 'MF', x: 45, y: 41 },
      { pos: 'MF', x: 49, y: 58 },
      { pos: 'FW', x: 74, y: 34 },
    ],
    // 구성은 4-2-3-1과 같은 4·5·1이지만 성격이 반대다. 홀딩 하나가 수비
    // 라인 앞을 덮어 배후와 중앙이 함께 막히고, 그만큼 앞으로 못 나간다
    coef: { behind: 0.82, oppOpen: 0.8, attack: 0.86, enter: 0.92, steal: 1.1, drain: 0.95 },
  },

  '4-4-2D': {
    id: '4-4-2D',
    label: '4-4-2 다이아몬드',
    hint: '중앙을 겹겹이 쌓는다. 대신 측면을 통째로 내준다',
    slots: [
      GK,
      { pos: 'DF', x: 22, y: 10 },
      { pos: 'DF', x: 18, y: 26 },
      { pos: 'DF', x: 18, y: 42 },
      { pos: 'DF', x: 22, y: 58 },
      { pos: 'MF', x: 33, y: 34 },
      { pos: 'MF', x: 45, y: 22 },
      { pos: 'MF', x: 45, y: 46 },
      { pos: 'MF', x: 57, y: 34 },
      { pos: 'FW', x: 72, y: 27 },
      { pos: 'FW', x: 72, y: 41 },
    ],
    // 중원 넷이 세로로 겹쳐 중앙 탈취가 늘지만 좌우가 빈다.
    // 수비 폭 레버를 넓게 두면 이 약점이 더 커진다 — 두 축이 맞물린다
    coef: { behind: 1.0, oppOpen: 1.16, attack: 1.05, enter: 1.08, steal: 1.14, drain: 1.05 },
  },

  '4-2-2-2': {
    id: '4-2-2-2',
    label: '4-2-2-2',
    hint: '처진 공격수 둘이 바깥을 벌린다. 중원 허리가 얇다',
    slots: [
      GK,
      { pos: 'DF', x: 22, y: 10 },
      { pos: 'DF', x: 18, y: 26 },
      { pos: 'DF', x: 18, y: 42 },
      { pos: 'DF', x: 22, y: 58 },
      { pos: 'MF', x: 36, y: 27 },
      { pos: 'MF', x: 36, y: 41 },
      { pos: 'MF', x: 59, y: 9 },
      { pos: 'MF', x: 59, y: 59 },
      { pos: 'FW', x: 74, y: 27 },
      { pos: 'FW', x: 74, y: 41 },
    ],
    // 앞의 넷이 넓게 벌려 진입이 쉬운 대신, 중원 허리가 둘뿐이라
    // 뺏기고 나면 그 사이가 그대로 통로가 된다.
    //
    // 처음 잡은 값(behind 1.14 · oppOpen 1.10)으로는 세 국면에서 전부
    // 1~2위였다. 어디서나 무난한 선택지가 하나 있으면 "판마다 다른 판단"이
    // 무너진다 — 그게 이 시뮬레이션이 성립하는 조건이다. 허리가 얇은
    // 대가를 제값으로 물렸다
    coef: { behind: 1.26, oppOpen: 1.2, attack: 1.2, enter: 1.12, steal: 0.9, drain: 1.1 },
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
 * 실제 피치 위 인원에 맞춘 포메이션 자리.
 *
 * 전에는 열 명이면 언제나 공격수 자리를 하나 지웠다. 수비수가 퇴장한
 * 4-4-2에서도 그 규칙을 쓰면 남아 있는 공격수 한 명이 수비 자리에
 * 들어가고, 화면은 4-4-1인데 엔진은 3-4-2로 세는 모순이 생긴다.
 *
 * 지금은 포메이션의 자리 수와 실제 등록 포지션 수를 비교해 **사람이
 * 모자란 줄의 자리부터** 뺀다. 선택한 포메이션과 명단 구성이 달라 완전히
 * 같게 만들 수 없을 때도 어긋남이 가장 큰 줄부터 줄이므로, 공격수를
 * 무조건 희생하는 것보다 역할 변경이 적다.
 */
export function slotsForPlayers(id: FormationId, playerPositions: readonly Position[]): Slot[] {
  const kept = [...getFormation(id).slots]
  const playerCounts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const pos of playerPositions) playerCounts[pos] += 1

  while (kept.length > playerPositions.length) {
    const slotCounts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 }
    for (const slot of kept) slotCounts[slot.pos] += 1

    // 같은 차이면 앞선부터 줄이는 축구의 일반적인 열 명 대형을 따른다.
    // 실제 결원이 있는 줄은 차이가 더 커서 이 기본값보다 먼저 선택된다.
    const priority: Position[] = ['FW', 'MF', 'DF', 'GK']
    let dropPos = priority[0]
    for (const pos of priority.slice(1)) {
      if (slotCounts[pos] - playerCounts[pos] > slotCounts[dropPos] - playerCounts[dropPos]) {
        dropPos = pos
      }
    }

    let index = -1
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      if (kept[i].pos === dropPos) {
        index = i
        break
      }
    }
    if (index < 0) break
    kept.splice(index, 1)
  }

  // 줄마다 남은 선수들이 한쪽에 몰리지 않게 그 줄의 중심을 다시 맞춘다.
  const centered = kept.map((slot) => ({ ...slot }))
  for (const pos of ['DF', 'MF', 'FW'] as const) {
    const line = centered.filter((slot) => slot.pos === pos)
    if (line.length === 0) continue
    const mean = line.reduce((sum, slot) => sum + slot.y, 0) / line.length
    for (const slot of line) slot.y += 34 - mean
  }
  return centered
}

/** 기존 호출을 위한 열 명 전용 이름. 실제 남은 포지션을 넘겨야 결원 줄을 안다. */
export function slotsForTenMen(
  id: FormationId,
  playerPositions: readonly Position[] = [],
): Slot[] {
  if (playerPositions.length > 0) return slotsForPlayers(id, playerPositions)
  const fallback = getFormation(id).slots.map((slot) => slot.pos)
  const lastForward = fallback.lastIndexOf('FW')
  if (lastForward >= 0) fallback.splice(lastForward, 1)
  return slotsForPlayers(id, fallback)
}

export interface SlottedPlayer<T> {
  player: T
  slot: Slot
  slotIndex: number
}

/**
 * 선수를 자리에 나누는 단일 규칙.
 *
 * 배치판과 중앙 경기장이 이 함수를 함께 쓴다. 같은 자리 모양 안에서
 * 교체할 때만 기존 자리를 보존하고, 포메이션이 바뀌어 새 자리 모양이
 * 오면 호출자가 빈 `before`를 넘겨 등록 역할부터 다시 맞춘다.
 */
export function assignFormationSlots<T extends { id: string }>(
  players: readonly T[],
  slots: readonly Slot[],
  positionOf: (player: T) => Position,
  before: ReadonlyMap<string, number> = new Map(),
): { placed: Array<SlottedPlayer<T>>; seats: Map<string, number> } {
  const taken: Array<T | null> = new Array(slots.length).fill(null)
  const rest: T[] = []

  for (const player of players) {
    const index = before.get(player.id)
    if (
      index !== undefined &&
      index >= 0 &&
      index < slots.length &&
      taken[index] === null
    ) {
      taken[index] = player
    } else {
      rest.push(player)
    }
  }

  const unmatched: T[] = []
  for (const player of rest) {
    const pos = positionOf(player)
    const index = taken.findIndex((value, i) => value === null && slots[i].pos === pos)
    if (index >= 0) taken[index] = player
    else unmatched.push(player)
  }
  // 역할이 맞는 사람을 전부 세운 뒤에도 남은 선수만 빈자리를 맡는다.
  // 이 순서가 뒤집히면 명단 앞쪽의 남는 수비수가 미드필더 자리를 먼저
  // 가져가, 뒤에 있는 진짜 미드필더가 공격수 자리까지 밀려난다.
  for (const player of unmatched) {
    const index = taken.findIndex((value) => value === null)
    if (index >= 0) taken[index] = player
  }

  const placed: Array<SlottedPlayer<T>> = []
  const seats = new Map<string, number>()
  taken.forEach((player, slotIndex) => {
    if (!player) return
    placed.push({ player, slot: slots[slotIndex], slotIndex })
    seats.set(player.id, slotIndex)
  })
  return { placed, seats }
}

/** 자리 모양이 같은지 비교하는 값. 같을 때만 교체 전 자리를 보존한다. */
export function formationSlotKey(slots: readonly Slot[]): string {
  return slots.map((slot) => `${slot.pos}:${slot.x}:${slot.y}`).join('|')
}
