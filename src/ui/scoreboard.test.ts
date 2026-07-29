import { describe, it, expect } from 'vitest'
import { scoreboardScore } from './scoreboard'
import { VisualMatch } from '../render/visual'
import { createState, tick, checkSub } from '../sim/engine'
import { createRng } from '../sim/rng'
import { TOTAL_TICKS } from '../sim/constants'
import raw from '../data/problems.json' with { type: 'json' }
import { problemById } from '../sim/problems'
import type { Problem } from '../sim/types'

/**
 * 실제 국면 데이터를 그대로 쓴다.
 *
 * 손으로 베낀 사본을 쓰면 앞 감독이 걸어둔 잘못된 설정(`initialTactics`)과
 * 체력·경고가 빠져 전혀 다른 경기가 돈다. 사용자가 실제로 본 화면을
 * 재현하려면 화면이 읽는 것과 같은 데이터를 읽어야 한다.
 */
function problemOf(id: string): Problem {
  return problemById(id)
}

describe('점수판 — 끝났을 때 반드시 시뮬과 같다', () => {
  it('경기 중에는 장면을 기다린다', () => {
    // 시뮬은 이미 2-0인데 화면이 아직 첫 골밖에 못 보여줬다.
    // 이 지연은 의도된 것이다 — 공이 중원에 있는데 숫자만 오르면 안 된다
    expect(scoreboardScore(false, [2, 0], [1, 0])).toEqual([1, 0])
  })

  it('종료 휘슬에서는 장면을 기다리지 않는다', () => {
    /**
     * 이것이 이번에 고친 것이다. 사용자가 브라우저에서 끝까지 돌렸더니
     * 헤더는 1-0인데 감독 보고서는 2-0이라고 말했고 기록에는 87분 골이
     * 남아 있었다. 화면이 못 만든 장면 하나 때문에 **경기가 틀린 점수로
     * 끝났다.** 장면을 놓치는 것보다 점수가 틀린 것이 훨씬 나쁘다
     */
    expect(scoreboardScore(true, [2, 0], [1, 0])).toEqual([2, 0])
    expect(scoreboardScore(true, [1, 3], [1, 0])).toEqual([1, 3])
  })

  it('화면이 시뮬보다 앞서지 않는다', () => {
    // 늦는 것은 의도된 동작이지만 앞서는 것은 어떤 경우에도 옳지 않다.
    // 아직 일어나지 않은 골을 점수판이 먼저 알리는 것이기 때문이다
    expect(scoreboardScore(false, [1, 0], [2, 0])).toEqual([1, 0])
  })
})

/**
 * 브라우저의 두 루프를 그대로 흉내낸다.
 *
 * `useMatch` 는 절대 시각으로 100ms 마다 한 틱을 돌리고, `Pitch` 는 매
 * 프레임 연출을 시뮬 시계까지 따라잡힌다. 이 테스트가 지키는 것은
 * **화면 헤더의 숫자**이지 `VisualMatch` 내부 값이 아니다 — 사용자가 본
 * 것이 헤더였다.
 */
