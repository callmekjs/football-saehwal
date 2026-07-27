import { describe, it, expect } from 'vitest'
import { VisualMatch, PITCH_W, PITCH_H, GOAL_HALF, GOAL_MID } from './visual'
import { createState, tick } from '../sim/engine'
import { createRng } from '../sim/rng'
import { TOTAL_TICKS } from '../sim/constants'
import type { MatchState, Problem } from '../sim/types'

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

/** 경기를 관전하며 매 프레임을 기록한다. 화면과 같은 60fps로 돈다 */
function watch(problem = P, ticks = TOTAL_TICKS) {
  const rng = createRng(problem.seed)
  let s = createState(problem)
  const vm = new VisualMatch(s, problem.seed)

  const frames: Array<{
    state: MatchState
    holder: string | null
    mode: string
    ball: { x: number; y: number; willScore: boolean; toX: number; toY: number }
    celebrating: boolean
    scoredBy: 'HOME' | 'AWAY' | null
    players: Array<{ id: string; x: number; y: number; v: number }>
  }> = []

  for (let i = 0; i < ticks; i++) {
    s = tick(s, rng)
    vm.sync(s)
    // 한 틱(0.1초)을 6프레임으로 나눠 진행한다
    for (let f = 0; f < 6; f++) {
      vm.advance(s, 1 / 60)
    }
    frames.push({
      state: s,
      holder: vm.ball.holder,
      mode: vm.ball.mode,
      ball: {
        x: vm.ball.x,
        y: vm.ball.y,
        willScore: vm.ball.willScore,
        toX: vm.ball.toX,
        toY: vm.ball.toY,
      },
      celebrating: vm.celebration !== null,
      scoredBy: vm.celebration?.side ?? null,
      players: vm.players.map((p) => ({ id: p.id, x: p.x, y: p.y, v: Math.hypot(p.vx, p.vy) })),
    })
  }
  return { frames, vm }
}

describe('공과 선수의 연결 — 출시 기준', () => {
  const { frames } = watch()

  it('공은 항상 누군가에게 있거나 날아가는 중이다', () => {
    // 공만 혼자 굴러가는 화면이 이 게임의 가장 큰 결함이었다
    const loose = frames.filter((f) => f.mode === 'LOOSE').length
    expect(loose / frames.length).toBeLessThan(0.05)
  })

  it('공을 가진 선수의 발밑에 공이 있다', () => {
    let far = 0
    for (const f of frames) {
      if (f.mode !== 'HELD' || !f.holder) continue
      const h = f.players.find((p) => p.id === f.holder)!
      if (Math.hypot(h.x - f.ball.x, h.y - f.ball.y) > 2.6) far += 1
    }
    expect(far).toBe(0)
  })

  it('패스가 실제로 오간다', () => {
    let passes = 0
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].mode === 'PASS' && frames[i - 1].mode !== 'PASS') passes += 1
    }
    // 관전자가 보는 것은 75초의 실시간 축구다. 실제 축구는 75초에 양 팀
    // 합쳐 스무 번 안팎 주고받는다. 서른 번 밑으로 떨어지면 공이 한
    // 사람에게 오래 머물러 정적으로 보인다.
    expect(passes).toBeGreaterThan(30)
    expect(passes).toBeLessThan(90)
  })

  it('공을 잡는 선수가 계속 바뀐다', () => {
    const holders = new Set(frames.map((f) => f.holder).filter(Boolean))
    expect(holders.size).toBeGreaterThan(12)
  })

  it('양 팀이 모두 공을 잡는다', () => {
    const sides = new Set(
      frames.map((f) => f.holder?.[0]).filter(Boolean),
    )
    expect(sides.has('H')).toBe(true)
    expect(sides.has('A')).toBe(true)
  })

  it('공 가진 선수가 대체로 압박을 받는다', () => {
    // 실제 축구에서 볼 소유자와 가장 가까운 수비수는 대개 5~10미터에 있다.
    // 패스를 막 받은 순간에는 더 멀고, 시간이 지나면 좁혀진다.
    const gaps: number[] = []
    for (const f of frames) {
      if (f.mode !== 'HELD' || !f.holder) continue
      const side = f.holder[0]
      let near = Infinity
      for (const p of f.players) {
        if (p.id[0] === side) continue
        near = Math.min(near, Math.hypot(p.x - f.ball.x, p.y - f.ball.y))
      }
      gaps.push(near)
    }
    gaps.sort((a, b) => a - b)
    expect(gaps[Math.floor(gaps.length / 2)], '가장 가까운 수비수까지 중앙값').toBeLessThan(11)
    expect(gaps.filter((g) => g < 15).length / gaps.length).toBeGreaterThan(0.7)
  })

  it('수비수가 공 쪽으로 실제로 좁혀 들어온다', () => {
    // 거리가 가깝다는 것만으로는 부족하다. 붙으러 오는 움직임이 있어야 한다.
    // 한 사람이 공을 잡고 있는 동안 가장 가까운 상대와의 거리를 추적한다.
    let closing = 0
    let spells = 0
    let start = -1
    let startGap = 0

    const gapAt = (i: number) => {
      const f = frames[i]
      const side = f.holder![0]
      let near = Infinity
      for (const p of f.players) {
        if (p.id[0] === side) continue
        near = Math.min(near, Math.hypot(p.x - f.ball.x, p.y - f.ball.y))
      }
      return near
    }

    for (let i = 0; i < frames.length; i++) {
      const holding = frames[i].mode === 'HELD' && frames[i].holder
      const sameAsBefore = i > 0 && frames[i - 1].holder === frames[i].holder
      if (holding && !sameAsBefore) {
        start = i
        startGap = gapAt(i)
      } else if (start >= 0 && (!holding || i === frames.length - 1)) {
        if (i - start >= 5) {
          spells += 1
          if (gapAt(i - 1) < startGap - 0.5) closing += 1
        }
        start = -1
      }
    }
    expect(spells).toBeGreaterThan(20)
    expect(closing / spells, '압박이 좁혀지는 비율').toBeGreaterThan(0.5)
  })

  it('슛이 골대 쪽으로 날아간다', () => {
    let shots = 0
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].mode === 'SHOT' && frames[i - 1].mode !== 'SHOT') shots += 1
    }
    expect(shots).toBeGreaterThan(2)
  })
})

