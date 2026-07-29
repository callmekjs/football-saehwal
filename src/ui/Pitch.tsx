import { useLayoutEffect, useRef } from 'react'
import { drawPitch } from '../render/pitch'
import { VisualMatch } from '../render/visual'
import { TOTAL_TICKS } from '../sim/constants'
import { endLabel, type Half } from '../matchClock'
import type { MatchState } from '../sim/types'

/** 시뮬 한 틱이 연출에서 차지하는 시간. 엔진은 100ms 마다 한 번 돈다 */
const TICK_SECONDS = 0.1
/** 연출을 한 번에 진행시키는 폭. 물리와 판단이 이 간격으로 돈다 */
const STEP = 1 / 60
/**
 * 한 프레임에 따라잡을 수 있는 연출 시간.
 *
 * 초당 60프레임이면 실시간의 스물네 배까지 따라잡을 수 있고, 초당
 * 다섯 프레임으로 떨어져도 두 배는 된다. 무제한으로 두면 탭을 오래
 * 비웠다 돌아왔을 때 한 프레임에서 브라우저가 몇 초씩 멈춘다.
 */
const CATCHUP_PER_FRAME = 0.4
/** 이보다 더 뒤처지면 따라잡기를 포기하고 시각을 맞춘다 */
const MAX_LAG = 1.5

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
  const onScoreRef = useRef(onScore)
  stateRef.current = state
  liveRef.current = live
  halfRef.current = half
  onScoreRef.current = onScore

  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let vm = new VisualMatch(stateRef.current, seed)
    let raf = 0
    /** 연출이 지금까지 소화한 시간(초) */
    let vmTime = 0
    /** 마지막으로 알린 점수. 바뀔 때만 알려야 매 프레임 다시 그리지 않는다 */
    let told = ''

    const render = () => {
      const st = stateRef.current
      /**
       * 연출은 **시뮬 시계를 따라간다.**
       *
       * 전에는 프레임 간 실제 경과 시간으로 진행했고, 한 프레임에 최대
       * 0.05초로 잘랐다. 프레임이 밀리면 연출이 그만큼 뒤처지고 **영영
       * 따라잡지 못한다.** 시뮬은 절대 시각으로 750틱을 정확히 도는데
       * 연출만 느려지므로, 실측으로 시뮬이 90분을 지나는 동안 화면은
       * 2초밖에 진행하지 못했다. 교체를 눌러도 화면에서 선수가 안 바뀌고,
       * 골이 나도 장면이 안 나오는 것이 전부 이 한 가지 원인이었다.
       *
       * 한 틱은 100ms 다. 목표 시각은 언제나 `tick × 0.1초`이고, 뒤처진
       * 만큼 한 프레임 안에서 여러 번 나눠 진행해 따라잡는다.
       */
      const target = st.tick * TICK_SECONDS

      // 경기가 처음부터 다시 시작됐다. 지난 경기의 연출을 이어 그리면 안 된다
      if (target + 0.5 < vmTime) {
        vm = new VisualMatch(st, seed)
        vmTime = target
      }

      vm.sync(st)
      if (liveRef.current) {
        let budget = CATCHUP_PER_FRAME
        while (vmTime + 1e-6 < target && budget > 0) {
          const s = Math.min(STEP, target - vmTime)
          vm.advance(st, s)
          vmTime += s
          budget -= s
        }
        // 그래도 못 따라잡을 만큼 밀렸으면 포기하고 시각을 맞춘다.
        // 뒤처진 채로 두면 교체와 골 장면이 몇 십 초씩 늦게 나온다
        if (target - vmTime > MAX_LAG) vmTime = target - MAX_LAG
      }

      // 골 장면이 나온 순간(그리고 종료 휘슬에서) 점수판이 따라 오른다
      const shown = `${vm.displayScore[0]}-${vm.displayScore[1]}`
      if (shown !== told) {
        told = shown
        onScoreRef.current?.([...vm.displayScore] as [number, number])
      }

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
          drawPitch(ctx, vm, stateRef.current, w, h)
          // 멈춘 화면은 고장난 화면과 구분되지 않는다. 끝났다고 말해준다
          if (stateRef.current.tick >= TOTAL_TICKS) {
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
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [seed])

  return <canvas ref={ref} style={{ display: 'block', width: '100%', borderRadius: 8 }} />
}
