/**
 * 첫 화면 전술판이 그릴 스물두 명.
 *
 * 사용자가 정했다 — *"딱 첫 페이지만 봐도 사용자가 아 이거 축구
 * 시뮬레이션이구나 알 수 있도록 만들어줘."* 글로 "축구"라고 적는 것보다
 * 배치판 하나가 빠르다.
 *
 * **여기도 지어낸 그림이 아니다.** 곧 시작할 그 판의 실제 대형과 실제
 * 등번호를 읽는다. 우리 쪽은 국면이 물려준 포메이션, 상대 쪽은 오늘 고른
 * 팀의 성향에서 뽑힌 대형이다. 첫 화면이 4-4-2 를 보여주고 들어갔더니
 * 5-4-1 이면 그 그림은 소개가 아니라 광고지다.
 *
 * 좌표계는 `src/sim` 것을 그대로 쓴다 — x 는 우리 골문 0 에서 상대 골문
 * 105, y 는 터치라인 0 에서 68 이다. 세로로 세우는 일은 그리는 쪽이 한다.
 */
import { awaySlots, type AwayFormationId } from '../sim/awayShape'
import { assignFormationSlots, getFormation, type FormationId } from '../sim/formations'
import { effectivePos } from '../sim/squad'
import { getPlayer } from '../sim/squad'
import type { MatchState, Position } from '../sim/types'

/** 배치판의 점 하나 */
export interface BoardDot {
  num: number
  pos: Position
  /** 우리 골문 0 → 상대 골문 105 */
  x: number
  /** 터치라인 0 → 68 */
  y: number
}

export interface TitleBoard {
  ours: BoardDot[]
  theirs: BoardDot[]
  /**
   * 오른쪽 아래 딱지. 앞 감독이 걸어둔 지시다.
   *
   * 상대 쪽 딱지는 팀 이름과 대형만 쓴다. 성향 한 마디까지 넣으면 판이
   * 작은 화면에서 딱지가 두 줄로 늘어나 잔디를 덮는다. 성향은 상대를
   * 고르는 화면이 이미 자세히 설명한다.
   */
  ourLabel: string
  ourFormation: FormationId
  theirFormation: AwayFormationId
}

const LINE_LABEL = ['라인 낮음', '라인 보통', '라인 높음'] as const
const PRESS_LABEL = ['압박 약', '압박 중', '압박 강'] as const

/**
 * 우리 열한 명.
 *
 * 배치판에서 직접 옮긴 자리가 있으면 그것을 쓴다. 첫 화면에서는 아직
 * 아무도 안 옮겼으므로 포메이션 자리가 그대로 나온다.
 */
function ourDots(state: MatchState, formation: FormationId): BoardDot[] {
  const onPitch = state.players.filter((p) => p.onPitch && !p.out)
  const { placed } = assignFormationSlots(onPitch, getFormation(formation).slots, effectivePos)
  return placed.map(({ player, slot }) => ({
    num: getPlayer(player.id).num,
    pos: effectivePos(player),
    x: player.position?.x ?? slot.x,
    y: player.position?.y ?? slot.y,
  }))
}

export function titleBoard(state: MatchState, formation: FormationId): TitleBoard {
  const theirFormation = state.away.formation
  const { line, press } = state.tactics

  return {
    ours: ourDots(state, formation),
    // 퇴장으로 인원이 준 상대는 열 명으로 선다. `awaySlots` 가 그 규칙이다
    theirs: awaySlots(theirFormation, state.awayCount).map(([pos, x, y, num]) => ({
      num,
      pos,
      x,
      y,
    })),
    ourLabel: `${LINE_LABEL[line]} · ${PRESS_LABEL[press]}`,
    ourFormation: formation,
    theirFormation,
  }
}