function playInBrowser(
  problem: Problem,
  opts: { fps?: number; stopRenderAt?: number; withDecisions?: boolean } = {},
) {
  const { fps = 60, stopRenderAt = Infinity, withDecisions = true } = opts
  const rng = createRng(problem.seed)
  let s = createState(problem)

  if (withDecisions) {
    // 사용자가 급수 타임에 한 것: 전술 프리셋 + 교체 한 장
    s = { ...s, tactics: { line: 1, press: 1, width: 2 } }
    const out = s.players.find((x) => x.onPitch && !x.out && x.id !== 'GK01')!
    const inId = s.players.find((x) => !x.onPitch && !x.out)!
    if (!checkSub(s, out.id, inId.id)) {
      s = {
        ...s,
        subsLeft: s.subsLeft - 1,
        pendingSubs: [...s.pendingSubs, { out: out.id, in: inId.id, atTick: s.tick + 60 }],
      }
    }
  }

  const vm = new VisualMatch(s, problem.seed)
  let vmTime = 0
  let told = ''
  /** Pitch 가 알려준 "장면의 점수" — MatchScreen 의 `scene` 상태 */
  let scene: [number, number] = [...s.score] as [number, number]
  let clock = 0
  const dt = 1 / fps

  const frames = Math.ceil((TOTAL_TICKS * 0.1 + 2) * fps)
  for (let f = 0; f < frames; f++) {
    clock += dt
    const targetTick = Math.min(TOTAL_TICKS, Math.floor(clock / 0.1))
    let steps = 0
    while (s.tick < targetTick && steps < 60) {
      s = tick(s, rng)
      steps += 1
    }
    const live = s.tick < TOTAL_TICKS

    /**
     * 렌더 루프가 도중에 멈출 수 있다.
     *
     * `requestAnimationFrame` 은 탭이 화면에 없으면 아예 안 돌고, 종료
     * 시점에는 감독 보고서가 같은 국면을 150판 다시 계산하느라 프레임이
     * 통째로 굶기도 한다. **점수판이 그 루프에 의존하면 안 된다.**
     */
    if (f < stopRenderAt) {
      const target = s.tick * 0.1
      vm.sync(s)
      if (live) {
        let budget = 0.4
        while (vmTime + 1e-6 < target && budget > 0) {
          const step = Math.min(1 / 60, target - vmTime)
          vm.advance(s, step)
          vmTime += step
          budget -= step
        }
        if (target - vmTime > 1.5) vmTime = target - 1.5
      }
      const now = `${vm.displayScore[0]}-${vm.displayScore[1]}`
      if (now !== told) {
        told = now
        scene = [...vm.displayScore] as [number, number]
      }
    }
  }

  const header = scoreboardScore(s.tick >= TOTAL_TICKS, s.score, scene)
  return { header, sim: s.score, scene }
}

describe('점수판 — 브라우저 루프 전체', () => {
  const P = problemOf('p02')

  it('사용자가 본 그 경기에서 헤더가 시뮬과 같다', () => {
    // 국면 「잠긴 문」·측면 공략·교체 한 장. 시드는 국면에 박혀 있어
    // 누가 돌리든 같은 경기다
    const r = playInBrowser(P)
    expect(r.header).toEqual(r.sim)
  })

  it('프레임이 아무리 느려도 헤더가 시뮬과 같다', () => {
    for (const fps of [60, 30, 10]) {
      const r = playInBrowser(P, { fps })
      expect(r.header, `${fps}fps`).toEqual(r.sim)
    }
  })

  it('연출이 도중에 멈춰도 헤더가 시뮬과 같다', () => {
    /**
     * **이것이 실제로 깨졌던 경로다.** 화면이 골 장면을 만드는 동안
     * 점수판이 기다리게 돼 있는데, 그 기다림이 끝나기 전에 렌더 루프가
     * 멈추면 숫자가 영영 안 올랐다. 마지막 5초·15초·30초 동안 루프가
     * 죽어도 종료 시점의 숫자는 맞아야 한다
     */
    let stale = 0
    for (const lostSeconds of [5, 15, 30]) {
      const r = playInBrowser(P, { stopRenderAt: (75 - lostSeconds) * 60 })
      expect(r.header, `마지막 ${lostSeconds}초 동안 연출 정지`).toEqual(r.sim)
      if (r.scene[0] !== r.sim[0] || r.scene[1] !== r.sim[1]) stale += 1
    }
    // **표본이 실제로 그 상황을 담고 있어야 한다.** 연출이 끝까지 따라온
    // 판만 모여 있으면 이 테스트는 아무것도 안 지키고 통과한다
    expect(stale, `연출 점수가 시뮬과 달랐던 경우 ${stale}/3`).toBeGreaterThan(0)
  })

  it('모든 국면 · 여러 시드에서 한 건도 어긋나지 않는다', () => {
    /**
     * 한 판으로는 증명이 안 된다. 골이 후반부에 나는 판을 일부러 포함해야
     * 한다 — 장면을 만들 시간이 모자라는 것이 바로 이 결함의 조건이다.
     */
    let checked = 0
    for (const id of raw.map((p) => p.id)) {
      const base = problemOf(id)
      for (let i = 0; i < 8; i++) {
        const problem = { ...base, seed: base.seed + i }
        // 프레임 수를 줄여도 검사하는 것은 같다. 연출은 시뮬 시계를
        // 따라가므로 총 연출량은 프레임 수와 무관하다
        const r = playInBrowser(problem, { fps: 20, withDecisions: i % 2 === 0 })
        expect(r.header, `${id} 시드 ${problem.seed}`).toEqual(r.sim)
        checked += 1
      }
    }
    // 국면은 데이터라 늘어난다. 판 수를 박지 않고 국면 수로 센다
    expect(checked).toBe(raw.length * 8)
  })
})
