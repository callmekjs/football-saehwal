import { describe, it, expect } from 'vitest'
import { VisualMatch, PITCH_W, PITCH_H, GOAL_HALF, GOAL_MID } from './visual'
import { createState, tick, checkSub } from '../sim/engine'
import { createRng } from '../sim/rng'
import { getPlayer } from '../sim/squad'
import { EVENTS, TOTAL_TICKS } from '../sim/constants'
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
    ball: {
      x: number
      y: number
      /** 지면에서의 높이(미터) */
      z: number
      /** 속력(초당 미터) */
      v: number
      willScore: boolean
      toX: number
      toY: number
      kick: string
    }
    celebrating: boolean
    restart: { kind: string; side: string; x: number; y: number } | null
    scoredBy: 'HOME' | 'AWAY' | null
    flashes: string[]
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
        z: vm.ball.z,
        v: Math.hypot(vm.ball.vx, vm.ball.vy),
        willScore: vm.ball.willScore,
        toX: vm.ball.toX,
        toY: vm.ball.toY,
        kick: vm.ball.kick,
      },
      celebrating: vm.celebration !== null,
      restart: vm.restart
        ? { kind: vm.restart.kind, side: vm.restart.side, x: vm.restart.x, y: vm.restart.y }
        : null,
      scoredBy: vm.celebration?.side ?? null,
      flashes: vm.flashes.map((x) => x.kind),
      players: vm.players.map((p) => ({ id: p.id, x: p.x, y: p.y, v: Math.hypot(p.vx, p.vy) })),
    })
  }
  return { frames, vm }
}

/**
 * 시드 민감한 통계는 한 판만 재면 경계에서 흔들린다.
 *
 * 판 수는 재려는 사건의 빈도로 정한다. 슛은 한 판에 네다섯 번뿐이라
 * 세 판으로 거리별로 나누면 한 칸에 두세 개가 남아 통계가 되지 않는다.
 * 여섯 판이면 슛만 서른 번 가까이 모인다.
 */
const SEEDS = [0, 1, 2, 3, 4, 5].map((i) => P.seed + i)
const MULTI = SEEDS.map((seed) => watch({ ...P, seed }).frames)

