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

/**
 * 시드 민감한 통계는 한 판만 재면 경계에서 흔들린다.
 * 판정용 집계는 세 판을 합쳐서 본다.
 */
const MULTI = [P.seed, P.seed + 1, P.seed + 2].map((seed) => watch({ ...P, seed }).frames)

describe('공과 선수의 연결 — 출시 기준', () => {
  const { frames } = watch()

  it('공은 대부분 누군가에게 있거나 날아가는 중이다', () => {
    // 공만 혼자 굴러가는 화면이 이 게임의 가장 큰 결함이었다.
    // 빗나간 패스를 주우러 몸싸움하는 시간은 실제 축구에도 있으므로
    // 0이 아니라 상한으로 묶는다
    let loose = 0
    let total = 0
    for (const fs of MULTI) {
      loose += fs.filter((f) => f.mode === 'LOOSE').length
      total += fs.length
    }
    expect(loose / total).toBeLessThan(0.15)
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

    // 비율은 세 판 합산으로 본다. 한 판짜리는 시드에 따라 경계에서 흔들린다
    let within = 0
    let total = 0
    for (const fs of MULTI) {
      for (const f of fs) {
        if (f.mode !== 'HELD' || !f.holder) continue
        const side = f.holder[0]
        let near = Infinity
        for (const p of f.players) {
          if (p.id[0] === side) continue
          near = Math.min(near, Math.hypot(p.x - f.ball.x, p.y - f.ball.y))
        }
        total += 1
        if (near < 15) within += 1
      }
    }
    expect(within / total, '15m 안에 수비가 있는 비율').toBeGreaterThan(0.6)
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
    // 22명 × frames 개의 표본이다. 완전히 멈춰 선 순간(0.3m/s 미만)은
    // 주로 골키퍼와 반대편 사이드의 선수라 흔치 않고, 전력질주(5m/s
    // 초과)는 공 근처에서만 나온다. 둘 다 존재하는지만 지킨다
    expect(still).toBeGreaterThan(frames.length * 0.5)
    expect(sprint).toBeGreaterThan(frames.length * 0.5)
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

  it('공도 순간이동하지 않는다', () => {
    // 선수만 붙잡아두고 공을 놓치면 소용이 없다. 실측으로 시뮬이 "점유가
    // 넘어갔다"고 알릴 때 30미터 떨어진 선수에게 공이 순간 이동했고,
    // 슛도 공을 안 가진 팀이 반대편에서 쐈다
    let big = 0
    let worst = 0
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        // 골 뒤 킥오프는 규칙상 공이 중앙으로 돌아간다.
        // 날아온 공을 받는 순간(패스 도착·선방)은 공이 이미 그 자리에
        // 도착한 것이므로 여기서 보는 대상이 아니다 — 발밑에 있던 공이
        // 다음 프레임에도 누군가의 발밑인 경우만 본다
        if (fs[i - 1].celebrating || fs[i].celebrating) continue
        if (fs[i - 1].mode !== 'HELD' || fs[i].mode !== 'HELD') continue
        const d = Math.hypot(fs[i].ball.x - fs[i - 1].ball.x, fs[i].ball.y - fs[i - 1].ball.y)
        if (d > 3) big += 1
        worst = Math.max(worst, d)
      }
    }
    // 발밑에서 뺏는 순간에는 공을 태클한 선수 발끝에 붙인다. 그 거리는
    // 태클이 닿는 3.5m + 발끝 1.3m 를 넘을 수 없다
    expect(worst, `세 판 최대 이동 ${worst.toFixed(1)}m`).toBeLessThan(6)
    // 그런 순간조차 한 판에 두세 번을 넘으면 화면에서는 튀는 것으로 보인다
    expect(big, `세 판 동안 3m 넘게 튄 횟수 ${big}`).toBeLessThan(10)
  })

  it('점수판이 올라가면 반드시 골 장면이 나온다', () => {
    // 점수만 소리 없이 바뀌면 안 된다. 실측으로 세 판에 골 셋 중 하나가
    // 뒤이어 들어온 평범한 슛에 예약이 밀려 통째로 사라졌다
    let signals = 0
    let shown = 0
    for (const fs of MULTI) {
      // 마지막 5초에 들어간 골은 세리머니가 관측 구간을 넘어간다
      for (let i = 1; i < fs.length - 50; i++) {
        const d =
          fs[i].state.score[0] - fs[i - 1].state.score[0] +
          (fs[i].state.score[1] - fs[i - 1].state.score[1])
        if (d <= 0) continue
        signals += 1
        // 예약이 기다리는 시간(2.5초) + 슛이 날아가는 시간을 감안해 4초
        for (let j = i + 1; j < i + 40; j++) {
          if (!fs[j - 1].celebrating && fs[j].celebrating) {
            shown += 1
            break
          }
        }
      }
    }
    expect(signals, '세 판 동안의 득점 신호').toBeGreaterThan(0)
    expect(shown, `득점 신호 ${signals}회 중 골 장면 ${shown}회`).toBe(signals)
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

describe('압박 — 둘러싸이면 공을 잃는다', () => {
  const { frames } = watch()
  const isGK = (id: string) => id === 'H1' || id === 'A1'

  it('두 명 이상에게 둘러싸인 채 오래 버티지 못한다', () => {
    // 수비수 무리가 몸에 붙어 있는데 공을 영영 안 뺏기는 것은
    // 축구에서 있을 수 없는 그림이다
    let cur = 0
    let worst = 0
    for (const f of frames) {
      if (f.mode !== 'HELD' || !f.holder || f.celebrating) {
        cur = 0
        continue
      }
      const side = f.holder[0]
      const crowd = f.players.filter(
        (p) =>
          p.id[0] !== side &&
          !isGK(p.id) &&
          Math.hypot(p.x - f.ball.x, p.y - f.ball.y) < 2.6,
      ).length
      if (crowd >= 2) {
        cur += 1
        if (cur > worst) worst = cur
      } else {
        cur = 0
      }
    }
    // 한 틱은 0.1초. 둘에게 붙잡힌 채 1.5초를 넘기면 비현실이다
    expect(worst, `최장 ${worst / 10}초 동안 둘러싸인 채 버텼다`).toBeLessThan(15)
  })

  it('태클로 공이 직접 넘어가는 장면이 나온다', () => {
    // 패스 인터셉트가 아니라 발밑에서 뺏는 전환이 있어야 한다.
    // 세 판 합산이다 — 한 판에 한두 번뿐인 사건이라 한 판으로는 못 잰다
    let steals = 0
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        const a = fs[i - 1]
        const b = fs[i]
        if (
          a.mode === 'HELD' &&
          b.mode === 'HELD' &&
          a.holder &&
          b.holder &&
          a.holder[0] !== b.holder[0]
        ) {
          steals += 1
        }
      }
    }
    // 세 판 = 게임 내 45분. 실제 축구의 태클 성공은 90분 양 팀 합계
    // 스물다섯 번쯤이므로 45분이면 열 번 남짓이다. 장면이 존재하는지만
    // 지킨다 — 하한만 두고 실제 값에 맞춰 상한을 박지는 않는다
    expect(steals, '세 판 동안의 발밑 태클 수').toBeGreaterThan(2)
  })

  // "압박받으면 빨리 내준다"는 별도 테스트를 두지 않는다. 릴리스가
  // 0.06초라 0.1초 간격 기록에는 그 순간이 거의 잡히지 않고, 검증하려는
  // 내용은 위의 "1.5초 못 버틴다"가 이미 커버한다.
})

describe('슛 — 거리가 멀수록 빗나간다', () => {
  /** 세 판의 모든 슛에서 (거리, 빗나감, 득점 여부)를 뽑는다 */
  const shots: Array<{ d: number; wide: boolean; score: boolean }> = []
  for (const fs of MULTI) {
    for (let i = 1; i < fs.length; i++) {
      const f = fs[i]
      if (f.mode !== 'SHOT' || fs[i - 1].mode === 'SHOT') continue
      const d = Math.hypot(f.ball.toX - f.ball.x, f.ball.toY - f.ball.y)
      const wide = Math.abs(f.ball.toY - PITCH_H / 2) > 3.66
      shots.push({ d, wide, score: f.ball.willScore })
    }
  }

  it('표본이 충분하다', () => {
    expect(shots.length).toBeGreaterThan(12)
  })

  it('유효 슈팅만 있지는 않다', () => {
    // 모든 슛이 골키퍼 정면으로 가면 슛 성공률이 100%처럼 보인다.
    // 막히는 슛과 빗나가는 슛이 둘 다 있어야 한다
    const saved = shots.filter((s) => !s.score && !s.wide)
    const missed = shots.filter((s) => !s.score && s.wide)
    expect(saved.length, '골키퍼 선방').toBeGreaterThan(0)
    expect(missed.length, '골대 밖 빗나감').toBeGreaterThan(0)
  })

  it('먼 슛이 더 자주 빗나간다', () => {
    const ns = shots.filter((s) => !s.score)
    const far = ns.filter((s) => s.d >= 20)
    const near = ns.filter((s) => s.d < 20)
    expect(far.length).toBeGreaterThan(2)
    expect(near.length).toBeGreaterThan(2)
    const wideRate = (arr: typeof ns) => arr.filter((s) => s.wide).length / arr.length
    expect(
      wideRate(far),
      `먼 슛 ${(wideRate(far) * 100).toFixed(0)}% vs 가까운 슛 ${(wideRate(near) * 100).toFixed(0)}%`,
    ).toBeGreaterThan(wideRate(near))
  })
})

describe('패스 성공률 — 거리가 멀수록 떨어진다', () => {
  const { frames } = watch()

  /** 패스 하나하나의 (거리, 성공 여부)를 뽑는다 */
  const passes: Array<{ d: number; ok: boolean }> = []
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]
    if (f.mode !== 'PASS' || frames[i - 1].mode === 'PASS') continue
    const passer = frames[i - 1].holder
    if (!passer) continue
    const d = Math.hypot(f.ball.toX - f.ball.x, f.ball.toY - f.ball.y)
    // 이 패스가 끝난 뒤 처음으로 공을 잡는 선수를 찾는다
    let ok = false
    for (let j = i + 1; j < Math.min(i + 40, frames.length); j++) {
      if (frames[j].mode === 'HELD' && frames[j].holder) {
        ok = frames[j].holder![0] === passer[0]
        break
      }
    }
    passes.push({ d, ok })
  }

  it('표본이 충분하다', () => {
    expect(passes.length).toBeGreaterThan(25)
  })

  it('패스는 100% 성공하지 않는다', () => {
    const rate = passes.filter((p) => p.ok).length / passes.length
    expect(rate, `전체 성공률 ${(rate * 100).toFixed(0)}%`).toBeLessThan(0.95)
    // 그렇다고 절반씩 흘리면 축구가 아니다
    expect(rate).toBeGreaterThan(0.55)
  })

  it('짧은 패스가 긴 패스보다 잘 붙는다', () => {
    const shortOnes = passes.filter((p) => p.d < 14)
    const longOnes = passes.filter((p) => p.d > 22)
    expect(shortOnes.length).toBeGreaterThan(5)
    expect(longOnes.length).toBeGreaterThan(5)
    const rate = (arr: typeof passes) => arr.filter((p) => p.ok).length / arr.length
    expect(
      rate(shortOnes),
      `짧은 ${(rate(shortOnes) * 100).toFixed(0)}% vs 긴 ${(rate(longOnes) * 100).toFixed(0)}%`,
    ).toBeGreaterThan(rate(longOnes))
  })
})

