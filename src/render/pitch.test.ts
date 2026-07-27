import { describe, it, expect } from 'vitest'
import { computeDots } from './pitch'
import { createState, tick } from '../sim/engine'
import { createRng } from '../sim/rng'
import { TOTAL_TICKS } from '../sim/constants'
import type { Problem } from '../sim/types'

const P: Problem = {
  id: 'p02',
  title: '잠긴 문',
  order: 1,
  score: [1, 0],
  initialTactics: { line: 1, press: 1, width: 1 },
  initialFormation: '4-4-2',
  objective: { type: 'SURVIVE', bonusOnWin: false },
  seed: 40712,
  subsLeft: 3,
  staminaOverrides: {},
  booked: [],
  unavailable: [],
  awayCount: 11,
}

/** 750틱 동안 각 선수가 어디에 있었는지 모은다 */
function trackAll(problem = P) {
  const rng = createRng(problem.seed)
  let s = createState(problem)
  const paths = new Map<string, Array<[number, number]>>()
  for (let i = 0; i < TOTAL_TICKS; i++) {
    s = tick(s, rng)
    for (const d of computeDots(s)) {
      const key = `${d.side}${d.num}`
      if (!paths.has(key)) paths.set(key, [])
      paths.get(key)!.push([d.x, d.y])
    }
  }
  return paths
}

const spread = (path: Array<[number, number]>) => {
  const xs = path.map((p) => p[0])
  const ys = path.map((p) => p[1])
  return {
    x: Math.max(...xs) - Math.min(...xs),
    y: Math.max(...ys) - Math.min(...ys),
  }
}

describe('선수 움직임', () => {
  const paths = trackAll()

  it('스물두 명이 모두 그려진다', () => {
    expect(paths.size).toBe(22)
  })

  it('아무도 제자리에 얼어 있지 않다', () => {
    // 공만 굴러가고 사람이 멈춰 있으면 축구로 보이지 않는다
    for (const [key, path] of paths) {
      const s = spread(path)
      if (key.endsWith('1') && !key.endsWith('11')) continue // 골키퍼는 따로 본다
      expect(s.x + s.y, `${key} 가 거의 움직이지 않는다`).toBeGreaterThan(12)
    }
  })

  it('골키퍼도 조금은 움직인다', () => {
    for (const key of ['HOME1', 'AWAY1']) {
      const s = spread(paths.get(key)!)
      expect(s.x + s.y).toBeGreaterThan(1)
    }
  })

  it('골키퍼는 골문을 벗어나지 않는다', () => {
    for (const [x] of paths.get('HOME1')!) expect(x).toBeLessThan(12)
    for (const [x] of paths.get('AWAY1')!) expect(x).toBeGreaterThan(93)
  })

  it('한 틱에 순간이동하지 않는다', () => {
    // 골이 들어가면 중앙 재개라 전원이 자기 진영으로 돌아간다. 실제 축구도
    // 그렇고, 화면에서는 부드럽게 이어 그리므로 그 틱만 제외한다.
    const rng = createRng(P.seed)
    let s = createState(P)
    let prev = new Map(computeDots(s).map((d) => [`${d.side}${d.num}`, d]))
    let prevGoals = s.score[0] + s.score[1]

    for (let i = 0; i < TOTAL_TICKS; i++) {
      s = tick(s, rng)
      const now = new Map(computeDots(s).map((d) => [`${d.side}${d.num}`, d]))
      const scored = s.score[0] + s.score[1] !== prevGoals
      if (!scored) {
        for (const [key, d] of now) {
          const p = prev.get(key)!
          const step = Math.hypot(d.x - p.x, d.y - p.y)
          expect(step, `틱 ${i} ${key} 가 한 틱에 ${step.toFixed(1)}m 이동했다`).toBeLessThan(6)
        }
      }
      prev = now
      prevGoals = s.score[0] + s.score[1]
    }
  })

  it('골이 들어가면 중앙에서 재개한다', () => {
    const rng = createRng(P.seed)
    let s = createState(P)
    let prevGoals = s.score[0] + s.score[1]
    for (let i = 0; i < TOTAL_TICKS; i++) {
      s = tick(s, rng)
      if (s.score[0] + s.score[1] !== prevGoals) {
        expect(s.ball.x).toBeCloseTo(0.5, 1)
        expect(s.ball.y).toBeCloseTo(0.5, 1)
        return
      }
      prevGoals = s.score[0] + s.score[1]
    }
    throw new Error('750틱 동안 골이 한 번도 안 났다')
  })

  it('전원이 경기장 안에 있다', () => {
    for (const [key, path] of paths) {
      for (const [x, y] of path) {
        expect(x, key).toBeGreaterThanOrEqual(0)
        expect(x, key).toBeLessThanOrEqual(105)
        expect(y, key).toBeGreaterThanOrEqual(0)
        expect(y, key).toBeLessThanOrEqual(68)
      }
    }
  })

  it('선수들이 서로 겹쳐 한 점에 모이지 않는다', () => {
    const rng = createRng(P.seed)
    let s = createState(P)
    for (let i = 0; i < 200; i++) s = tick(s, rng)
    const dots = computeDots(s)
    let tooClose = 0
    for (let a = 0; a < dots.length; a++) {
      for (let b = a + 1; b < dots.length; b++) {
        if (Math.hypot(dots[a].x - dots[b].x, dots[a].y - dots[b].y) < 1.5) tooClose += 1
      }
    }
    expect(tooClose).toBeLessThan(4)
  })

  it('공을 가지면 우리 팀이 전체적으로 전진한다', () => {
    const rng = createRng(P.seed)
    let s = createState(P)
    const meanX: Record<string, number[]> = { HOME: [], AWAY: [] }
    for (let i = 0; i < TOTAL_TICKS; i++) {
      s = tick(s, rng)
      const home = computeDots(s).filter((d) => d.side === 'HOME' && d.num !== 1)
      meanX[s.ball.owner].push(home.reduce((a, d) => a + d.x, 0) / home.length)
    }
    const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
    expect(avg(meanX.HOME)).toBeGreaterThan(avg(meanX.AWAY) + 8)
  })

  it('포메이션을 바꾸면 배치가 달라진다', () => {
    const back = computeDots(createState({ ...P, initialFormation: '5-4-1' }))
    const front = computeDots(createState({ ...P, initialFormation: '3-4-3' }))
    const homeMean = (d: typeof back) => {
      const f = d.filter((x) => x.side === 'HOME' && x.num !== 1)
      return f.reduce((a, x) => a + x.x, 0) / f.length
    }
    expect(homeMean(front)).toBeGreaterThan(homeMean(back) + 4)
  })
})