describe('공과 선수의 연결 — 출시 기준', () => {
  const { frames } = watch()

  it('공은 대부분 누군가에게 있거나 날아가는 중이다', () => {
    // 공만 혼자 굴러가는 화면이 이 게임의 가장 큰 결함이었다.
    // 빗나간 패스를 주우러 몸싸움하는 시간은 실제 축구에도 있으므로
    // 0이 아니라 상한으로 묶는다
    // 밖으로 나가 재개를 기다리는 공은 "주인 없는 공"이 아니라 죽은
    // 공이다. 규칙대로 멈춰 있는 시간까지 결함으로 세면 안 된다
    let loose = 0
    let total = 0
    for (const fs of MULTI) {
      loose += fs.filter((f) => f.mode === 'LOOSE' && !f.restart).length
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
    // 태클이 닿는 거리 + 발끝 거리를 넘을 수 없다
    expect(worst, `여섯 판 최대 이동 ${worst.toFixed(1)}m`).toBeLessThan(7)
    // 그런 순간조차 한 판에 두세 번을 넘으면 화면에서는 튀는 것으로 보인다
    expect(big, `여섯 판 동안 3m 넘게 튄 횟수 ${big}`).toBeLessThan(20)
  })

  it('점수판이 올라가면 반드시 골 장면이 나온다', () => {
    // 점수만 소리 없이 바뀌면 안 된다. 실측으로 세 판에 골 셋 중 하나가
    // 뒤이어 들어온 평범한 슛에 예약이 밀려 통째로 사라졌다
    let signals = 0
    let shown = 0
    for (const fs of MULTI) {
      // 마지막 5초에 들어간 골은 세리머니가 관측 구간을 넘어간다
      for (let i = 1; i < fs.length - 70; i++) {
        const d =
          fs[i].state.score[0] - fs[i - 1].state.score[0] +
          (fs[i].state.score[1] - fs[i - 1].state.score[1])
        if (d <= 0) continue
        signals += 1
        // 예약이 기다리는 시간(2.5초) + 슛이 날아가는 시간, 그리고 그
        // 사이에 데드볼이 낄 수 있는 것까지 감안해 6초
        for (let j = i + 1; j < i + 60; j++) {
          if (!fs[j - 1].celebrating && fs[j].celebrating) {
            shown += 1
            break
          }
        }
      }
    }
    expect(signals, '여섯 판 동안의 득점 신호').toBeGreaterThan(0)
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

  /**
   * 시뮬이 득점으로 판정한 슛만 모은다.
   *
   * 여섯 판을 합친다. 한 판에 골은 한두 번뿐이고, 그중 일부는 슛 없이
   * 골망 장면으로 바로 넘어간다 — 시뮬이 골이라고 알린 순간 그 팀 선수가
   * 아무도 골대 근처에 없으면 억지 슛(실측 최대 81m)을 만드는 대신
   * 중계처럼 골망으로 컷하기 때문이다. 한 판만 보면 그 판이 통째로
   * 표본에서 빠져 "득점이 없다"가 된다.
   */
  const scoringShots = MULTI.flatMap((fs) =>
    fs.filter(
      (f, i) => f.mode === 'SHOT' && f.ball.willScore && (i === 0 || fs[i - 1].mode !== 'SHOT'),
    ),
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
    const saved = MULTI.flatMap((fs) =>
      fs.filter(
        (f, i) => f.mode === 'SHOT' && !f.ball.willScore && (i === 0 || fs[i - 1].mode !== 'SHOT'),
      ),
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
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        if (fs[i - 1].mode === 'SHOT' && fs[i - 1].ball.willScore && fs[i].celebrating) {
          const bx = fs[i].ball.x
          expect(bx <= 1.5 || bx >= PITCH_W - 1.5, `공이 x=${bx.toFixed(1)} 에 멈췄다`).toBe(true)
          expect(Math.abs(fs[i].ball.y - GOAL_MID)).toBeLessThan(GOAL_HALF + 0.5)
          reached = true
        }
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

  it('공을 뺏기는 장면이 화면에 나온다', () => {
    // 발밑에서 직접 뺏는 것만 세면 이 게임에서는 거의 잡히지 않는다.
    // 압박의 답이 빠른 릴리스라 상대가 붙는 순간 공이 이미 떠나 있기
    // 때문이다. 화면에 실제로 뜨는 탈취 표시로 센다 — 발밑 태클과
    // 터치가 길어 흘린 공, 인터셉트가 모두 여기에 들어온다.
    //
    // 여섯 판 = 게임 내 90분. 실제 축구의 태클·차단은 90분 양 팀 합계로
    // 쉰 번을 넘으므로 45분이면 스물몇 번이다. 존재만 지킨다
    let events = 0
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        const before = fs[i - 1].flashes.filter((k) => k === 'TACKLE').length
        const now = fs[i].flashes.filter((k) => k === 'TACKLE').length
        if (now > before) events += now - before
      }
    }
    expect(events, `여섯 판 동안 화면에 뜬 탈취 ${events}회`).toBeGreaterThan(16)
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
  /**
   * 패스 하나하나의 (거리, 성공 여부)를 뽑는다.
   *
   * 한 판이면 긴 패스 표본이 열 개도 안 돼 성공률이 0% 와 100% 사이를
   * 오간다. 거리별 비교는 여러 판을 합쳐야 뜻이 생긴다.
   */
  const passes: Array<{ d: number; ok: boolean }> = []
  for (const frames of MULTI) {
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]
    // 흘린 공(SPILL)은 패스가 아니다. 일부러 뺏긴 공을 섞으면 짧은
    // 거리 쪽 성공률이 통째로 내려앉는다
    if (f.mode !== 'PASS' || frames[i - 1].mode === 'PASS' || f.ball.kick !== 'PASS') continue
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
  }

  it('표본이 충분하다', () => {
    expect(passes.length).toBeGreaterThan(150)
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
   * 배치 통계도 여러 판을 합쳐서 본다.
   *
   * 한 판만 보면 공이 어디에 오래 머물렀느냐에 따라 평균이 몇 미터씩
   * 흔들려, 경계에서 판정이 뒤집힌다.
   */
  const flat = MULTI.flat()
  /**
   * 골키퍼가 공을 잡고 있는 순간은 뺀다.
   *
   * 여기서 재려는 것은 "소유가 바뀌면 경기가 앞뒤로 움직이는가"다.
   * 골키퍼가 공을 든 순간은 그 팀 소유 중 가장 깊은 자리이고, 상대
   * 골키퍼가 들면 반대로 가장 높은 자리다. 두 상황이 양쪽 평균을 서로
   * 반대 방향으로 끌어당겨 실제 차이를 지운다 — 실측으로 골키퍼 소유가
   * 전체의 10%였고, 그것만 빼면 공 위치 차이가 1.5m 에서 11.4m 로 커졌다.
   */
  const open = (f: (typeof flat)[number]) =>
    f.mode === 'HELD' && !!f.holder && !f.celebrating && f.holder !== 'H1' && f.holder !== 'A1'
  const ours = flat.filter((f) => open(f) && f.holder!.startsWith('H'))
  const theirs = flat.filter((f) => open(f) && f.holder!.startsWith('A'))

  /**
   * 공을 기준으로 한 선수의 앞뒤 위치.
   *
   * 절대 좌표로 비교하면 안 된다. 우리가 공을 가질 때와 상대가 가질 때는
   * 공 위치 자체가 다르므로 두 상황이 섞여버린다. 축구에서 물어야 할 것은
   * "공보다 앞에 있느냐 뒤에 있느냐"다 — 공격하면 앞으로 나가 받으려 하고,
   * 수비하면 공과 우리 골대 사이에 선다.
   */
  const meanAheadOfBall = (fs: typeof ours, pick: (id: string) => boolean) => {
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
    // 상대는 우리 골대(x=0) 를 향해 공격하므로 공이 내려와야 한다.
    //
    // 고치기 전에는 이 차이가 0.2m 였다 — 공은 제자리에 있고 주인만
    // 바뀌었다는 뜻이다. 방향이 있는지를 지키고, 폭은 시뮬이 정하는
    // 소유권 전환 빈도에 달려 있으므로 크게 잡지 않는다
    const oursBall = ours.reduce((a, f) => a + f.ball.x, 0) / ours.length
    const theirsBall = theirs.reduce((a, f) => a + f.ball.x, 0) / theirs.length
    expect(
      theirsBall,
      `우리 소유 공 x ${oursBall.toFixed(1)} vs 상대 소유 공 x ${theirsBall.toFixed(1)}`,
    ).toBeLessThan(oursBall - 3)
  })

  it('우리가 공을 가지면 수비라인이 올라간다', () => {
    // 공 기준 상대 위치가 아니라 절대 위치로 잰다. 공격 상황과 수비
    // 상황은 공 위치 자체가 다르므로, 상대 위치로 재면 두 효과가 섞인다
    const up = meanX(ours, isDF)
    const back = meanX(theirs, isDF)
    expect(up, `수비라인 x — 공격 ${up.toFixed(1)} vs 수비 ${back.toFixed(1)}`).toBeGreaterThan(back)
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

  it('경기가 킥오프로 시작한다', () => {
    // 심사자가 처음 보는 3초다. 미드필더 하나가 아무 자리에서 공을
    // 들고 서 있는 것으로 시작하면 그 뒤로도 축구로 안 보인다
    const f = frames[0]
    expect(Math.hypot(f.ball.x - PITCH_W / 2, f.ball.y - PITCH_H / 2), '시작 시 공 위치')
      .toBeLessThan(12)
  })

  it('킥오프 순간 양 팀이 자기 진영에 있었다', () => {
    // 첫 프레임은 이미 한 틱이 지난 뒤라 조금씩 움직였다. 규칙이 지켜진
    // 배치에서 출발했는지만 본다
    const f = frames[0]
    let wrong = 0
    for (const p of f.players) {
      if (p.id === f.holder) continue
      if (p.id.startsWith('H') && p.x > PITCH_W / 2 + 3) wrong += 1
      if (p.id.startsWith('A') && p.x < PITCH_W / 2 - 3) wrong += 1
    }
    expect(wrong, `${wrong}명이 상대 진영에서 킥오프를 맞았다`).toBe(0)
  })

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
    // 재개하고 멈춰 있으면 안 된다.
    //
    // 앞뒤(x)로만 재면 안 된다. 킥오프는 뒤로 빼거나 옆으로 여는 것이
    // 정석이라 공이 3초 동안 x 는 그대로인 채 좌우로만 오갈 수 있다.
    // 실제로 재려는 것은 "공이 굴러다니고 있는가"이므로 이동 거리를 잰다
    for (const { i } of restarts) {
      const after = frames.slice(i, i + 30)
      if (after.length < 11) continue
      let path = 0
      for (let k = 1; k < after.length; k++) {
        path += Math.hypot(after[k].ball.x - after[k - 1].ball.x, after[k].ball.y - after[k - 1].ball.y)
      }
      // 3초. 걸음 속도(초속 1.4m)로만 굴러도 4미터는 넘는다
      expect(path, `재개 후 3초 동안 공이 ${path.toFixed(1)}m 밖에 안 움직였다`).toBeGreaterThan(10)
    }
  })
})

describe('공의 물리 — 차인 공은 단번에 서지 않는다', () => {
  it('살아 있는 공은 한순간에 서지 않는다', () => {
    // 이 게임의 공은 목표 지점까지 등속으로 가다 **도착하는 순간 속도가
    // 0이 됐다.** 차인 공이 허공에서 서는 것은 축구가 아니다. 이제 공이
    // 서는 것은 누가 잡았을 때(HELD)와 규칙상 죽었을 때(재개)뿐이다.
    //
    // 잔디 마찰로 줄어드는 속도는 0.1초에 초속 20미터 기준 0.25m/s,
    // 한 번 튀어도 30%를 넘지 않는다. 절반 아래로 떨어지면 물리가 아니다
    let checked = 0
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        const a = fs[i - 1]
        const b = fs[i]
        if (a.mode === 'HELD' || b.mode === 'HELD') continue
        if (a.restart || b.restart || a.celebrating || b.celebrating) continue
        // 아무도 안 건드린 구간만 본다. 골키퍼가 쳐내면 공이 크게 느려지는
        // 것이 당연하고, 그것은 물리가 아니라 사람이 한 일이다
        if (a.mode !== b.mode) continue
        if (a.ball.toX !== b.ball.toX || a.ball.toY !== b.ball.toY) continue
        if (a.ball.v < 5) continue
        checked += 1
        expect(
          b.ball.v,
          `초속 ${a.ball.v.toFixed(1)}m 로 가던 공이 0.1초 만에 ${b.ball.v.toFixed(1)}m 가 됐다`,
        ).toBeGreaterThan(a.ball.v * 0.5)
      }
    }
    expect(checked, '표본이 없다').toBeGreaterThan(100)
  })

  it('굴러가는 공은 마찰로 느려진다', () => {
    // 마찰이 없으면 한 번 찬 공이 영원히 굴러간다.
    // 같은 킥(목표 지점이 같은) 안에서 땅에 붙어 굴러가는 구간만 본다
    let slowing = 0
    let speeding = 0
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        const a = fs[i - 1]
        const b = fs[i]
        if (a.mode !== 'PASS' || b.mode !== 'PASS') continue
        if (a.ball.toX !== b.ball.toX || a.ball.toY !== b.ball.toY) continue
        if (a.ball.z > 0.02 || b.ball.z > 0.02 || a.ball.v < 1) continue
        if (b.ball.v < a.ball.v) slowing += 1
        else speeding += 1
      }
    }
    expect(slowing, '굴러가는 공 표본').toBeGreaterThan(50)
    expect(speeding, '저절로 빨라진 공').toBe(0)
  })

  it('뜬 공이 있고, 떨어져서 튄다', () => {
    // 롱패스와 슛은 공중을 지난다. 전부 땅볼이면 축구로 안 보인다
    let maxZ = 0
    let bounces = 0
    for (const fs of MULTI) {
      let landed = false
      for (let i = 1; i < fs.length; i++) {
        maxZ = Math.max(maxZ, fs[i].ball.z)
        // 땅에 닿았다가 다시 뜨면 튄 것이다
        if (fs[i - 1].ball.z > 0.05 && fs[i].ball.z <= 0.05) landed = true
        else if (landed && fs[i].ball.z > 0.05 && fs[i].mode !== 'HELD') {
          bounces += 1
          landed = false
        }
        if (fs[i].mode === 'HELD') landed = false
      }
    }
    expect(maxZ, `가장 높이 뜬 높이 ${maxZ.toFixed(1)}m`).toBeGreaterThan(1)
    // 크로스바가 2.44m 다. 관중석으로 날아가면 안 된다
    expect(maxZ).toBeLessThan(12)
    expect(bounces, `여섯 판 동안 공이 튄 횟수 ${bounces}`).toBeGreaterThan(0)
  })
})

describe('슛 — 골대에 가까우면 패스보다 슛이다', () => {
  const GOAL_OF = (id: string) => (id.startsWith('H') ? PITCH_W : 0)

  /** 킥이 시작된 순간의 (찬 선수, 골대까지 거리, 종류) */
  const kicks: Array<{ side: string; goalDist: number; kind: 'PASS' | 'SHOT' }> = []
  for (const fs of MULTI) {
    for (let i = 1; i < fs.length; i++) {
      const prev = fs[i - 1]
      const now = fs[i]
      if (prev.mode !== 'HELD' || !prev.holder) continue
      const isShot = now.mode === 'SHOT'
      const isPass = now.mode === 'PASS' && now.ball.kick === 'PASS'
      if (!isShot && !isPass) continue
      const p = prev.players.find((x) => x.id === prev.holder)!
      // 골키퍼의 골킥·펀트는 공격 판단이 아니다
      if (prev.holder === 'H1' || prev.holder === 'A1') continue
      const gx = GOAL_OF(prev.holder)
      kicks.push({
        side: prev.holder[0],
        goalDist: Math.hypot(gx - p.x, PITCH_H / 2 - p.y),
        kind: isShot ? 'SHOT' : 'PASS',
      })
    }
  }

  it('표본이 충분하다', () => {
    expect(kicks.length).toBeGreaterThan(150)
  })

  it('박스 안에서는 슛이 패스보다 많다', () => {
    // 실제 축구다. 골라인 16.5미터 안에서 각이 열려 있으면 대부분 슛이다.
    // 고치기 전에는 박스 안에서 패스 26회 대 슛 7회였다
    const box = kicks.filter((k) => k.goalDist <= 16.5)
    expect(box.length, '박스 안 표본').toBeGreaterThan(5)
    const shots = box.filter((k) => k.kind === 'SHOT').length
    expect(shots, `박스 안 슛 ${shots} vs 패스 ${box.length - shots}`).toBeGreaterThan(
      box.length - shots,
    )
  })

  it('먼 데서는 패스가 슛보다 많다', () => {
    // 25미터 밖에서 매번 때리면 그것도 축구가 아니다
    const far = kicks.filter((k) => k.goalDist > 25)
    expect(far.length).toBeGreaterThan(20)
    const shots = far.filter((k) => k.kind === 'SHOT').length
    expect(shots).toBeLessThan(far.length - shots)
  })

  it('가까울수록 슛 비율이 높다', () => {
    const rate = (lo: number, hi: number) => {
      const g = kicks.filter((k) => k.goalDist > lo && k.goalDist <= hi)
      return g.length ? g.filter((k) => k.kind === 'SHOT').length / g.length : 0
    }
    expect(rate(0, 16.5)).toBeGreaterThan(rate(16.5, 25))
    expect(rate(16.5, 25)).toBeGreaterThan(rate(25, 40))
  })

  it('우리 팀과 상대가 같은 기준으로 쏜다', () => {
    // 사용자 요구다 — "컴퓨터든 우리팀이든". 한쪽만 슛을 쏘면 안 된다
    for (const side of ['H', 'A']) {
      const box = kicks.filter((k) => k.side === side && k.goalDist <= 20)
      const shots = box.filter((k) => k.kind === 'SHOT').length
      expect(shots, `${side} 팀의 골대 20m 안 슛 ${shots}회`).toBeGreaterThan(0)
    }
  })

  it('자기 진영에서 상대 골대로 때리지 않는다', () => {
    // 고치기 전에는 슛 거리 중앙값이 47미터, 최대가 89미터였다.
    // 그건 슛이 아니라 걷어내기다
    const shots = kicks.filter((k) => k.kind === 'SHOT').map((k) => k.goalDist)
    shots.sort((a, b) => a - b)
    expect(shots.length).toBeGreaterThan(8)
    const median = shots[Math.floor(shots.length / 2)]
    expect(median, `슛 거리 중앙값 ${median.toFixed(1)}m`).toBeLessThan(25)
    expect(shots[shots.length - 1], `가장 먼 슛 ${shots[shots.length - 1].toFixed(1)}m`)
      .toBeLessThan(40)
  })
})

describe('골키퍼 — 공이 가까우면 골문으로 물러난다', () => {
  /** 각 프레임에서 두 골키퍼의 (골라인까지 거리, 공까지 거리) */
  const gk: Array<{ out: number; ballDist: number }> = []
  for (const fs of MULTI) {
    for (const f of fs) {
      if (f.celebrating) continue
      for (const id of ['H1', 'A1']) {
        const p = f.players.find((x) => x.id === id)!
        const own = id === 'H1' ? 0 : PITCH_W
        gk.push({
          out: Math.abs(p.x - own),
          ballDist: Math.hypot(f.ball.x - own, f.ball.y - PITCH_H / 2),
        })
      }
    }
  }

  it('공이 가까울수록 골라인에 붙는다', () => {
    /**
     * 실제 골키퍼는 공이 멀면 페널티 지역 앞까지 나와 있고(스위퍼 키퍼),
     * 가까워지면 물러나 골문을 덮는다.
     *
     * 고치기 전에는 이 관계가 **뒤집혀 있었다.** 공이 가까울수록 앞으로
     * 나오게 돼 있어서 상대가 박스 안까지 들어온 순간 골키퍼가 골라인
     * 11미터 앞에 나가 골문을 비웠다
     */
    const near = gk.filter((g) => g.ballDist < 20)
    const far = gk.filter((g) => g.ballDist > 60)
    expect(near.length).toBeGreaterThan(50)
    expect(far.length).toBeGreaterThan(50)
    const mean = (a: typeof gk) => a.reduce((s, g) => s + g.out, 0) / a.length
    expect(
      mean(near),
      `공이 20m 안일 때 ${mean(near).toFixed(1)}m vs 60m 밖일 때 ${mean(far).toFixed(1)}m`,
    ).toBeLessThan(mean(far))
  })

  it('상대가 박스로 들어오면 골문 앞을 지킨다', () => {
    // 공이 페널티 지역(16.5m) 안에 있는데 골키퍼가 그보다 앞에 나가
    // 있으면 골문이 비어 있다는 뜻이다
    const inBox = gk.filter((g) => g.ballDist <= 16.5)
    expect(inBox.length).toBeGreaterThan(20)
    const worst = Math.max(...inBox.map((g) => g.out))
    expect(worst, `상대가 박스에 있을 때 골키퍼가 최대 ${worst.toFixed(1)}m 나갔다`)
      .toBeLessThan(8)
  })

  it('페널티 지역을 넘어 나가지 않는다', () => {
    const worst = Math.max(...gk.map((g) => g.out))
    expect(worst, `골라인에서 최대 ${worst.toFixed(1)}m`).toBeLessThan(16.5)
  })
})

describe('부상·퇴장 — 사람이 소리 없이 사라지지 않는다', () => {
  /**
   * 부상은 희소한 사건이다.
   *
   * 체력 25 미만인 선수가 있을 때만, 그것도 틱당 0.0004 확률로 난다.
   * 한 판 봐서는 안 나오므로 체력이 가장 낮은 국면에 강 압박을 걸고
   * 여러 시드를 합친다. 강 압박은 경고 보유 선수의 퇴장 위험도 켠다.
   */
  const EXHAUSTED: Problem = {
    ...P,
    staminaOverrides: { DF04: 30, DF05: 34, MF06: 28, MF08: 31, FW09: 29 },
    booked: ['MF06'],
    initialTactics: { line: 1, press: 2, width: 1 },
  }

  const runs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
    const seed = EXHAUSTED.seed + i * 17
    const rng = createRng(seed)
    let s = createState({ ...EXHAUSTED, seed })
    const vm = new VisualMatch(s, seed)
    const events: Array<{ tick: number; kind: string }> = []
    const ghosts: Array<{ tick: number; kind: string; x: number; y: number }> = []
    let logLen = 0
    for (let i2 = 0; i2 < TOTAL_TICKS; i2++) {
      s = tick(s, rng)
      vm.sync(s)
      for (let f = 0; f < 6; f++) vm.advance(s, 1 / 60)
      for (let k = logLen; k < s.log.length; k++) {
        const e = s.log[k]
        if (e.kind === 'INJURY' || e.kind === 'SEND_OFF') events.push({ tick: i2, kind: e.kind })
      }
      logLen = s.log.length
      for (const d of vm.downed) ghosts.push({ tick: i2, kind: d.kind, x: d.x, y: d.y })
    }
    return { events, ghosts, players: vm.players }
  })

  const events = runs.flatMap((r) => r.events)
  const ghosts = runs.flatMap((r) => r.ghosts)

  it('부상과 퇴장이 실제로 일어난다', () => {
    // 안 나오는 것을 "고쳤다"고 할 수 없다
    expect(events.filter((e) => e.kind === 'INJURY').length, '부상').toBeGreaterThan(0)
    expect(events.filter((e) => e.kind === 'SEND_OFF').length, '퇴장').toBeGreaterThan(0)
  })

  it('빠진 선수가 화면에 잠시 쓰러져 있다', () => {
    // 시뮬은 그 틱에 즉시 선수를 지운다. 그대로 두면 사람이 소리 없이
    // 사라져 우리가 열 명이 된 것조차 화면에 안 나온다
    expect(ghosts.length, '쓰러진 선수가 그려진 프레임').toBeGreaterThan(events.length * 15)
    // 부상 3.4초 · 퇴장 2.6초. 한 사건이 5초를 넘게 누워 있으면 안 된다
    for (const r of runs) {
      const per = new Map<string, number>()
      for (const g of r.ghosts) {
        const key = `${g.kind}:${g.x.toFixed(1)}:${g.y.toFixed(1)}`
        per.set(key, (per.get(key) ?? 0) + 1)
      }
      for (const [, n] of per) expect(n).toBeLessThan(50)
    }
  })

  it('쓰러진 자리는 경기장 안이다', () => {
    // 위치를 못 잡으면 (0,0) 구석에 눕는다
    for (const g of ghosts) {
      expect(g.x).toBeGreaterThan(0)
      expect(g.x).toBeLessThan(PITCH_W)
      expect(g.y).toBeGreaterThan(0)
      expect(g.y).toBeLessThan(PITCH_H)
    }
  })

  it('등번호 0번인 유령이 뛰지 않는다', () => {
    // 열 명용 배치는 자리가 열 개다. 아홉 명이 되면 남는 자리에 번호가
    // 없는 선수가 그려졌다 — 화면에서 실제로 0번이 뛰고 있었다
    for (const r of runs) {
      for (const p of r.players) expect(p.num, `${p.id} 의 등번호`).toBeGreaterThan(0)
    }
  })
})

