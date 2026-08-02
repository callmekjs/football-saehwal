import { TOTAL_TICKS } from './sim/constants'

/**
 * 경기 시계 — 전반과 후반의 급수 타임.
 *
 * **모든 국면은 전반판과 후반판을 함께 갖는다.** 사용자가 정했다 —
 * *"5개 국면 다 전반전 후반전이 있어야 해. 즉 전반전 워터 브레이크,
 * 후반전 워터브레이크 이렇게 (전후반 22분에 3분씩)"* 그리고
 * *"전후반전 그건 플레이어가 고를 수 있어."*
 *
 * 그래서 시작 분은 **국면이 아니라 반이 정한다.** 전에는 국면마다 다른
 * 시작 분을 데이터에 적었는데, 반을 고를 수 있게 되면 같은 국면이 두 개의
 * 시작 분을 가져야 해서 그 방식이 성립하지 않는다.
 *
 * ```
 * 전반   22:00 급수 타임 ── 3분 ──▶ 25:00 재개 ── 22분 ──▶ 47:00 전반 종료
 * 후반   67:00 급수 타임 ── 3분 ──▶ 70:00 재개 ── 22분 ──▶ 92:00 경기 종료
 * ```
 *
 * ★ **경기 길이는 언제나 750틱이다.** 이 파일은 그 750틱에 **몇 분이라고
 * 이름을 붙일지**만 정한다. 15분이라고 부르든 22분이라고 부르든 확률은
 * 한 톨도 움직이지 않는다 — 그래서 밸런스를 다시 잴 필요가 없다.
 * 여기 있는 것은 전부 순수 함수이고 시계도 난수도 브라우저도 모른다.
 */

export type Half = 1 | 2

/** 급수 타임이 시작하는 분. 각 반의 22분이다 */
export const BREAK_AT = 22

/** 급수 타임이 잡아먹는 경기 시간(분). 실제 쿨링브레이크와 같다 */
export const BREAK_MINUTES = 3

/**
 * 재개한 뒤 실제로 뛰는 경기 시간(분).
 *
 * 750틱이 이만큼으로 보인다. 전반이면 25:00에 재개해 47:00에 끝나므로
 * 정규 20분 + 추가시간 2분이다.
 */
export const SEGMENT_MINUTES = 22

/** 그 반의 정규 시간이 끝나는 분. 전반 45분, 후반 90분 */
export const regulationEnd = (half: Half): number => (half === 1 ? 45 : 90)

/** '전반' 또는 '후반' */
export const halfLabel = (half: Half): string => (half === 1 ? '전반' : '후반')

/** 급수 타임이 시작하는 분. 전반 22분, 후반 67분(45+22) */
export const breakStart = (half: Half): number =>
  (half === 1 ? 0 : regulationEnd(1)) + BREAK_AT

/** 급수 타임이 끝나고 다시 공을 차는 분. 전반 25분, 후반 70분 */
export const kickoffMinute = (half: Half): number => breakStart(half) + BREAK_MINUTES

/** 이 반이 끝나는 분. 전반 47분, 후반 92분 */
export const addedTimeFor = (seed: number, half: Half): number => {
  let mixed = (seed ^ (half === 1 ? 0x9e3779b9 : 0x85ebca6b)) >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d) >>> 0
  return 1 + (mixed % 5)
}

const segmentMinutes = (half: Half, addedTime: number): number =>
  regulationEnd(half) - kickoffMinute(half) + addedTime

export const segmentEnd = (half: Half, addedTime = 2): number =>
  kickoffMinute(half) + segmentMinutes(half, addedTime)

/**
 * 추가시간(분).
 *
 * 급수 타임이 잡아먹은 시간이 그대로 돌아온다고 보면 된다 — 주심은
 * 멈춰 있던 만큼을 뒤에 붙여준다.
 */
export const addedTimeOf = (half: Half, addedTime = 2): number =>
  segmentEnd(half, addedTime) - regulationEnd(half)

/** 지금이 경기 시간으로 몇 분인가 (소수점 포함) */
export const minuteAt = (tick: number, half: Half, addedTime = 2): number =>
  kickoffMinute(half) + (tick / TOTAL_TICKS) * segmentMinutes(half, addedTime)

/**
 * `47:00` 꼴의 시계.
 *
 * 추가시간에도 **시계를 세우지 않는다.** 45:00에 멈춰 세우면 남은 시간을
 * 읽을 수 없고, 실제 중계도 시계는 흘려보내면서 `+2` 를 따로 띄운다.
 */
export function clockOf(tick: number, half: Half, addedTime = 2): string {
  return formatMinute(minuteAt(tick, half, addedTime))
}

/** 분(소수점 포함)을 `25:00` 꼴로 */
export function formatMinute(minutes: number): string {
  const m = Math.floor(minutes)
  const s = String(Math.floor((minutes - m) * 60)).padStart(2, '0')
  return `${m}:${s}`
}

/** 정규 시간을 넘겨 추가시간에 들어갔는가 */
export const inAddedTime = (tick: number, half: Half, addedTime = 2): boolean =>
  minuteAt(tick, half, addedTime) >= regulationEnd(half)

/**
 * 이 반이 끝났을 때 화면에 띄울 말.
 *
 * **전반이 끝난 것은 경기가 끝난 것이 아니다.** 여기서 둘을 같은 말로
 * 쓰면 사용자는 0-1로 지고 있는 전반 종료 화면을 보고 경기를 졌다고
 * 읽는다. 아직 45분이 남아 있다.
 */
export const endLabel = (half: Half): string => (half === 1 ? '전반 종료' : '경기 종료')

/** 급수 타임 머리줄에 쓰는 `전반 22분` 꼴. 브레이크가 시작한 시각이다 */
export const breakLabel = (half: Half): string =>
  `${halfLabel(half)} ${breakStart(half)}분`
