import { TOTAL_TICKS } from '../sim/constants'

/**
 * 경기 시계 — 전반과 후반을 함께 다룬다.
 *
 * **왜 따로 뺐나.** 시계 계산이 세 곳에 흩어져 있었다(`MatchScreen.tsx`,
 * `App.tsx`, `analysis/coach.ts`). 전부 "후반 90분"을 전제로 각자 적혀
 * 있어서, 전반 국면을 넣는 순간 세 곳이 서로 다른 시각을 말하게 된다.
 * 경기 카드에는 "전반 32분"인데 종료 화면에는 "경기 종료"가 뜨는 식이다.
 *
 * 여기 있는 것은 전부 **순수 함수**다. 시계도 난수도 브라우저도 모른다.
 * 화면 표시 전용이라 확률과 밸런스에는 닿지 않는다 — 경기 길이는 언제나
 * 750틱이고 이 파일은 그 750틱에 **몇 분이라고 이름을 붙일지**만 정한다.
 */

export type Half = 1 | 2

/** 한 국면이 다루는 경기 시간(분). 750틱 = 15분이다 */
export const SEGMENT_MINUTES = 15

/**
 * 그 반의 정규 시간이 끝나는 분.
 *
 * 전반은 45분, 후반은 90분이다. 실제 경기는 여기서 끝나지 않고 추가시간을
 * 더 뛴다 — 그래서 이 값은 "끝나는 시각"이 아니라 **추가시간을 세는
 * 기준선**이다.
 */
export const regulationEnd = (half: Half): number => (half === 1 ? 45 : 90)

/** '전반' 또는 '후반' */
export const halfLabel = (half: Half): string => (half === 1 ? '전반' : '후반')

/**
 * 이 국면의 추가시간(분).
 *
 * 국면은 언제나 15분이므로 끝나는 시각은 `시작 분 + 15`이고, 그것이
 * 정규 시간을 넘긴 만큼이 추가시간이다. 전반 32분에 시작하면 47분에
 * 끝나므로 추가시간 2분이다.
 */
export const addedTimeOf = (kickoff: number, half: Half): number =>
  kickoff + SEGMENT_MINUTES - regulationEnd(half)

/** 지금이 경기 시간으로 몇 분인가 (소수점 포함) */
export const minuteAt = (tick: number, kickoff: number): number =>
  kickoff + (tick / TOTAL_TICKS) * SEGMENT_MINUTES

/**
 * `93:12` 꼴의 시계.
 *
 * 추가시간에도 **시계를 세우지 않는다.** 90:00에 멈춰 세우면 남은 시간을
 * 읽을 수 없고, 실제 중계도 시계는 흘려보내면서 `+3` 을 따로 띄운다.
 */
export function clockOf(tick: number, kickoff: number): string {
  const minutes = minuteAt(tick, kickoff)
  const m = Math.floor(minutes)
  const s = String(Math.floor((minutes - m) * 60)).padStart(2, '0')
  return `${m}:${s}`
}

/** 정규 시간을 넘겨 추가시간에 들어갔는가 */
export const inAddedTime = (tick: number, kickoff: number, half: Half): boolean =>
  minuteAt(tick, kickoff) >= regulationEnd(half)

/**
 * 이 반이 끝났을 때 화면에 띄울 말.
 *
 * **전반이 끝난 것은 경기가 끝난 것이 아니다.** 여기서 둘을 같은 말로
 * 쓰면 사용자는 1-0으로 지고 있는 전반 종료 화면을 보고 경기를 졌다고
 * 읽는다.
 */
export const endLabel = (half: Half): string => (half === 1 ? '전반 종료' : '경기 종료')

/** 국면 카드와 급수 타임 머리줄에 쓰는 `전반 32분` 꼴 */
export const kickoffLabel = (kickoff: number, half: Half): string =>
  `${halfLabel(half)} ${kickoff}분`
