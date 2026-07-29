import type { Position } from './types'

/**
 * 상대 팀의 대형.
 *
 * 사용자가 정했다 — *"각 play마다 상대 포메이션 그리고 상대 팀 경고나
 * 체력 그리고 부상 등 랜덤으로 인카운터하게 해줘"* · *"매번 play할때 마다
 * 상대 포메이션은 랜덤으로 바꿔주고"*.
 *
 * 전에는 상대 대형이 **하나뿐**이었고, 그것도 `src/render/visual.ts` 와
 * `src/ui/SquadPanel.tsx` 두 곳에 따로 적혀 있었다. 큰 경기장과 오른쪽
 * 상대 패널이 서로 다른 자리를 가리키면 둘 중 하나가 거짓말이 된다.
 * 여기가 그 단일 원본이다.
 *
 * ## 좌표
 *
 * 우리 골문이 x=0, 상대 골문이 x=105 다. 상대는 x=105 를 지키므로 숫자가
 * 클수록 자기 골문에 가깝다. y 는 터치라인 0 → 68 이다.
 *
 * ## 확률에 영향이 없다
 *
 * 상대의 공격력·수비력은 `state.opponent`(성향)과 `awayCount`(인원)가
 * 정한다. 대형은 **그 성향이 화면에서 어떻게 보이는가**다. 정직하게
 * 적어둔다 — 대형 자체로 확률이 갈리게 하려면 다섯 국면 밸런스를 처음부터
 * 다시 재야 하고, 그건 파라미터 동결 뒤에 할 일이 아니다.
 *
 * 대신 **성향과 맞는 대형만 뽑는다.** 버스를 세운 팀이 4-3-3 으로 서
 * 있으면 화면이 브리핑과 다른 말을 한다.
 */
export type AwayFormationId = '4-4-2' | '4-3-3' | '5-4-1' | '3-5-2' | '4-2-3-1'

/** 한 자리: 포지션 · x · y · 등번호 */
export type AwaySlot = readonly [Position, number, number, number]

/**
 * 등번호는 대형이 바뀌어도 **역할에 붙어 다닌다.**
 *
 * 9번과 11번은 언제나 최전방이고 2·3·4·5번은 뒷선이다. 그래야 주장
 * 브리핑의 "저쪽 11번이 빠르다"가 어느 대형에서든 같은 사람을 가리킨다.
 */
export const AWAY_SHAPES: Record<AwayFormationId, readonly AwaySlot[]> = {
  '4-4-2': [
    ['GK', 103, 34, 1],
    ['DF', 84, 12, 2],
    ['DF', 86, 27, 5],
    ['DF', 86, 41, 4],
    ['DF', 84, 56, 3],
    ['MF', 66, 14, 7],
    ['MF', 64, 29, 8],
    ['MF', 64, 39, 10],
    ['MF', 66, 54, 6],
    ['FW', 46, 27, 9],
    ['FW', 46, 41, 11],
  ],
  '4-3-3': [
    ['GK', 103, 34, 1],
    ['DF', 83, 12, 2],
    ['DF', 85, 27, 5],
    ['DF', 85, 41, 4],
    ['DF', 83, 56, 3],
    ['MF', 66, 34, 6],
    ['MF', 61, 22, 8],
    ['MF', 61, 46, 10],
    ['FW', 44, 14, 7],
    ['FW', 42, 34, 9],
    ['FW', 44, 54, 11],
  ],
  '5-4-1': [
    ['GK', 103, 34, 1],
    ['DF', 86, 10, 2],
    ['DF', 89, 24, 5],
    ['DF', 90, 34, 4],
    ['DF', 89, 44, 6],
    ['DF', 86, 58, 3],
    ['MF', 72, 15, 7],
    ['MF', 70, 29, 8],
    ['MF', 70, 39, 10],
    ['MF', 72, 53, 12],
    ['FW', 52, 34, 9],
  ],
  '3-5-2': [
    ['GK', 103, 34, 1],
    ['DF', 86, 22, 5],
    ['DF', 87, 34, 4],
    ['DF', 86, 46, 2],
    ['MF', 68, 8, 3],
    ['MF', 64, 24, 8],
    ['MF', 66, 34, 6],
    ['MF', 64, 44, 10],
    ['MF', 68, 60, 7],
    ['FW', 46, 28, 9],
    ['FW', 46, 40, 11],
  ],
  '4-2-3-1': [
    ['GK', 103, 34, 1],
    ['DF', 84, 12, 2],
    ['DF', 86, 27, 5],
    ['DF', 86, 41, 4],
    ['DF', 84, 56, 3],
    ['MF', 71, 28, 6],
    ['MF', 71, 40, 8],
    ['MF', 55, 14, 7],
    ['MF', 53, 34, 10],
    ['MF', 55, 54, 11],
    ['FW', 44, 34, 9],
  ],
}

export const AWAY_FORMATION_IDS = Object.keys(AWAY_SHAPES) as AwayFormationId[]

/**
 * 성향에 어울리는 대형.
 *
 * 다 걸고 나온 팀은 앞을 셋 세우고, 버스를 세운 팀은 뒤를 다섯 세운다.
 * 균형이면 그 사이다. 이 표가 없으면 "상대는 뒤로 물러나 골문 앞을
 * 채웁니다"라고 말해놓고 화면에는 스리백이 서 있게 된다.
 */
export const AWAY_SHAPE_BY_MOOD = {
  ALL_OUT: ['4-3-3', '3-5-2', '4-2-3-1'],
  BALANCED: ['4-4-2', '4-2-3-1', '4-3-3'],
  PARK_BUS: ['5-4-1', '4-4-2', '3-5-2'],
} as const satisfies Record<string, readonly AwayFormationId[]>

/**
 * 인원이 모자라면 **사람이 가장 많은 줄**에서 뺀다.
 *
 * 앞에서부터 기계적으로 자르면 5-4-1 에서 유일한 공격수가 사라진다.
 * 열 명이 된 팀도 공격수는 남긴다 — 실제 축구에서 한 명이 퇴장하면
 * 줄 하나를 줄이지, 최전방을 통째로 지우지 않는다.
 *
 * 같은 수면 중원 → 수비 → 공격 순으로 뺀다. 중원이 가장 대체 가능한
 * 자리이고 공격수를 마지막까지 남기는 것이 실제 축구의 순서다.
 */
export function awaySlots(id: AwayFormationId, count: number): readonly AwaySlot[] {
  const all = AWAY_SHAPES[id]
  if (count >= all.length) return all
  const kept = [...all]
  const order: Position[] = ['MF', 'DF', 'FW']
  while (kept.length > Math.max(1, count)) {
    const size = (pos: Position) => kept.filter(([p]) => p === pos).length
    let drop: Position | null = null
    for (const pos of order) {
      // 한 명뿐인 줄은 지우지 않는다. 골키퍼는 후보가 아니다
      if (size(pos) <= 1) continue
      if (!drop || size(pos) > size(drop)) drop = pos
    }
    // 어느 줄도 뺄 수 없으면(전부 한 명씩) 마지막 사람을 뺀다
    const at = drop
      ? kept.map(([p]) => p).lastIndexOf(drop)
      : kept.length - 1
    kept.splice(at, 1)
  }
  return kept
}