describe('공격할 때는 팀 전체가 올라간다', () => {
  /**
   * 배치 통계는 세 판을 합쳐서 본다.
   *
   * 한 판만 보면 공이 어디에 오래 머물렀느냐에 따라 평균이 몇 미터씩
   * 흔들려, 경계에서 판정이 뒤집힌다.
   */
  const flat = MULTI.flat()
  const ours = flat.filter((f) => f.mode === 'HELD' && f.holder?.startsWith('H') && !f.celebrating)
  const theirs = flat.filter((f) => f.mode === 'HELD' && f.holder?.startsWith('A') && !f.celebrating)

  /**
   * 공을 기준으로 한 선수의 앞뒤 위치.
   *
   * 절대 좌표로 비교하면 안 된다. 우리가 공을 가질 때와 상대가 가질 때는
   * 공 위치 자체가 다르므로 두 상황이 섞여버린다. 축구에서 물어야 할 것은
   * "공보다 앞에 있느냐 뒤에 있느냐"다 — 공격하면 앞으로 나가 받으려 하고,
   * 수비하면 공과 우리 골대 사이에 선다.
   */
  const meanAheadOfBall = (fs: typeof frames, pick: (id: string) => boolean) => {
    let sum = 0
    let n = 0
    for (const f of fs) {
      for (const p of f.players) {
        if (!pick(p.id)) continue
        sum += p.x - f.ball.x
        n += 1
      }
    }
    return sum / Math.max(1, n)
  }

  // 4-4-2 기준 우리 팀 등번호: 골키퍼 1, 수비 2·3·4·5, 중원 6·7·8·10, 공격 9·11
  const isDF = (id: string) => ['H2', 'H3', 'H4', 'H5'].includes(id)
  const isMF = (id: string) => ['H6', 'H7', 'H8', 'H10'].includes(id)
  const isFW = (id: string) => ['H9', 'H11'].includes(id)

  it('양쪽 표본이 충분하다', () => {
    expect(ours.length).toBeGreaterThan(50)
    expect(theirs.length).toBeGreaterThan(50)
  })

  /** 그 프레임들에서 어떤 무리의 평균 x 좌표 */
  const meanX = (fs: typeof ours, pick: (id: string) => boolean) => {
    let sum = 0
    let n = 0
    for (const f of fs) {
      for (const p of f.players) {
        if (!pick(p.id)) continue
        sum += p.x
        n += 1
      }
    }
    return sum / Math.max(1, n)
  }

  it('공을 잃으면 공이 우리 진영 쪽으로 내려온다', () => {
    // 소유가 바뀌어도 공이 같은 자리에 있으면 축구가 아니라 술래잡기다.
    // 상대는 우리 골대(x=0) 를 향해 공격하므로 공이 내려와야 한다
    const oursBall = ours.reduce((a, f) => a + f.ball.x, 0) / ours.length
    const theirsBall = theirs.reduce((a, f) => a + f.ball.x, 0) / theirs.length
    expect(
      theirsBall,
      `우리 소유 공 x ${oursBall.toFixed(1)} vs 상대 소유 공 x ${theirsBall.toFixed(1)}`,
    ).toBeLessThan(oursBall - 5)
  })

  it('우리가 공을 가지면 수비라인이 올라간다', () => {
    // 공 기준 상대 위치가 아니라 절대 위치로 잰다. 공격 상황과 수비
    // 상황은 공 위치 자체가 다르므로, 상대 위치로 재면 두 효과가 섞인다
    const up = meanX(ours, isDF)
    const back = meanX(theirs, isDF)
    expect(up, `수비라인 x — 공격 ${up.toFixed(1)} vs 수비 ${back.toFixed(1)}`).toBeGreaterThan(back)
  })

  it('우리가 공을 가지면 미드필더가 올라간다', () => {
    const up = meanX(ours, isMF)
    const back = meanX(theirs, isMF)
    expect(up, `미드필더 x — 공격 ${up.toFixed(1)} vs 수비 ${back.toFixed(1)}`).toBeGreaterThan(back)
  })

  it('공격수는 공보다 앞에 있다', () => {
    // 받을 자리를 잡아야 하므로 공보다 앞으로 나간다
    expect(meanAheadOfBall(ours, isFW)).toBeGreaterThan(0)
  })

  it('수비할 때 수비수는 공과 우리 골대 사이에 선다', () => {
    // 공보다 앞에 나가 있으면 뒤가 비어 있다는 뜻이다
    expect(meanAheadOfBall(theirs, isDF)).toBeLessThan(0)
  })

  it('공격 중에 수비수가 공보다 한참 뒤처지지 않는다', () => {
    // 공은 상대 진영인데 수비라인이 자기 골대에 붙어 있으면 축구가 아니다
    let far = 0
    for (const f of ours) {
      const df = f.players.filter((p) => isDF(p.id))
      const line = df.reduce((a, p) => a + p.x, 0) / df.length
      if (f.ball.x - line > 46) far += 1
    }
    expect(far / ours.length, '수비라인이 공에서 46m 넘게 처진 비율').toBeLessThan(0.25)
  })

  it('대형 순서는 유지된다', () => {
    // 다 같이 올라가되 수비수가 공격수를 앞지르면 안 된다
    let broken = 0
    for (const f of ours) {
      const df = f.players.filter((p) => isDF(p.id)).reduce((a, p) => a + p.x, 0) / 4
      const fw = f.players.filter((p) => isFW(p.id)).reduce((a, p) => a + p.x, 0) / 2
      if (df >= fw) broken += 1
    }
    expect(broken / ours.length).toBeLessThan(0.05)
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
