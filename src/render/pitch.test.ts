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

  it('선수마다 움직이는 양이 다르다', () => {
    // 전원에게 같은 오프셋을 더하면 열한 개 점이 강체처럼 통째로 미끄러진다.
    // 수비수는 좁게, 미드필더는 넓게 움직여야 축구로 보인다.
    const home = [...paths].filter(([k]) => k.startsWith('HOME') && k !== 'HOME1')
    const areas = home.map(([, p]) => {
      const s = spread(p)
      return s.x * s.y
    })
    const min = Math.min(...areas)
    const max = Math.max(...areas)
    expect(max).toBeGreaterThan(min * 2)
  })

  it('대형이 강체처럼 통째로 미끄러지지 않는다', () => {
    // 공이 오른쪽으로 가면 다수가 같이 오른쪽으로 도는 것은 정상이다.
    // 문제는 열한 개 점이 한 덩어리로 움직이는 것이다. 강체는 모든 선수
    // 사이 거리가 고정되므로, 서로 간격이 실제로 변하는지를 본다.
    const keys = [...paths.keys()].filter((k) => k.startsWith('HOME') && k !== 'HOME1')
    const len = paths.get(keys[0])!.length

    const ranges: number[] = []
    for (let a = 0; a < keys.length; a++) {
      for (let b = a + 1; b < keys.length; b++) {
        const pa = paths.get(keys[a])!
        const pb = paths.get(keys[b])!
        let min = Infinity
        let max = -Infinity
        for (let i = 0; i < len; i++) {
          const d = Math.hypot(pa[i][0] - pb[i][0], pa[i][1] - pb[i][1])
          if (d < min) min = d
          if (d > max) max = d
        }
        ranges.push(max - min)
      }
    }
    // 모든 짝의 간격 변화 중앙값이 충분히 커야 한다
    ranges.sort((x, y) => x - y)
    const median = ranges[Math.floor(ranges.length / 2)]
    expect(median, '선수 사이 간격이 거의 안 변한다 — 강체다').toBeGreaterThan(8)
  })

  it('간격 변화가 특정 짝에만 몰려 있지 않다', () => {
    // 몇 명만 흔들리고 나머지는 붙어 있으면 그것도 강체에 가깝다
    const keys = [...paths.keys()].filter((k) => k.startsWith('HOME') && k !== 'HOME1')
    const len = paths.get(keys[0])!.length
    for (const key of keys) {
      const self = paths.get(key)!
      let moved = 0
      for (const other of keys) {
        if (other === key) continue
        const p = paths.get(other)!
        let min = Infinity
        let max = -Infinity
        for (let i = 0; i < len; i++) {
          const d = Math.hypot(self[i][0] - p[i][0], self[i][1] - p[i][1])
          if (d < min) min = d
          if (d > max) max = d
        }
        if (max - min > 5) moved += 1
      }
      expect(moved, `${key} 는 다른 선수들과 간격이 거의 고정이다`).toBeGreaterThan(3)
    }
  })

  it('아무리 공을 따라가도 자기 자리를 크게 벗어나지 않는다', () => {
    // 대형이 유지되어야 한다. 공만 쫓아 전원이 몰려다니면 축구가 아니다.
    for (const [key, path] of paths) {
      if (!key.startsWith('HOME') || key === 'HOME1') continue
      const s = spread(path)
      expect(s.x, `${key} 의 앞뒤 활동 폭이 너무 넓다`).toBeLessThan(52)
      expect(s.y, `${key} 의 좌우 활동 폭이 너무 넓다`).toBeLessThan(40)
    }
  })

  it('수비수가 공격수보다 앞에 서지 않는다', () => {
    // 대형이 뒤집히면 포메이션을 유지한다고 할 수 없다
    const rng = createRng(P.seed)
    let s = createState(P)
    for (let i = 0; i < TOTAL_TICKS; i += 25) {
      for (let j = 0; j < 25; j++) s = tick(s, rng)
      const home = computeDots(s).filter((d) => d.side === 'HOME' && d.num !== 1)
      // 4-4-2 기준 앞 넷이 수비수, 뒤 둘이 공격수 (배치 순서 그대로)
      const defMean = home.slice(0, 4).reduce((a, d) => a + d.x, 0) / 4
      const fwMean = home.slice(-2).reduce((a, d) => a + d.x, 0) / 2
      expect(fwMean, `틱 ${i}`).toBeGreaterThan(defMean + 15)
    }
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
