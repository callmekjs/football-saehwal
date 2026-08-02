import { useLayoutEffect, useRef } from 'react'
import { drawPitch } from '../render/pitch'
import { TOTAL_TICKS } from '../sim/constants'
import { endLabel, type Half } from '../matchClock'
import { cheer, whistle } from './sound'
import { VisualClock } from './visualClock'
import type { MatchState } from '../sim/types'
import type { VisualAudioCue } from '../render/visual'

/**
 * 화면 그리기와 별개로 연출 시계를 깨우는 간격.
 *
 * `requestAnimationFrame`은 숨긴 탭에서 완전히 멈출 수 있다. 일반
 * 타이머도 느려질 수는 있지만 절대 시각을 향해 다시 따라오며, 그 사이의
 * 사건을 장부로 남기므로 아웃 휘슬과 골 함성을 건너뛰지 않는다.
 */
const CLOCK_PULSE_MS = 16
/** 오래 숨겼다가 돌아와도 한 번에 브라우저를 오래 붙잡지 않는 처리 폭 */
const CATCHUP_PER_PULSE = 5
/** 밀린 소리가 한꺼번에 겹치지 않게 두는 최소 간격 */
const OUT_CUE_GAP_MS = 380
const GOAL_CUE_GAP_MS = 900

/**
 * 경기 화면의 피치. 시뮬 상태를 구독해 관전 연출을 그린다.
 *
 * `live` 가 꺼지면 연출을 멈춘다. 시뮬은 750틱에서 정확히 서지만
 * 연출은 자기 시계로 도는 별개의 루프라, 이걸 묶어두지 않으면 종료
 * 휘슬 뒤에도 선수들이 계속 뛰고 패스한다. 점수는 멈췄는데 경기는
 * 계속되는 화면이 되어, 끝났다는 사실 자체가 전달되지 않는다.
 * 킥오프 전에도 같은 이유로 멈춰 있어야 한다 — 아직 시작하지 않은
 * 경기에서 공이 돌아다니면 안 된다.
 */
export function Pitch({
  state,
  seed,
  half = 2,
  live = true,
  flipped = false,
  onScore,
}: {
  state: MatchState
  seed: number
  /**
   * 전반 국면이면 1. **전반이 끝난 것은 경기가 끝난 것이 아니다** —
   * 캔버스 위에 "경기 종료"라고 적으면 1-0으로 지고 있는 전반 종료
   * 화면을 보고 경기를 졌다고 읽는다.
   */
  half?: Half
  live?: boolean
  /**
   * 진영을 바꿔 그리는가.
   *
   * 실제 축구는 하프타임에 두 팀이 진영을 맞바꾼다. 전반을 뛰고 이어서
   * 후반에 들어갔을 때만 참이다 — 후반만 골라 시작한 판은 바꿀 전반이
   * 없으므로 그대로 그린다.
   */
  flipped?: boolean
  /**
   * 점수판에 띄울 점수가 바뀌었을 때 부른다.
   *
   * 연출은 골을 예약해두고 진짜 공격 장면을 만든 뒤에 보여준다. 그동안
   * 숫자만 먼저 오르면 관전자는 공이 중원에 있는데 점수가 오르는 것을
   * 본다. 점수판이 장면을 따라가야 둘이 하나의 사건으로 읽힌다.
   * **경기 결과는 여전히 시뮬의 점수로만 판정한다.**
   */
  onScore?: (score: [number, number]) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  const liveRef = useRef(live)
  const halfRef = useRef(half)
  const flippedRef = useRef(flipped)
  const onScoreRef = useRef(onScore)
  stateRef.current = state
  liveRef.current = live
  halfRef.current = half
  flippedRef.current = flipped
  onScoreRef.current = onScore

  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const clock = new VisualClock(stateRef.current, seed)
    let raf = 0
    let pulseTimer = 0
    let audioTimer = 0
    let settlementStartedAt = 0
    const audioQueue: VisualAudioCue[] = []
    /** 마지막으로 알린 점수. 바뀔 때만 알려야 매 프레임 다시 그리지 않는다 */
    let told = ''

    /**
     * 숨긴 탭에서 밀린 사건이 여러 개면 간격을 두고 순서대로 재생한다.
     * 모두 같은 `AudioContext.currentTime`에 던지면 휘슬이 겹쳐 한 번처럼
     * 들리고, 함성 위에 다음 휘슬이 덮인다.
     */
    const playNextCue = () => {
      audioTimer = 0
      const cue = audioQueue.shift()
      if (!cue) return
      if (cue.kind === 'OUT') whistle(1, true)
      else cheer(cue.side === 'HOME')
      const gap = cue.kind === 'OUT' ? OUT_CUE_GAP_MS : GOAL_CUE_GAP_MS
      audioTimer = window.setTimeout(playNextCue, gap)
    }

    const queueCues = (cues: VisualAudioCue[]) => {
      if (cues.length === 0) return
      audioQueue.push(...cues)
      if (!audioTimer) playNextCue()
    }

    /**
     * 관전 연출을 최신 시뮬 시각으로 보낸다.
     *
     * 이 함수는 rAF와 일반 타이머가 함께 부른다. 둘 중 하나가 멈춰도
     * 다른 쪽이 사건 장부와 점수판을 계속 전달한다.
     */
    const pulse = () => {
      const st = stateRef.current
      if (st.tick >= TOTAL_TICKS && liveRef.current && settlementStartedAt === 0) {
        settlementStartedAt = performance.now()
      }
      const settlementSeconds = settlementStartedAt
        ? Math.max(0, (performance.now() - settlementStartedAt) / 1000)
        : 0
      const update = clock.update(
        st,
        liveRef.current ? CATCHUP_PER_PULSE : 0,
        settlementSeconds,
      )
      queueCues(update.cues)

      // 골 장면이 나온 순간(그리고 종료 휘슬에서) 점수판이 따라 오른다
      const shown = `${update.score[0]}-${update.score[1]}`
      if (shown !== told) {
        told = shown
        onScoreRef.current?.(update.score)
      }
    }

    const render = () => {
      pulse()
      const vm = clock.vm
      const parent = canvas.parentElement
      if (parent) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = parent.clientWidth
        const h = Math.round(w * (68 / 105))
        if (canvas.width !== Math.round(w * dpr)) {
          canvas.width = Math.round(w * dpr)
          canvas.height = Math.round(h * dpr)
          canvas.style.width = `${w}px`
          canvas.style.height = `${h}px`
        }
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          drawPitch(ctx, vm, stateRef.current, w, h, flippedRef.current)
          // 멈춘 화면은 고장난 화면과 구분되지 않는다. 끝났다고 말해준다
          if (stateRef.current.tick >= TOTAL_TICKS && !liveRef.current) {
            ctx.save()
            ctx.fillStyle = 'rgba(6,12,10,0.58)'
            ctx.fillRect(0, 0, w, h)
            ctx.fillStyle = '#ffffff'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.font = `600 ${Math.max(15, Math.round(w * 0.045))}px system-ui, sans-serif`
            ctx.fillText(endLabel(halfRef.current), w / 2, h / 2)
            ctx.restore()
          }
        }
      }
      raf = requestAnimationFrame(render)
    }
    pulseTimer = window.setInterval(pulse, CLOCK_PULSE_MS)
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(pulseTimer)
      if (audioTimer) clearTimeout(audioTimer)
    }
  }, [seed])

  return <canvas ref={ref} style={{ display: 'block', width: '100%', borderRadius: 8 }} />
}