describe('선수 움직임 — 출시 기준', () => {
  const { frames } = watch()

  it('스물두 명이 그려진다', () => {
    expect(frames[0].players).toHaveLength(22)
  })

  it('전원이 경기장 안에 있다', () => {
    for (const f of frames) {
      for (const p of f.players) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(PITCH_W)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(PITCH_H)
      }
    }
  })

  it('사람이 낼 수 있는 속도를 넘지 않는다', () => {
    for (const f of frames) {
      for (const p of f.players) {
        expect(p.v, `${p.id} 가 초속 ${p.v.toFixed(1)}m 로 달린다`).toBeLessThan(9)
      }
    }
  })

  it('서 있는 순간과 뛰는 순간이 둘 다 있다', () => {
    // 계속 흔들리기만 하면 사람이 아니다
    let still = 0
    let sprint = 0
    for (const f of frames) {
      for (const p of f.players) {
        if (p.v < 0.3) still += 1
        if (p.v > 5) sprint += 1
      }
    }
    expect(still).toBeGreaterThan(frames.length)
    expect(sprint).toBeGreaterThan(frames.length)
  })

  it('한 프레임에 순간이동하지 않는다', () => {
    for (let i = 1; i < frames.length; i++) {
      // 세리머니가 끝나면 킥오프라 전원이 제자리로 돌아간다. 그 순간만 제외
      const restart = frames[i - 1].celebrating && !frames[i].celebrating
      if (restart) continue
      for (const p of frames[i].players) {
        const q = frames[i - 1].players.find((x) => x.id === p.id)!
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1.6)
      }
    }
  })

  it('한 점에 뭉치지 않는다', () => {
    const f = frames[Math.floor(frames.length / 2)]
    let tooClose = 0
    for (let a = 0; a < f.players.length; a++) {
      for (let b = a + 1; b < f.players.length; b++) {
        if (Math.hypot(f.players[a].x - f.players[b].x, f.players[a].y - f.players[b].y) < 1.2) {
          tooClose += 1
        }
      }
    }
    expect(tooClose).toBeLessThan(3)
  })

  it('골키퍼는 골문 앞을 지킨다', () => {
    for (const f of frames) {
      const hg = f.players.find((p) => p.id === 'H1')!
      const ag = f.players.find((p) => p.id === 'A1')!
      expect(hg.x).toBeLessThan(18)
      expect(ag.x).toBeGreaterThan(87)
    }
  })

  it('대형이 강체처럼 통째로 미끄러지지 않는다', () => {
    const ids = frames[0].players.filter((p) => p.id.startsWith('H') && p.id !== 'H1').map((p) => p.id)
    const ranges: number[] = []
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        let min = Infinity
        let max = -Infinity
        for (const f of frames) {
          const pa = f.players.find((p) => p.id === ids[a])!
          const pb = f.players.find((p) => p.id === ids[b])!
          const d = Math.hypot(pa.x - pb.x, pa.y - pb.y)
          if (d < min) min = d
          if (d > max) max = d
        }
        ranges.push(max - min)
      }
    }
    ranges.sort((x, y) => x - y)
    expect(ranges[Math.floor(ranges.length / 2)]).toBeGreaterThan(10)
  })
})

