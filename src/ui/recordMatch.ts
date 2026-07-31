/**
 * 끝난 경기 하나를 기록 한 줄로 만든다.
 *
 * **순수 함수다.** 저장도 하지 않고 화면도 모른다. 경기 종료 화면이 이미
 * 가진 값만 받아 `MatchRecord` 를 만들어 돌려주고, 저장은 부르는 쪽이
 * `addRecord` 로 한다. 이렇게 갈라두면 화면을 다시 그리든 배치를 바꾸든
 * 이 규칙은 그대로 남는다.
 *
 * 시각(`at`)을 인자로 받는 이유는 `Date.now()` 를 여기서 부르면 같은
 * 입력이 매번 다른 값을 내놓아 검사할 수 없기 때문이다. 부르는 쪽이
 * 넣는다.
 */
import { judge } from '../sim/engine'
import { opponentInfo } from '../analysis/opponents'
import type { RecordCompare, RecordSetup } from '../analysis/history'
import type { MatchState, OpponentId, Problem } from '../sim/types'
import type { Half } from '../matchClock'
import type { MatchRecord } from './matchHistory'

export interface FinishedMatch {
  problem: Problem
  /** 종료 시점의 경기 상태 */
  final: MatchState
  opponent: OpponentId
  /** 어느 반부터 시작했나 */
  half: Half
  /** 감독이 내린 결정 수 */
  decisions: number
  /**
   * 150판 비교에서 나온 방치 대비 차이. 분석이 아직 안 끝났으면 `null`.
   *
   * 기록이 분석을 기다리게 하지 않는다. 분석은 몇 초 걸리고 그 사이
   * 사용자가 화면을 떠날 수 있는데, 그러면 판 자체가 사라진다.
   */
  delta: number | null
  /**
   * 무개입·나의 판단·권장 전술 150판 비교. `delta` 와 같은 순간에 온다.
   *
   * **`delta` 하나만으로는 다음 판에 쓸 것이 안 남는다.** "+8.2%p" 는
   * 점수일 뿐 무엇을 어떻게 바꾸라는 말이 아니다. 세 갈래의 평균 실점과
   * 세트피스 위험까지 함께 남겨야 `04 · 분석·기록` 이 "권장안은 상대
   * 슈팅을 여기까지 줄인다"를 그릴 수 있다.
   */
  compare?: RecordCompare
  /** 저장 시각(ms) */
  at: number
}

/** 경기가 끝난 시점의 우리 설정. 화면이 아니라 시뮬레이션 상태에서 읽는다 */
function setupOf(final: MatchState): RecordSetup {
  return {
    formation: final.formation,
    line: final.tactics.line,
    press: final.tactics.press,
    width: final.tactics.width,
  }
}

export function toRecord(match: FinishedMatch): MatchRecord {
  const { problem, final, opponent, half, decisions, delta, compare, at } = match
  const recommendation = problem.recommendation
  return {
    at,
    problemId: problem.id,
    problemTitle: problem.title,
    opponentId: opponent,
    opponentName: opponentInfo(opponent).name,
    half,
    score: [final.score[0], final.score[1]],
    // 국면의 목표를 이뤘는가. 승패가 아니라 그 국면이 요구한 것으로 판정한다
    passed: judge(final, problem.objective),
    decisions,
    delta,
    setup: setupOf(final),
    // 권장 전술이 없는 국면도 데이터상 가능하다. 없으면 칸 자체를 만들지 않는다
    ...(recommendation
      ? {
          recommended: {
            formation: recommendation.formation,
            line: recommendation.tactics.line,
            press: recommendation.tactics.press,
            width: recommendation.tactics.width,
          },
        }
      : {}),
    ...(compare ? { compare } : {}),
  }
}

/**
 * 같은 판이 두 번 저장되는 것을 막는다.
 *
 * 종료 화면은 다시 그려질 수 있고 분석이 끝나면 한 번 더 그려진다. 그때마다
 * 저장하면 목록이 같은 줄로 채워진다. **국면·상대·반·점수·결정 수가 모두
 * 같고 몇 초 안에 들어온 것**은 같은 판으로 본다.
 */
const SAME_MATCH_WINDOW_MS = 60_000

export function isSameMatch(record: MatchRecord, prev: MatchRecord): boolean {
  return (
    prev.problemId === record.problemId &&
    prev.opponentId === record.opponentId &&
    prev.half === record.half &&
    prev.score[0] === record.score[0] &&
    prev.score[1] === record.score[1] &&
    prev.decisions === record.decisions &&
    Math.abs(prev.at - record.at) < SAME_MATCH_WINDOW_MS
  )
}

/** 목록 안에 같은 판이 이미 있는가 */
export function isDuplicate(
  record: MatchRecord,
  existing: readonly MatchRecord[],
): boolean {
  return existing.some((prev) => isSameMatch(record, prev))
}
