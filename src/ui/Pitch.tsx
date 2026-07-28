import { useLayoutEffect, useRef } from 'react'
import { drawPitch } from '../render/pitch'
import { VisualMatch } from '../render/visual'
import { TOTAL_TICKS } from '../sim/constants'
import type { MatchState } from '../sim/types'

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
  live = true,
}: {
  state: MatchState
  seed: number
  live?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  const liveRef = useRef(live)
  stateRef.current = state
  liveRef.current = live

  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const vm = new VisualMatch(stateRef.current, seed)
    let raf = 0
    let last = performance.now()

    const render = () => {
      const now = performance.now()
      // 탭을 벗어났다 돌아오면 한 프레임에 몇 초가 밀려든다. 상한을 둔다
      const dt = Math.min((now - last) / 1000, 0.05)
      // 멈춰 있는 동안에도 갱신해야 재개 순간에 몇 초가 한꺼번에 밀려들지 않는다
      last = now

      vm.sync(stateRef.current)
      if (liveRef.current) vm.advance(stateRef.current, dt)

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
            ctx.fillText('경기 종료', w / 2, h / 2)
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
