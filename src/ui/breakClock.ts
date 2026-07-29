import { useEffect, useRef, useState } from 'react'

/**
 * 급수 타임 시계.
 *
 * 킥오프 전 화면은 설정 메뉴가 아니라 **경기 안의 한 장면**이다. 실제
 * 쿨링브레이크에는 끝이 있고 주심이 휘슬을 분다. 끝이 없으면 그건 급수
 * 타임이 아니라 그냥 옵션 화면이고, "시계는 멈추지 않는다"는 이 경기의
 * 전제와도 앞뒤가 맞지 않는다.
 *
 * **경기 시계(750틱)와는 완전히 별개다.** 이 시계가 0이 되어도 경기 길이
 * 75초는 그대로다. 이건 지시할 수 있는 시간의 길이일 뿐이다.
 *
 * 이 파일은 화면 전용이라 `Date` 대신 `performance.now()` 를 쓴다. 탭이
 * 숨으면 멈추는 `requestAnimationFrame` 을 쓰지 않는 이유는 경기 루프와
 * 같다 — 탭 전환이 일시정지 치트가 되면 안 된다.
 */

/** 급수 타임 길이(초) */
export const BREAK_SECONDS = 60

/**
 * 남은 시간이 이 아래로 내려가면 경고한다.
 *
 * 주장의 브리핑이 열 줄을 넘는다. 읽는 중에 아무 예고 없이 휘슬이 울리면
 * 당황해서 첫 15초를 버린다. 미리 알면 읽던 줄을 접고 손을 옮길 수 있다.
 */
export const BREAK_WARN_SECONDS = 15

export type BreakTone = 'CALM' | 'WARN' | 'OVER'

/**
 * 흐른 시간(ms)으로 남은 초를 센다.
 *
 * 올림한다. 59.4초 남았을 때 "59"라고 적으면 시계가 1초 만에 두 칸
 * 떨어지는 것처럼 보인다. 올림하면 마지막 1초가 온전히 "1"로 보이고
 * 0 은 실제로 끝난 순간에만 나온다.
 */
export function breakRemaining(elapsedMs: number, total: number = BREAK_SECONDS): number {
  const left = total - elapsedMs / 1000
  if (left <= 0) return 0
  return Math.ceil(left)
}

/** 남은 초로 정하는 경고 단계 */
export function breakTone(remaining: number): BreakTone {
  if (remaining <= 0) return 'OVER'
  if (remaining <= BREAK_WARN_SECONDS) return 'WARN'
  return 'CALM'
}

/** `0:47` 꼴. 분이 하나뿐이라 자리를 채우지 않는다 */
export function formatBreak(remaining: number): string {
  const safe = remaining < 0 ? 0 : remaining
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 남은 비율 0~1. 막대 길이에 쓴다 */
export function breakRatio(remaining: number, total: number = BREAK_SECONDS): number {
  if (total <= 0) return 0
  const r = remaining / total
  return r < 0 ? 0 : r > 1 ? 1 : r
}

/** 화면에 뜨는 한 줄. 남은 시간에 따라 말이 바뀐다 */
export function breakMessage(remaining: number): string {
  if (remaining <= 0) return '휘슬 — 경기가 재개됩니다'
  if (remaining <= BREAK_WARN_SECONDS) return '곧 재개됩니다 · 지금 걸어둔 것으로 시작합니다'
  return '이 시간이 지나면 자동으로 재개됩니다'
}

/**
 * 급수 타임 카운트다운을 돌린다.
 *
 * `active` 가 켜진 순간을 기준점으로 잡고 **절대 시각으로** 남은 시간을
 * 잰다. 화면이 얼마나 느리든, 탭을 벗어났다 돌아왔든 남은 시간이 맞는다.
 *
 * 0 이 되면 `onExpire` 를 한 번만 부른다. 부르는 쪽은 사용자가 버튼을
 * 누른 것과 **똑같은 함수**를 넘겨야 한다. 자동 재개와 수동 재개가 서로
 * 다른 길을 타면 한쪽에만 생기는 고장이 반드시 나온다.
 */
export function useBreakClock(active: boolean, onExpire: () => void): number {
  const [remaining, setRemaining] = useState(BREAK_SECONDS)
  const expireRef = useRef(onExpire)
  expireRef.current = onExpire

  useEffect(() => {
    if (!active) {
      setRemaining(BREAK_SECONDS)
      return
    }
    const startedAt = performance.now()
    setRemaining(BREAK_SECONDS)

    let fired = false
    const id = window.setInterval(() => {
      const left = breakRemaining(performance.now() - startedAt)
      setRemaining(left)
      if (left <= 0 && !fired) {
        fired = true
        window.clearInterval(id)
        expireRef.current()
      }
    }, 200)

    return () => window.clearInterval(id)
  }, [active])

  return remaining
}