describe('골 — 반드시 골대 안으로 들어간다', () => {
  const { frames } = watch()

  /** 시뮬이 득점으로 판정한 슛만 모은다 */
  const scoringShots = frames.filter(
    (f, i) => f.mode === 'SHOT' && f.ball.willScore && (i === 0 || frames[i - 1].mode !== 'SHOT'),
  )

  it('경기 중 득점이 나온다', () => {
    expect(scoringShots.length).toBeGreaterThan(0)
  })

  it('득점 슛은 골대 폭 안을 향한다', () => {
    for (const f of scoringShots) {
      expect(Math.abs(f.ball.toY - GOAL_MID), '골대 중앙에서의 거리').toBeLessThan(GOAL_HALF)
    }
  })

  it('득점 슛은 골라인까지 간다', () => {
    for (const f of scoringShots) {
      const onLine = f.ball.toX <= 0.5 || f.ball.toX >= PITCH_W - 0.5
      expect(onLine, `도착 x=${f.ball.toX.toFixed(1)}`).toBe(true)
    }
  })

  it('막히는 슛은 골대 안으로 안 들어간다', () => {
    const saved = frames.filter(
      (f, i) => f.mode === 'SHOT' && !f.ball.willScore && (i === 0 || frames[i - 1].mode !== 'SHOT'),
    )
    expect(saved.length).toBeGreaterThan(0)
    // 골키퍼 정면이거나 골대 옆으로 빗나간다
    const inNet = saved.filter((f) => Math.abs(f.ball.toY - GOAL_MID) < 2.0)
    const wide = saved.filter((f) => Math.abs(f.ball.toY - GOAL_MID) > GOAL_HALF)
    expect(inNet.length + wide.length).toBe(saved.length)
  })

  it('공이 실제로 골망에 도달한다', () => {
    // 슛이 중간에 사라지지 않고 골라인까지 날아가는지
    let reached = false
    for (let i = 1; i < frames.length; i++) {
      if (frames[i - 1].mode === 'SHOT' && frames[i - 1].ball.willScore && frames[i].celebrating) {
        const bx = frames[i].ball.x
        expect(bx <= 1.5 || bx >= PITCH_W - 1.5, `공이 x=${bx.toFixed(1)} 에 멈췄다`).toBe(true)
        expect(Math.abs(frames[i].ball.y - GOAL_MID)).toBeLessThan(GOAL_HALF + 0.5)
        reached = true
      }
    }
    expect(reached, '골망에 도달한 슛이 없다').toBe(true)
  })

  it('골이 들어가면 세리머니 뒤에 중앙에서 재개한다', () => {
    let sawCelebration = false
    for (let i = 1; i < frames.length; i++) {
      if (frames[i - 1].celebrating && !frames[i].celebrating) {
        sawCelebration = true
        expect(Math.abs(frames[i].ball.x - PITCH_W / 2)).toBeLessThan(6)
      }
    }
    expect(sawCelebration).toBe(true)
  })

  it('세리머니 동안은 공이 골망에 머문다', () => {
    for (const f of frames) {
      if (!f.celebrating) continue
      expect(f.ball.x <= 2 || f.ball.x >= PITCH_W - 2).toBe(true)
    }
  })
})

