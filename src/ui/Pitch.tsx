import { useLayoutEffect, useRef } from 'react'
import { drawPitch } from '../render/pitch'
import { VisualMatch } from '../render/visual'
import type { MatchState } from '../sim/types'

/** 경기 화면의 피치. 시뮬 상태를 구독해 관전 연출을 그린다 */
export function Pitch({ state, seed }: { state: MatchState; seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

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
      last = now

      vm.sync(stateRef.current)
      vm.advance(stateRef.current, dt)

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
        }
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [seed])

  return <canvas ref={ref} style={{ display: 'block', width: '100%', borderRadius: 8 }} />
}