describe('교체 — 진짜로 선수가 바뀐다', () => {
  /** 정해진 틱에 교체를 걸고 관전한다. 실제 화면에서 하는 것과 같은 경로다 */
  const PLAN = [
    { at: 120, out: 'DF04', in: 'DF15' },
    { at: 300, out: 'MF06', in: 'MF17' },
    { at: 480, out: 'FW09', in: 'FW22' },
  ]

  const runs = [0, 1, 2].map((off) => {
    const seed = P.seed + off
    const rng = createRng(seed)
    let s = createState({ ...P, seed })
    const vm = new VisualMatch(s, seed)
    const frames: Array<{
      simNums: number[]
      vmNums: number[]
      paused: boolean
      leaving: Array<{ num: number; y: number }>
      home: Array<{ num: number; homeX: number; homeY: number }>
    }> = []
    const done = new Set<number>()

    for (let i = 0; i < TOTAL_TICKS; i++) {
      for (const p of PLAN) {
        if (i === p.at && !done.has(p.at) && !checkSub(s, p.out, p.in)) {
          done.add(p.at)
          s = {
            ...s,
            subsLeft: s.subsLeft - 1,
            pendingSubs: [...s.pendingSubs, { out: p.out, in: p.in, atTick: i + EVENTS.subDelayTicks }],
          }
        }
      }
      s = tick(s, rng)
      vm.sync(s)
      for (let f = 0; f < 6; f++) vm.advance(s, 1 / 60)
      frames.push({
        simNums: s.players
          .filter((x) => x.onPitch && !x.out)
          .map((x) => getPlayer(x.id).num)
          .sort((a, b) => a - b),
        vmNums: vm.players
          .filter((p) => p.side === 'HOME')
          .map((p) => p.num)
          .sort((a, b) => a - b),
        paused: vm.subPause > 0 && vm.ball.mode !== 'PASS' && vm.ball.mode !== 'SHOT',
        leaving: vm.leaving.map((l) => ({ num: l.num, y: l.y })),
        home: vm.players
          .filter((p) => p.side === 'HOME')
          .map((p) => ({ num: p.num, homeX: p.homeX, homeY: p.homeY })),
      })
    }
    return { frames, subs: s.log.filter((e) => e.kind === 'SUB').length }
  })

  it('교체가 실제로 일어난다', () => {
    // 안 일어나는 것을 고쳤다고 할 수 없다
    for (const r of runs) expect(r.subs, '시뮬이 반영한 교체').toBe(PLAN.length)
  })

  it('화면 명단이 시뮬 명단과 항상 같다', () => {
    /**
     * 이것이 "교체가 안 된다"의 정체였다.
     *
     * 재구성 조건이 "포메이션이 바뀌었나 / 인원이 줄었나"뿐이라, 열한 명이
     * 열한 명으로 유지되는 교체는 둘 다 해당하지 않아 화면이 갱신되지
     * 않았다. 실측으로 경기의 76%(4500프레임 중 3420) 동안 나간 선수가
     * 계속 뛰고 들어온 선수는 화면에 없었다.
     */
    let wrong = 0
    for (const r of runs) {
      for (const f of r.frames) {
        if (f.simNums.join(',') !== f.vmNums.join(',')) wrong += 1
      }
    }
    expect(wrong, `명단이 어긋난 프레임 ${wrong}`).toBe(0)
  })

  it('교체돼도 남은 선수는 자기 자리를 지킨다', () => {
    /**
     * 자리를 배열 순서로 나눠주면 한 명이 바뀔 때 뒤쪽 전원이 한 칸씩
     * 밀린다. 한 명 교체했는데 열 명이 순간이동하면 그게 더 나쁘다.
     */
    for (const r of runs) {
      for (let i = 1; i < r.frames.length; i++) {
        const a = r.frames[i - 1]
        const b = r.frames[i]
        if (a.vmNums.join(',') === b.vmNums.join(',')) continue
        /**
         * 일대일 교체만 본다.
         *
         * 부상·퇴장으로 인원이 줄면 열 명용 배치로 통째로 바뀌므로 전원의
         * 자리가 움직이는 것이 정상이다. 여기서 재려는 것은 "한 명 바꿨는데
         * 열 명이 순간이동하는가"다.
         */
        if (a.vmNums.length !== b.vmNums.length) continue
        const stayed = b.home.filter((p) => a.home.some((q) => q.num === p.num))
        for (const p of stayed) {
          const before = a.home.find((q) => q.num === p.num)!
          expect(
            Math.hypot(p.homeX - before.homeX, p.homeY - before.homeY),
            `${p.num}번의 자리가 교체 때문에 움직였다`,
          ).toBeLessThan(0.01)
        }
      }
    }
  })

  it('교체되는 순간 플레이가 잠깐 멈춘다', () => {
    // 순간 치환이면 무슨 일이 일어났는지 알 수 없다
    for (const r of runs) {
      const paused = r.frames.filter((f) => f.paused).length
      expect(paused, '멈춘 프레임').toBeGreaterThan(PLAN.length * 8)
      /**
       * 그렇다고 오래 멈추면 안 된다.
       *
       * 이 화면은 게임 내 15분을 75초로 압축한다. 공이 발에 있는 시간이
       * 이 화면의 생명이라, 교체 세 장으로 경기의 7%를 넘게 죽이면
       * 관전이 밋밋해진다. 실측 4.6%.
       */
      expect(paused / r.frames.length, '교체로 멈춘 비율').toBeLessThan(0.07)
    }
  })

  it('나가는 선수가 터치라인 쪽으로 걸어 나간다', () => {
    // 그 자리에서 증발하면 교체로 안 보인다
    let sawWalk = 0
    for (const r of runs) {
      const track = new Map<number, number[]>()
      for (const f of r.frames) {
        for (const l of f.leaving) {
          if (!track.has(l.num)) track.set(l.num, [])
          track.get(l.num)!.push(l.y)
        }
      }
      for (const [, ys] of track) {
        if (ys.length < 5) continue
        const first = ys[0]
        const last = ys[ys.length - 1]
        // 가까운 쪽 터치라인(0 또는 68)으로 다가갔는가
        const line = first < PITCH_H / 2 ? 0 : PITCH_H
        expect(Math.abs(last - line)).toBeLessThan(Math.abs(first - line))
        sawWalk += 1
      }
    }
    expect(sawWalk, '걸어 나간 선수').toBeGreaterThan(0)
  })

  it('들어온 선수가 경기장 안으로 들어온다', () => {
    // 터치라인 밖에 서 있기만 하면 한 명 적게 뛰는 것과 같다.
    // 인원은 시뮬이 정한다 — 부상·퇴장이 나면 열한 명이 아닐 수 있다
    for (const r of runs) {
      const last = r.frames[r.frames.length - 1]
      expect(last.home.length).toBe(last.simNums.length)
      for (const p of last.home) {
        expect(p.homeY).toBeGreaterThan(0)
        expect(p.homeY).toBeLessThan(PITCH_H)
      }
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

    // 득점 직후 골망에 도달하고 세리머니가 뜬다. 공이 그 팀에게 없으면
    // 잡을 때까지 최대 2.5초 기다렸다 쏘므로 창은 그만큼 넉넉해야 한다
    const window = frames.slice(scoredAt, scoredAt + 40)
    expect(window.some((f) => f.celebrating), '세리머니가 뜨지 않았다').toBe(true)
  })
})

describe('골키퍼는 골문 앞을 지킨다', () => {
  it('골대 폭을 크게 벗어나지 않는다', () => {
    // 공을 따라 옆으로 걸어 나가면 골문이 통째로 빈다. 앞으로 나올수록
    // 각을 줄이려 옆으로 더 움직일 수 있지만 한계가 있다
    let out = 0
    let total = 0
    let worst = 0
    for (const fs of MULTI) {
      for (const f of fs) {
        for (const p of f.players) {
          if (p.id !== 'H1' && p.id !== 'A1') continue
          total += 1
          const off = Math.abs(p.y - PITCH_H / 2)
          worst = Math.max(worst, off)
          // 골대 반폭 + 앞으로 나온 만큼의 여유. 골 에어리어 폭이 한계다
          if (off > 10) out += 1
        }
      }
    }
    expect(out / total, `골문 폭 밖 비율 ${((out / total) * 100).toFixed(1)}%, 최대 ${worst.toFixed(1)}m`)
      .toBeLessThan(0.02)
  })

  it('자기 골대 앞을 떠나지 않는다', () => {
    for (const fs of MULTI) {
      for (const f of fs) {
        const h = f.players.find((p) => p.id === 'H1')!
        const a = f.players.find((p) => p.id === 'A1')!
        // 우리 골대는 x=0, 상대 골대는 x=105
        expect(h.x, '우리 골키퍼가 골대에서 멀리 나갔다').toBeLessThan(20)
        expect(a.x, '상대 골키퍼가 골대에서 멀리 나갔다').toBeGreaterThan(PITCH_W - 20)
      }
    }
  })
})

describe('공이 밖으로 나가면 규칙대로 다시 넣는다', () => {
  /** 재개가 새로 걸린 순간들. 한 판에 몇 번뿐이라 세 판을 합친다 */
  const opens: Array<{ kind: string; side: string; x: number; y: number; lastKick: string }> = []
  for (const fs of MULTI) {
    for (let i = 1; i < fs.length; i++) {
      if (fs[i].restart && !fs[i - 1].restart) {
        opens.push({ ...fs[i].restart!, lastKick: fs[i - 1].holder?.[0] ?? '?' })
      }
    }
  }

  it('빗나간 슛은 골킥으로 이어진다', () => {
    // 실제 축구는 90분에 골킥이 열댓 번 나온다. 게임 내 15분이면 두세 번,
    // 세 판이면 몇 번은 나와야 한다. 하나도 없으면 공이 골라인 밖으로
    // 나가는 일 자체가 없다는 뜻이다
    const kicks = opens.filter((o) => o.kind === 'GOAL_KICK')
    expect(kicks.length, `여섯 판 동안의 골킥 ${kicks.length}회`).toBeGreaterThan(4)
  })

  it('골킥은 자기 골 에어리어 안에서 찬다', () => {
    for (const o of opens) {
      if (o.kind !== 'GOAL_KICK') continue
      // 차는 팀의 골대 쪽이어야 한다. 상대 골대 앞에서 골킥을 차면 규칙 위반이다
      const ownGoal = o.side === 'HOME' ? 0 : PITCH_W
      expect(Math.abs(o.x - ownGoal), `골킥 지점 x=${o.x.toFixed(1)}`).toBeLessThan(12)
      expect(Math.abs(o.y - PITCH_H / 2), `골킥 지점 y=${o.y.toFixed(1)}`).toBeLessThan(12)
    }
  })

  it('스로인과 코너킥은 라인 위에서 넣는다', () => {
    for (const o of opens) {
      if (o.kind === 'THROW_IN') {
        expect(o.y === 0 || o.y === PITCH_H, `스로인 y=${o.y}`).toBe(true)
      }
      if (o.kind === 'CORNER') {
        expect(o.x === 0 || o.x === PITCH_W, `코너 x=${o.x}`).toBe(true)
        expect(o.y === 0 || o.y === PITCH_H, `코너 y=${o.y}`).toBe(true)
      }
    }
  })

  it('재개를 기다리는 동안 공이 그 자리에 멈춰 있다', () => {
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        if (!fs[i].restart || !fs[i - 1].restart) continue
        expect(Math.hypot(fs[i].ball.x - fs[i - 1].ball.x, fs[i].ball.y - fs[i - 1].ball.y))
          .toBeLessThan(0.01)
      }
    }
  })

  it('경기가 재개 때문에 멈춰 있지 않는다', () => {
    // 데드볼이 길면 75초짜리 관전에서 볼 것이 사라진다. 실제 중계도
    // 공이 살아 있는 시간이 절반을 넘는다
    let dead = 0
    let total = 0
    for (const fs of MULTI) {
      dead += fs.filter((f) => f.restart).length
      total += fs.length
    }
    expect(dead / total, `정지 비율 ${((dead / total) * 100).toFixed(1)}%`).toBeLessThan(0.15)
  })

  it('재개는 반드시 끝난다', () => {
    // 공을 가지러 간 선수가 도착하지 못하면 경기가 영영 멈춘다
    let run = 0
    let worst = 0
    for (const fs of MULTI) {
      for (const f of fs) {
        run = f.restart ? run + 1 : 0
        worst = Math.max(worst, run)
      }
    }
    // 한 프레임이 한 틱(0.1초)이다. 보호 시간 4초를 넘기면 안 된다
    expect(worst, `가장 긴 정지 ${(worst * 0.1).toFixed(1)}초`).toBeLessThan(50)
  })
})