describe('킥오프 — 축구 규칙대로', () => {
  const { frames } = watch()

  /** 세리머니가 끝난 직후 프레임들 */
  const restarts = frames
    .map((f, i) => ({ f, i }))
    .filter(({ i }) => i > 0 && frames[i - 1].celebrating && !frames[i].celebrating)

  it('골 뒤에 반드시 재개한다', () => {
    expect(restarts.length).toBeGreaterThan(0)
  })

  it('공이 센터서클에 놓인다', () => {
    for (const { f } of restarts) {
      expect(Math.abs(f.ball.x - PITCH_W / 2), '공의 앞뒤 위치').toBeLessThan(6)
      expect(Math.abs(f.ball.y - PITCH_H / 2), '공의 좌우 위치').toBeLessThan(6)
    }
  })

  it('먹힌 팀이 킥오프한다', () => {
    // 축구 규칙이다. 넣은 팀이 다시 차면 안 된다
    for (const { i } of restarts) {
      const scoredBy = frames[i - 1].scoredBy!
      const holder = frames[i].holder
      expect(holder, '재개 시 공을 가진 선수가 없다').toBeTruthy()
      const kickerSide = holder![0] === 'H' ? 'HOME' : 'AWAY'
      expect(kickerSide, `${scoredBy} 가 넣었는데 ${kickerSide} 가 다시 찬다`).not.toBe(scoredBy)
    }
  })

  it('차는 선수는 센터서클 안에 있다', () => {
    for (const { f } of restarts) {
      const kicker = f.players.find((p) => p.id === f.holder)!
      expect(Math.hypot(kicker.x - PITCH_W / 2, kicker.y - PITCH_H / 2)).toBeLessThan(9.2)
    }
  })

  it('킥오프 순간 양 팀이 자기 진영에 있다', () => {
    for (const { f } of restarts) {
      for (const p of f.players) {
        if (p.id === f.holder) continue
        if (p.id.startsWith('H')) {
          expect(p.x, `우리 ${p.id} 가 상대 진영에 있다`).toBeLessThan(PITCH_W / 2 + 0.5)
        } else {
          expect(p.x, `상대 ${p.id} 가 우리 진영에 있다`).toBeGreaterThan(PITCH_W / 2 - 0.5)
        }
      }
    }
  })

  it('재개 뒤 경기가 이어진다', () => {
    // 재개하고 멈춰 있으면 안 된다
    for (const { i } of restarts) {
      const after = frames.slice(i + 1, i + 30)
      if (after.length < 10) continue
      const moved = after.some((f) => Math.abs(f.ball.x - PITCH_W / 2) > 4)
      expect(moved, '재개 후 공이 움직이지 않는다').toBe(true)
    }
  })
})

describe('시뮬레이션과의 일치', () => {
  it('연출은 경기 결과를 바꾸지 않는다', () => {
    // 관전 계층은 한 방향으로만 흐른다. 시뮬을 건드리면 밸런스가 무너진다
    const plain = (() => {
      const rng = createRng(P.seed)
      let s = createState(P)
      for (let i = 0; i < TOTAL_TICKS; i++) s = tick(s, rng)
      return s.score
    })()
    expect(watch().frames[TOTAL_TICKS - 1].state.score).toEqual(plain)
  })

  it('시뮬이 골이라고 하면 화면에서도 골이 들어간다', () => {
    // 시뮬 점수가 오른 뒤 세리머니까지 이어져야 한다.
    // 숫자만 바뀌고 화면은 그대로면 골이 사건으로 보이지 않는다
    const { frames } = watch()
    let scoredAt = -1
    for (let i = 1; i < frames.length; i++) {
      const before = frames[i - 1].state.score
      const now = frames[i].state.score
      if (now[0] + now[1] !== before[0] + before[1]) {
        scoredAt = i
        break
      }
    }
    expect(scoredAt, '골이 한 번도 안 났다').toBeGreaterThan(0)

    // 득점 직후 짧은 시간 안에 골망에 도달하고 세리머니가 뜬다
    const window = frames.slice(scoredAt, scoredAt + 15)
    expect(window.some((f) => f.celebrating), '세리머니가 뜨지 않았다').toBe(true)
  })
})
