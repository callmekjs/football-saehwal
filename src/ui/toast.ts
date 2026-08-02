import { useCallback, useEffect, useRef, useState } from 'react'
import { LEVEL_WORD } from '../analysis/presets'
import type { Level } from '../sim/types'

/**
 * 무엇을 눌렀는지 확인시켜 주는 한 줄.
 *
 * 디자인 핸드오프의 결정이다 — *"되돌릴 수 없는 게임이므로 무엇을 눌렀는지
 * 토스트로 확인시킨다"*.
 *
 * **왜 필요한가.** 이 게임은 75초 동안 시계가 안 멈추고 내린 지시를 되돌릴
 * 수 없다. 그런데 레버를 눌러도 화면에서 즉시 달라지는 것은 칩 하나의
 * 테두리뿐이라, 경기장을 보고 있던 감독은 자기가 눌렀는지도 모른다.
 * 잘못 눌렀다는 것을 **지금** 알아야 다음 지시로 만회할 수 있다.
 *
 * **화면 전용 상태다.** 경기 결과·확률·난수와 무관하고, 결정 이력에도
 * 남지 않는다. 토스트가 떠 있든 없든 경기는 똑같이 흘러간다.
 */

export interface ToastMessage {
  /** 무엇을 했는가 */
  text: string
  /** 실제 경기 계산에서 직전보다 어떻게 달라졌는가 */
  impact?: string
  /** 몇 번째 토스트인가. 같은 문장을 다시 띄워도 새 것으로 보이게 한다 */
  seq: number
}

/** 이 시간이 지나면 사라진다. 핸드오프 값 그대로 */
export const TOAST_LIFE_MS = 1900

/** "압박 → 강" — 레버 하나를 바꿨을 때 */
export function leverToast(type: 'LINE' | 'PRESS' | 'WIDTH', value: Level): string {
  const label = type === 'LINE' ? '수비라인' : type === 'PRESS' ? '압박' : '수비 폭'
  const key = type === 'LINE' ? 'line' : type === 'PRESS' ? 'press' : 'width'
  return `${label} → ${LEVEL_WORD[key][value]}`
}

/** "역습 적용" — 프리셋으로 레버 셋을 한 번에 세웠을 때 */
export function presetToast(name: string): string {
  return `${name} 적용`
}

/** "7번 → 15번 교체" — 카드를 한 장 썼을 때 */
export function subToast(outNum: number, inNum: number): string {
  return `${outNum}번 → ${inNum}번 교체`
}

/**
 * 토스트 하나를 띄운다.
 *
 * 새 토스트가 오면 앞의 것을 **덮어쓴다.** 쌓아 올리면 75초 동안 화면
 * 아래가 안내문으로 덮인다. 감독이 알아야 하는 것은 언제나 **방금 한 것**
 * 하나뿐이다.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const timer = useRef<number>(0)
  const seq = useRef(0)

  const show = useCallback((text: string, impact?: string) => {
    window.clearTimeout(timer.current)
    seq.current += 1
    setToast({ text, impact, seq: seq.current })
    timer.current = window.setTimeout(() => setToast(null), TOAST_LIFE_MS)
  }, [])

  // 화면을 떠날 때 타이머를 걷는다. 안 걷으면 사라진 컴포넌트에 상태를 쓴다
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return { toast, show }
}
