import { useLayoutEffect, useRef } from 'react'
import { createRng, type Rng } from '../sim/rng'
import { createState, tick } from '../sim/engine'
import { TOTAL_TICKS } from '../sim/constants'
import { VisualMatch } from '../render/visual'
import { drawPitch } from '../render/pitch'
import type { MatchState, Problem } from '../sim/types'

/**
 * 메인 화면 뒤에서 조용히 돌아가는 경기.
 *
 * 실제 축구 게임의 타이틀 화면처럼, 들어오자마자 경기가 이미 살아
 * 움직이고 있어야 한다. 배경용 가짜 애니메이션을 따로 만들지 않고
 * 진짜 엔진과 진짜 관전 연출을 그대로 돌린다 — 따로 만들면 관전
 * 품질을 고칠 때마다 두 군데를 고쳐야 한다.
 *
 * 한 판이 끝나면 시드를 바꿔 다음 판이 이어진다.
 */
export function Backdrop({ problem }: { problem: Problem }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    let round = 0
    let rng: Rng = createRng(problem.seed)
    let state: MatchState = createState(problem)
    let vm = new VisualMatch(state, problem.seed)
    let raf = 0
    let last = performance.now()
    let acc = 0

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      acc += dt * 1000
      while (acc >= 100) {
        acc -= 100
        if (state.tick >= TOTAL_TICKS) {
          round += 1
          const seed = problem.seed + round * 977
          rng = createRng(seed)
          state = createState({ ...problem, seed })
          vm = new VisualMatch(state, seed)
        } else {
          state = tick(state, rng)
          vm.sync(state)
        }
      }
      vm.advance(state, dt)

      const parent = canvas.parentElement
      if (parent) {
        // 배경이므로 해상도를 아낀다
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
        const pw = parent.clientWidth
        const ph = parent.clientHeight
        // 피치 비율을 유지한 채 부모를 가득 덮는다
        const w = Math.max(pw, ph * (105 / 68))
        const h = w * (68 / 105)
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr)
          canvas.height = Math.round(h * dpr)
          canvas.style.width = `${w}px`
          canvas.style.height = `${h}px`
        }
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          drawPitch(ctx, vm, state, w, h)
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [problem])

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
      }}
    />
  )
}
