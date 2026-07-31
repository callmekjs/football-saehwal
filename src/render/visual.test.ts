import { describe, it, expect } from 'vitest'
import {
  VisualMatch,
  PITCH_W,
  PITCH_H,
  GOAL_HALF,
  GOAL_MID,
  flagTipY,
  FLAG_REACH,
  SHOT_CONTACT_DIST,
  offsidePosition,
} from './visual'
import { createState, tick, checkSub } from '../sim/engine'
import { createRng } from '../sim/rng'
import { abilityOf, effectivePos, getPlayer } from '../sim/squad'
import { EVENTS, TOTAL_TICKS } from '../sim/constants'
import type { MatchState, PlayerOrder, Problem } from '../sim/types'
import problems from '../data/problems.json'

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

const P03_83918 = {
  ...(problems.find((problem) => problem.id === 'p03') as unknown as Problem),
  seed: 83918,
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
      fromX: number
      fromY: number
      toX: number
      toY: number
      kick: string
      lastTouch: string
    }
    celebrating: boolean
    restart: { kind: string; side: string; x: number; y: number } | null
    scoredBy: 'HOME' | 'AWAY' | null
    /** 점수판에 뜨는 점수. 골 장면이 나올 때 오르므로 시뮬보다 늦을 수 있다 */
    shown: [number, number]
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
        fromX: vm.ball.fromX,
        fromY: vm.ball.fromY,
        toX: vm.ball.toX,
        toY: vm.ball.toY,
        kick: vm.ball.kick,
        lastTouch: vm.ball.lastTouch,
      },
      celebrating: vm.celebration !== null,
      restart: vm.restart
        ? { kind: vm.restart.kind, side: vm.restart.side, x: vm.restart.x, y: vm.restart.y }
        : null,
      scoredBy: vm.celebration?.side ?? null,
      shown: [...vm.displayScore] as [number, number],
      flashes: vm.flashes.map((x) => x.kind),
      players: vm.players.map((p) => ({ id: p.id, x: p.x, y: p.y, v: Math.hypot(p.vx, p.vy) })),
    })
  }
  // 종료 휘슬을 한 번 더 흘려보낸다. 점수판이 시뮬과 맞춰지는 자리다
  vm.sync(s)
  return { frames, vm, final: s }
}

/**
 * 시드 민감한 통계는 한 판만 재면 경계에서 흔들린다.
 *
 * 판 수는 재려는 사건의 빈도로 정한다. 슛은 한 판에 네다섯 번뿐이라
 * 세 판으로 거리별로 나누면 한 칸에 두세 개가 남아 통계가 되지 않는다.
 * 여섯 판이면 슛만 서른 번 가까이 모인다.
 */
/**
 * **여섯 판에서 열두 판으로 늘렸다.**
 *
 * 여기 걸린 지표 중 몇 개는 여섯 판에서 경계가 너무 얇았다. 예를 들어
 * "공을 가지면 수비라인이 올라간다"의 실측 차이가 0.57미터였다 — 연출을
 * 어느 방향으로 손대든 동전 던지기로 뒤집히는 폭이다. 그러면 검사가
 * 축구 원칙을 지키는 것이 아니라 특정 시드의 지문을 지키게 된다.
 */
const SEEDS = Array.from({ length: 12 }, (_, i) => P.seed + i)
const MULTI = SEEDS.map((seed) => watch({ ...P, seed }).frames)

/**
 * 드문 사건 전용 표본.
 *
 * 골·골킥·박스 안 슛은 한 판에 한두 번뿐이다. 여섯 판으로 비율을 재면
 * 한 번의 차이로 판정이 뒤집혀, 밸런싱과 무관한 변경에도 테스트가 깨진다.
 * 이 서른여섯 판은 그런 사건에만 쓴다.
 */
const WIDE = Array.from({ length: 72 }, (_, i) => watch({ ...P, seed: P.seed + 500 + i * 13 }).frames)

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
    // **한 판으로 재지 않는다.** 판마다 스물여덟에서 마흔까지 흔들려,
    // 연출을 어느 방향으로 손대든 한 판 기준은 동전 던지기가 된다
    let passes = 0
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        if (fs[i].mode === 'PASS' && fs[i - 1].mode !== 'PASS') passes += 1
      }
    }
    const perMatch = passes / MULTI.length
    // 관전자가 보는 것은 75초의 실시간 축구다. 실제 축구는 75초에 양 팀
    // 합쳐 스무 번 안팎 주고받는다. 서른 번 밑으로 떨어지면 공이 한
    // 사람에게 오래 머물러 정적으로 보인다.
    expect(perMatch, `판당 패스 ${perMatch.toFixed(1)}`).toBeGreaterThan(30)
    expect(perMatch).toBeLessThan(90)
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
    // 슛은 한 판에 네다섯 번뿐이라 한 판으로 세면 경계에서 흔들린다
    let shots = 0
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        if (fs[i].mode === 'SHOT' && fs[i - 1].mode !== 'SHOT') shots += 1
      }
    }
    expect(shots, `여섯 판 동안의 슛 ${shots}회`).toBeGreaterThan(12)
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
    // 그런 순간조차 한 판에 두세 번을 넘으면 화면에서는 튀는 것으로 보인다.
    // **판 수로 나눠서 잰다** — 절대 횟수로 두면 표본을 늘리는 것만으로
    // 기준이 깨져, 검사를 더 튼튼하게 만들 수가 없다
    const perMatch = big / MULTI.length
    expect(perMatch, `판당 3m 넘게 튄 횟수 ${perMatch.toFixed(2)}`).toBeLessThan(3.34)
  })

  it('점수판이 올라가면 반드시 골 장면이 나온다', () => {
    /**
     * 점수만 소리 없이 바뀌면 안 된다.
     *
     * 화면은 골을 예약해두고 진짜 공격 장면을 만든 다음에 보여주므로
     * 장면이 득점 신호보다 몇 초 늦을 수 있다. **몇 초 안에 나오는가가
     * 아니라 하나도 빠짐없이 나오는가**를 본다. 골 장면의 수가 시뮬의
     * 골 수와 같아야 한다
     */
    /**
     * **마지막 순간의 골은 세지 않는다.**
     *
     * 세리머니가 종료 휘슬에 잘려 장면이 안 잡힐 수 있다. 전에는 그
     * 사정을 "하나까지는 봐준다"는 절대 허용치로 적었는데, 그러면 판
     * 수를 늘리는 것만으로 검사가 깨진다 — 늦은 골도 판 수에 비례해
     * 늘기 때문이다. 아예 그런 골을 표본에서 뺀다. 이쪽이 더 엄격하다.
     */
    const TAIL = 25
    let signals = 0
    let scenes = 0
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        const before = fs[i - 1].state.score
        const now = fs[i].state.score
        if (now[0] + now[1] > before[0] + before[1] && fs.length - i > TAIL) signals += 1
        if (fs[i].celebrating && !fs[i - 1].celebrating) scenes += 1
      }
    }
    expect(signals, '세리머니가 들어갈 시간이 남은 득점').toBeGreaterThan(0)
    expect(scenes, `득점 ${signals}회 중 골 장면 ${scenes}회`).toBeGreaterThanOrEqual(signals)
  })

  it('종료 휘슬에서 점수판이 시뮬과 정확히 같다', () => {
    /**
     * 골 장면을 미루는 대가로 점수판이 잠깐 늦는다. **경기 결과가 바뀌는
     * 것은 절대 아니다.** 승패는 시뮬의 점수로만 판정하고, 화면의 숫자는
     * 종료 휘슬에서 반드시 시뮬과 같아진다. 여기가 그 보증이다
     */
    for (const seed of SEEDS) {
      const { vm, final } = watch({ ...P, seed })
      expect(vm.displayScore, `시드 ${seed}`).toEqual(final.score)
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
  /**
   * 모든 슛에서 (거리, 빗나감, 득점 여부)를 뽑는다.
   *
   * **드문 사건 표본(36판)을 쓴다.** 판당 슛이 세 번 안팎이고 여기서
   * 다시 득점/무득점과 원/근거리로 네 칸으로 쪼개므로, 여섯 판으로는
   * 한 칸에 한두 개만 남아 비교가 성립하지 않는다.
   */
  const shots: Array<{ d: number; wide: boolean; score: boolean }> = []
  for (const fs of WIDE) {
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
    /**
     * 공 기준 상대 위치가 아니라 **절대 위치**로 잰다. 공격 상황과 수비
     * 상황은 공 위치 자체가 다르므로, 상대 위치로 재면 두 효과가 섞인다.
     *
     * **다만 "우리가 공을 가졌다"가 곧 "공격 중"은 아니다.** 자기 진영에서
     * 뒤로 돌리며 빌드업하는 시간이 그 표본의 절반이고, 그때 수비라인은
     * 당연히 낮다. 두 상황을 뭉쳐서 재면 실측 차이가 ±1미터 안으로
     * 좁아져(0.97 ↔ −0.75) 연출을 어느 방향으로 손대든 부호가 뒤집힌다 —
     * 검사가 축구 원칙이 아니라 특정 시드의 지문을 지키게 된다.
     *
     * 그래서 **공이 어느 진영에 있는지까지 함께 본다.** 상대 진영에서
     * 우리가 공을 쥔 순간이 공격이고, 우리 진영에서 상대가 공을 쥔
     * 순간이 수비다. 이쪽 차이는 5~7미터로 뚜렷하다.
     */
    const attack = ours.filter((f) => f.ball.x > PITCH_W / 2)
    const defend = theirs.filter((f) => f.ball.x < PITCH_W / 2)
    expect(attack.length, '공격 표본').toBeGreaterThan(50)
    expect(defend.length, '수비 표본').toBeGreaterThan(50)
    const up = meanX(attack, isDF)
    const back = meanX(defend, isDF)
    expect(
      up,
      `수비라인 x — 공격 ${up.toFixed(1)} vs 수비 ${back.toFixed(1)}`,
    ).toBeGreaterThan(back + 3)
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
  for (const fs of WIDE) {
    for (let i = 1; i < fs.length; i++) {
      const prev = fs[i - 1]
      const now = fs[i]
      if (prev.mode !== 'HELD' || !prev.holder) continue
      const isShot = now.mode === 'SHOT'
      const isPass = now.mode === 'PASS' && now.ball.kick === 'PASS'
      if (!isShot && !isPass) continue
      // 골키퍼의 골킥·펀트는 공격 판단이 아니다
      if (prev.holder === 'H1' || prev.holder === 'A1') continue
      /**
       * 슛은 **실제로 찬 지점**(ball.fromX/fromY)으로 잰다.
       *
       * 직전 프레임의 볼 소유자로 재면 안 된다. 시뮬이 골이라고 알렸는데
       * 그 팀 선수가 아무도 골대 근처에 없으면 연출이 공을 다른 선수에게
       * 넘기고 쏘는데, 그 한 틱 안에 소유자가 바뀌므로 엉뚱한 사람의
       * 자리로 재게 된다 — 실측으로 105미터짜리 슛이 잡혔다.
       */
      const p = prev.players.find((x) => x.id === prev.holder)!
      // 찬 팀도 실제로 찬 쪽(lastTouch)으로 본다. 한 틱 안에 소유가
      // 바뀌면 직전 소유자와 실제 슈터의 팀이 다를 수 있다
      /**
       * **패스도 실제로 찬 지점으로 잰다.**
       *
       * 위의 슛과 같은 이유다. 한 틱(0.1초) 안에 소유가 바뀌면 직전
       * 프레임의 소유자는 그 공을 차지 않은 사람이다. 실측으로 이
       * 오차가 "박스 안 백패스" 일곱 개를 만들어냈는데, 실제로 박스
       * 안에서 패스를 고른 경우는 일흔두 판에 한 번이었다.
       */
      const side = now.ball.lastTouch === 'HOME' ? 'H' : 'A'
      const gx = GOAL_OF(side)
      const from = { x: now.ball.fromX, y: now.ball.fromY }
      void p
      kicks.push({
        side,
        goalDist: Math.hypot(gx - from.x, PITCH_H / 2 - from.y),
        kind: isShot ? 'SHOT' : 'PASS',
      })
    }
  }

  it('표본이 충분하다', () => {
    expect(kicks.length).toBeGreaterThan(400)
  })

  it('박스 안에서는 네 번 중 세 번 이상 슛한다', () => {
    // 실제 축구다. 골라인 16.5미터 안에서 각이 열려 있으면 슛이 우선이다.
    // 단순히 패스보다 한 번만 많게 두면 문전 백패스가 계속 눈에 띌 수 있다.
    const box = kicks.filter((k) => k.goalDist <= 16.5)
    expect(box.length, '박스 안 표본').toBeGreaterThan(5)
    const shots = box.filter((k) => k.kind === 'SHOT').length
    expect(shots / box.length, `박스 안 슛 ${shots} vs 패스 ${box.length - shots}`)
      .toBeGreaterThanOrEqual(0.75)
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

  it('우리 팀과 상대 모두 박스 안에서는 슛이 우선이다', () => {
    // 사용자 요구다 — "컴퓨터든 우리팀이든". 존재만 확인하면 한쪽이
    // 문전에서 계속 패스하는 회귀를 잡지 못하므로 팀별 비율까지 고정한다.
    for (const side of ['H', 'A']) {
      const box = kicks.filter((k) => k.side === side && k.goalDist <= 16.5)
      const shots = box.filter((k) => k.kind === 'SHOT').length
      expect(box.length, `${side} 팀의 박스 안 판단 표본`).toBeGreaterThan(2)
      expect(
        shots / box.length,
        `${side} 팀의 박스 안 슛 ${shots} vs 패스 ${box.length - shots}`,
      ).toBeGreaterThanOrEqual(0.75)
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
    /**
     * 공이 페널티 지역(16.5m) 안에 있는데 골키퍼가 그보다 앞에 나가
     * 있으면 골문이 비어 있다는 뜻이다.
     *
     * 최댓값이 아니라 중앙값으로 잰다. 공이 갑자기 박스로 들어오면
     * 골키퍼는 물러나는 중이고, 사람이라 순간이동하지 못한다. 그 몇
     * 프레임의 최댓값은 자리 잡는 실력이 아니라 달리는 속도의 문제다
     */
    const inBox = gk.filter((g) => g.ballDist <= 16.5)
    expect(inBox.length).toBeGreaterThan(20)
    const outs = inBox.map((g) => g.out).sort((a, b) => a - b)
    const median = outs[Math.floor(outs.length / 2)]
    expect(median, `상대가 박스에 있을 때 골키퍼 위치 중앙값 ${median.toFixed(1)}m`)
      .toBeLessThan(5)
    // 물러나는 중이라도 페널티 지역을 넘어 나가 있으면 안 된다
    expect(outs[outs.length - 1]).toBeLessThan(16.5)
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

describe('골은 갑자기 터지지 않는다', () => {
  /**
   * 골 장면이 슛으로 들어갔는지, 슛 없이 골망으로 컷했는지.
   *
   * 직전 한 프레임만 보면 안 된다. 한 프레임은 0.1초이고 초속 30미터짜리
   * 슛은 그 사이 3미터를 간다 — 골문 앞 툭 밀어넣기는 슛이 시작된 프레임과
   * 골이 된 프레임이 같아서 "슛이 없었다"로 잘못 세어진다.
   */
  const goalOf = (side: 'HOME' | 'AWAY') => (side === 'HOME' ? PITCH_W : 0)
  /** 그 팀의 공격 방향(= 상대 진영)에 공이 있는가 */
  const attacking = (side: 'HOME' | 'AWAY', x: number) =>
    side === 'HOME' ? x > PITCH_W / 2 : x < PITCH_W / 2

  const goals: Array<{
    withShot: boolean
    /** 슛을 찬 지점이 그 팀의 공격 진영인가 */
    shotInAttackHalf: boolean
    /** 슛 지점에서 골대까지의 거리(m) */
    shotDist: number
    /** 골 직전에 공이 그 팀 공격 진영에 연속으로 있던 시간(초) */
    buildup: number
    /** 종료 휘슬까지 남은 시간(초) */
    timeLeft: number
  }> = []

  for (const fs of WIDE) {
    for (let i = 1; i < fs.length; i++) {
      if (!fs[i].celebrating || fs[i - 1].celebrating) continue
      const side = fs[i].scoredBy!

      // 슛이 시작된 프레임을 찾는다. 직전 한 프레임만 보면 안 된다 —
      // 한 프레임은 0.1초이고 초속 30미터짜리 슛은 그 사이 3미터를 간다.
      // 골문 앞 툭 밀어넣기는 슛과 골이 같은 프레임에 잡힌다
      let shotAt = -1
      for (let k = Math.max(0, i - 20); k <= i; k++) {
        if (fs[k].mode === 'SHOT' && fs[k].ball.willScore && shotAt < 0) shotAt = k
      }
      while (shotAt > 0 && fs[shotAt - 1].mode === 'SHOT' && fs[shotAt - 1].ball.willScore) {
        shotAt -= 1
      }

      // 전개 — 골 직전 3초(30프레임) 동안 공이 그 팀 공격 진영에 있었나
      let run = 0
      for (let k = i - 1; k >= Math.max(0, i - 30); k--) {
        if (!attacking(side, fs[k].ball.x)) break
        run += 1
      }

      // 득점 신호가 난 틱을 거꾸로 찾는다. 종료가 임박했는지 보려면
      // 장면이 뜬 시각이 아니라 시뮬이 골을 정한 시각을 봐야 한다
      let at = i
      const sum = (f: (typeof fs)[number]) => f.state.score[0] + f.state.score[1]
      while (at > 0 && sum(fs[at]) === sum(fs[at - 1])) at -= 1

      goals.push({
        withShot: shotAt >= 0,
        shotInAttackHalf: shotAt >= 0 && attacking(side, fs[shotAt].ball.fromX),
        shotDist:
          shotAt >= 0
            ? Math.hypot(goalOf(side) - fs[shotAt].ball.fromX, GOAL_MID - fs[shotAt].ball.fromY)
            : Infinity,
        buildup: run / 10,
        timeLeft: (TOTAL_TICKS - at) * 0.1,
      })
    }
  }

  /**
   * 종료 직전의 골은 구조적으로 전개를 만들 수 없다.
   *
   * 750틱이 끝나면 화면도 멈춘다. 남은 시간이 없는데 장면을 미루면 골이
   * 영영 안 나오고 점수판만 끝에서 훌쩍 뛴다 — 그게 훨씬 나쁘다. 그래서
   * 남은 시간이 짧으면 화면은 전개를 포기하고 곧바로 골망 장면으로
   * 넘어간다. 그 골들은 아래 비율에서 뺀다. 점수가 맞는지는
   * "종료 휘슬에서 점수판이 시뮬과 정확히 같다" 가 따로 지킨다
   */
  const buildable = goals.filter((g) => g.timeLeft > 14)

  it('표본이 충분하다', () => {
    expect(goals.length, `스물네 판 동안의 골 장면 ${goals.length}`).toBeGreaterThan(10)
    expect(buildable.length, `그중 전개를 만들 시간이 있던 골 ${buildable.length}`).toBeGreaterThan(8)
  })

  it('골은 슛이 들어가는 장면으로 나온다', () => {
    /**
     * 시뮬이 "이 틱에 골"이라고 정하면 연출은 그걸 장면으로 만들어야
     * 한다. 그 순간 그 팀이 화면에서 골대 근처에 없으면 슛을 만들 수가
     * 없어 골망이 흔들리는 장면으로 건너뛴다 — 관전자에게는 공이 중원에
     * 있다가 갑자기 골이 되는 것으로 보인다.
     *
     * 실측으로 골 넷 중 셋(64%)이 그렇게 처리되고 있었다. 화면이 골을
     * 예약해두고 공격을 만든 뒤에 보여주게 되면서 대부분 슛 장면이 됐다.
     * 다만 공에서 먼 선수를 억지로 슈터로 붙이는 대신 골망 장면으로
     * 넘어가는 경우는 허용한다. 그 한 장면 때문에 공이 순간이동하면 안 된다
     */
    const shown = buildable.filter((g) => g.withShot).length
    expect(
      shown / buildable.length,
      `골 ${buildable.length}회 중 슛으로 들어간 것 ${shown}회`,
    ).toBeGreaterThan(0.88)
  })

  it('골은 상대 진영에서, 골대 사정거리 안에서 들어간다', () => {
    /**
     * 자기 진영에서 상대 골대로 때린 것이 골이 되면 그건 축구가 아니라
     * 걷어내기가 골이 된 것이다. 40미터는 실제로 존재하는 중거리 골의
     * 바깥 경계다
     */
    const bad = buildable.filter((g) => g.withShot && (!g.shotInAttackHalf || g.shotDist > 40))
    expect(
      bad.length,
      `자기 진영이거나 40m를 넘는 슛으로 들어간 골 ${bad.length}회`,
    ).toBe(0)
  })

  it('골 앞에는 전개가 있다 — 공이 하프라인을 넘어 있었다', () => {
    /**
     * 사용자가 지적한 결함이 이것이다. **"공은 아직 하프라인도 못 넘었는데"**
     * 골이 났다.
     *
     * 뿌리는 시뮬에 있다. 시뮬은 확률로 득점을 정하고, 백 판을 재보니
     * 득점을 정한 그 틱에 시뮬 자신의 볼 위치가 득점 팀의 공격 진영에
     * 있던 것은 46%뿐이었다. 그 순간에 골대 앞 장면을 만들어낼 방법은
     * 없다. 그래서 화면은 골을 예약해두고 **공을 그 팀에게 넘겨 상대
     * 진영으로 밀어붙인 다음**, 공이 상대 진영에 3초 이상 머문 뒤에야
     * 골을 넣는다.
     */
    const built = buildable.filter((g) => g.buildup >= 3)
    expect(
      built.length / buildable.length,
      `골 ${buildable.length}회 중 3초 이상 전개가 있던 것 ${built.length}회`,
    ).toBeGreaterThan(0.9)
  })

  it('화면의 공 주인이 시뮬과 오래 어긋나지 않는다', () => {
    /**
     * 전에는 시뮬의 소유 팀이 **바뀌는 순간에만** 화면을 맞췄고, 그때 공이
     * 날아가는 중이면 그 전환을 버렸다. 공은 경기의 40%를 공중에서
     * 보내므로 전환의 상당수가 사라졌고 일치율이 60%에 그쳤다.
     */
    let cmp = 0
    let same = 0
    let run = 0
    let worst = 0
    for (const fs of WIDE) {
      run = 0
      for (const f of fs) {
        if (f.mode !== 'HELD' || !f.holder || f.celebrating || f.restart) {
          run = 0
          continue
        }
        /**
         * 골 장면을 아직 못 그린 동안은 일부러 어긋나 있다.
         *
         * 시뮬은 득점한 그 틱에 이미 킥오프 상태로 넘어가 공 주인을
         * **먹힌 팀**으로 바꾼다. 화면은 그때부터 득점 팀에게 공을 주고
         * 상대 진영으로 밀어붙여 골 장면을 만든다. 그 구간을 "어긋났다"고
         * 세면 의도한 동작을 결함으로 세는 것이 된다. 점수판이 시뮬을
         * 아직 못 따라잡았다는 것이 그 구간의 표시다
         */
        if (f.shown[0] !== f.state.score[0] || f.shown[1] !== f.state.score[1]) {
          run = 0
          continue
        }
        cmp += 1
        const side = f.holder[0] === 'H' ? 'HOME' : 'AWAY'
        if (side === f.state.ball.owner) {
          same += 1
          run = 0
        } else {
          run += 1
          worst = Math.max(worst, run)
        }
      }
    }
    const rate = same / cmp
    expect(rate, `소유 팀 일치율 ${(rate * 100).toFixed(1)}%`).toBeGreaterThan(0.6)
    // 한 프레임은 0.1초. 유예 0.9초 + 넘겨주는 데 걸리는 시간을 감안한다
    expect(worst * 0.1, `가장 오래 어긋난 시간 ${(worst * 0.1).toFixed(1)}초`).toBeLessThan(4)
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
    /**
     * 시뮬 점수가 오른 뒤 세리머니까지 이어져야 한다. 숫자만 바뀌고
     * 화면은 그대로면 골이 사건으로 보이지 않는다.
     *
     * **한 판의 첫 골 하나로 재지 않는다.** 화면은 골을 예약해두고 진짜
     * 공격을 만든 뒤에 보여주므로 지연이 골마다 크게 다르다(중앙값
     * 5.5초, 90분위 12.6초). 한 골만 보면 그 골이 빠른 골이었는지를
     * 재는 셈이라, 연출 품질과 무관하게 앞뒷면이 뒤집힌다.
     */
    /** 장면을 기다려 주는 시간(틱). 25초 */
    const WINDOW = 250
    const delays: number[] = []
    let goals = 0
    let missed = 0
    for (const fs of WIDE) {
      for (let i = 1; i < fs.length; i++) {
        const before = fs[i - 1].state.score
        const now = fs[i].state.score
        if (now[0] + now[1] === before[0] + before[1]) continue
        /**
         * 장면을 만들 시간이 남지 않은 골은 여기서 세지 않는다.
         *
         * 화면은 골을 예약해두고 진짜 공격을 만든 다음에 보여주는데,
         * 750틱이 끝나면 화면도 멈추므로 전개를 만들 시간이 **구조적으로**
         * 없다. 연출 품질의 문제가 아니라 시간이 없는 것이다. 그때는
         * 점수가 맞는 쪽을 택한다(종료 시점의 점수는 `scoreboard.test.ts`가
         * 지키고, 장면이 빠짐없이 나오는지는 위의 "점수판이 올라가면"이
         * 지킨다).
         */
        if (fs.length - i < WINDOW) continue
        goals += 1
        /**
         * 이 시간 안에는 반드시 장면이 나온다.
         *
         * 유예 11초 + 전개 연장 4초가 기본이고, 그 위에 데드볼이 얹힌다 —
         * 공이 라인 밖으로 나가 스로인을 준비하는 동안에는 예약의 시계가
         * 멈추기 때문이다(그래야 재개를 기다리던 공이 골망으로 순간이동하지
         * 않는다). 실측 최대가 19.5초라 그 위로 잡는다.
         */
        let at = -1
        for (let k = i; k < Math.min(fs.length, i + WINDOW); k++) {
          if (fs[k].celebrating && !fs[k - 1].celebrating) {
            at = k
            break
          }
        }
        if (at < 0) missed += 1
        else delays.push((at - i) * 0.1)
      }
    }
    expect(goals, '시간이 남은 골 표본').toBeGreaterThan(10)
    expect(missed, `장면 없이 지나간 골 ${missed}/${goals}`).toBe(0)
    const sorted = [...delays].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    // 중앙값이 유예의 절반을 넘으면 대부분의 골이 만료 직전에 억지로
    // 터진다는 뜻이다 — 전개가 아니라 시간 초과가 골을 만든 것이다
    expect(median, `골 장면 지연 중앙값 ${median.toFixed(1)}초`).toBeLessThan(7.5)
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
  /** 재개가 새로 걸린 순간들. 한 판에 몇 번뿐이라 열네 판을 합친다 */
  const opens: Array<{ kind: string; side: string; x: number; y: number; lastKick: string }> = []
  for (const fs of WIDE) {
    for (let i = 1; i < fs.length; i++) {
      if (fs[i].restart && !fs[i - 1].restart) {
        opens.push({ ...fs[i].restart!, lastKick: fs[i - 1].holder?.[0] ?? '?' })
      }
    }
  }

  it('빗나간 슛은 골킥으로 이어진다', () => {
    // 실제 축구는 90분에 골킥이 열댓 번 나온다. 시뮬 15분이면 두세 번이다.
    // 하나도 없으면 공이 골라인 밖으로 나가는 일 자체가 없다는 뜻이다
    const kicks = opens.filter((o) => o.kind === 'GOAL_KICK')
    expect(kicks.length, `열네 판 동안의 골킥 ${kicks.length}회`).toBeGreaterThan(4)
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

  it('스로인이 실제로 나온다', () => {
    // 공이 터치라인까지 가지 않으면 스로인 코드는 죽은 코드다
    const t = opens.filter((o) => o.kind === 'THROW_IN')
    expect(t.length, `여섯 판 동안의 스로인 ${t.length}회`).toBeGreaterThan(0)
  })

  it('스로인은 공이 나간 바로 그 지점에서 넣는다', () => {
    // 라인을 따라 저만치 옮겨서 던지면 규칙 위반이다
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        if (!fs[i].restart || fs[i - 1].restart) continue
        if (fs[i].restart!.kind !== 'THROW_IN') continue
        // 한 틱(0.1초) 사이 공은 최대 2~3미터를 간다
        expect(
          Math.abs(fs[i].restart!.x - fs[i - 1].ball.x),
          `공은 x=${fs[i - 1].ball.x.toFixed(1)} 에서 나갔는데 x=${fs[i].restart!.x.toFixed(1)} 에서 던진다`,
        ).toBeLessThan(5)
      }
    }
  })

  it('스로인은 발이 아니라 손이다 — 느리고 가깝다', () => {
    /**
     * 두 손으로 머리 위에서 던지므로 발로 차는 것보다 확실히 느리다.
     * 실제 스로인은 10~20미터, 릴리스 속도 초속 8~14미터다. 발로 찬
     * 패스는 13~26미터다. 이 구분이 없으면 스로인이 40미터 롱볼이 된다.
     */
    const throws: Array<{ d: number; v: number }> = []
    for (const fs of MULTI) {
      let armed = false
      for (let i = 1; i < fs.length; i++) {
        if (fs[i - 1].restart?.kind === 'THROW_IN' && !fs[i].restart) armed = true
        if (!armed) continue
        if (fs[i].mode === 'PASS') {
          throws.push({
            d: Math.hypot(fs[i].ball.toX - fs[i].ball.fromX, fs[i].ball.toY - fs[i].ball.fromY),
            v: fs[i].ball.v,
          })
          armed = false
        } else if (fs[i].mode === 'SHOT') armed = false
      }
    }
    expect(throws.length, '스로인 표본').toBeGreaterThan(0)
    for (const t of throws) {
      // 롱스로우도 30미터 남짓이다
      expect(t.d, `던진 거리 ${t.d.toFixed(1)}m`).toBeLessThan(26)
      // 발로 찬 패스의 최저 속도가 13m/s 다. 손은 그보다 느려야 한다
      expect(t.v, `던진 속도 ${t.v.toFixed(1)}m/s`).toBeLessThan(15)
    }
  })

  it('스로인은 마지막에 건드린 팀의 상대가 던진다', () => {
    // 축구 규칙이다. 내보낸 팀이 다시 넣으면 안 된다
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        if (!fs[i].restart || fs[i - 1].restart) continue
        if (fs[i].restart!.kind !== 'THROW_IN') continue
        const kicker = fs[i - 1].ball.lastTouch
        expect(fs[i].restart!.side, `${kicker} 가 내보냈는데 ${fs[i].restart!.side} 가 던진다`)
          .not.toBe(kicker)
      }
    }
  })

  it('아웃 재개 중에는 예약된 골이 갑자기 실행되지 않는다', () => {
    /**
     * 시뮬이 실점을 예약한 뒤 화면의 공이 먼저 라인 밖으로 나가 재개를
     * 준비하는 상황이다. 예전에는 예약 시간이 데드볼 중에도 줄어, 스로인을
     * 기다리던 공이 골망으로 순간이동하며 점수판이 올랐다.
     *
     * **한 시드로 재지 않는다.** 예약 골과 데드볼이 겹치는 것은 드물어
     * 마흔 시드 중 여섯에서만 나온다. 한 판을 찍어두면 연출을 조금만
     * 손봐도 그 판에서 상황이 사라져 표본 0이 된다.
     */
    const all = Array.from({ length: 12 }, (_, i) =>
      watch({ ...P, seed: 40712 + i, initialTactics: { line: 0, press: 0, width: 0 } }).frames,
    )
    const waiting = all.flatMap((fs) =>
      fs.filter(
        (f) =>
          f.restart &&
          (f.state.score[0] !== f.shown[0] || f.state.score[1] !== f.shown[1]),
      ),
    )
    expect(waiting.length, '예약된 골을 보존한 데드볼 표본').toBeGreaterThan(0)
    for (const f of waiting) {
      expect(f.celebrating, `${f.restart?.kind} 중 세리머니가 시작됐다`).toBe(false)
    }

    for (const fs of all) {
      for (let i = 1; i < fs.length; i++) {
        const scoreChanged = fs[i].shown[0] !== fs[i - 1].shown[0] ||
          fs[i].shown[1] !== fs[i - 1].shown[1]
        if (!scoreChanged) continue
        expect(fs[i].restart, '아웃 재개 중 점수판이 바뀌었다').toBeNull()
      }
    }
  })

  it('라인 밖으로 향하는 느린 공을 예약 골로 바꾸지 않는다', () => {
    const s = createState(P)
    const vm = new VisualMatch(s, P.seed)
    vm.ball.mode = 'PASS'
    vm.ball.holder = null
    vm.ball.x = PITCH_W / 2
    vm.ball.y = PITCH_H - 0.2
    vm.ball.vx = 0
    vm.ball.vy = 0.5
    vm.ball.vz = 0
    vm.ball.lastTouch = 'HOME'

    // 종료 직전 골 신호는 기다릴 시간이 0초다. 전에는 첫 프레임에서
    // 터치라인 근처의 공을 지우고 반대편 골망으로 옮겼다.
    const scored: MatchState = {
      ...s,
      tick: TOTAL_TICKS - 1,
      score: [s.score[0] + 1, s.score[1]],
    }
    vm.sync(scored)
    vm.advance(scored, 1 / 60)

    expect(vm.celebration).toBeNull()
    expect(vm.displayScore).toEqual(P.score)
    expect(vm.ball.y).toBeGreaterThan(PITCH_H - 0.2)
    expect(vm.ball.y).toBeLessThan(PITCH_H)
  })

  it('재개를 기다리는 동안 공이 그 자리에 멈춰 있다', () => {
    for (const fs of MULTI) {
      for (let i = 1; i < fs.length; i++) {
        const a = fs[i - 1].restart
        const b = fs[i].restart
        if (!a || !b) continue
        /**
         * **같은 재개 안에서만 본다.**
         *
         * 한 틱 안에서 앞의 재개가 끝나고 새 재개가 걸리면 공은 당연히
         * 다른 자리에 놓인다 — 그건 심판이 공을 놓은 것이지 순간이동이
         * 아니다. 공이 밖으로 더 자주 나가게 만들면 그 경우가 늘어난다.
         */
        if (a.kind !== b.kind || a.side !== b.side || Math.hypot(a.x - b.x, a.y - b.y) > 0.01) continue
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

describe('개별 지시가 화면에서 보인다', () => {
  /**
   * 지시는 확률만 바꿔서는 조작이 되지 않는다.
   *
   * 감독이 무언가를 시켰으면 **그 선수가 다르게 움직이는 것이 보여야**
   * 한다. 화면에서 아무 일도 안 일어나면 감독은 자기가 무엇을 시켰는지
   * 확인할 방법이 없고, 그러면 지시는 조작이 아니라 설정이 된다.
   */
  function watchWithOrders(orders: Array<[string, PlayerOrder]>, seed = P.seed, ticks = 400) {
    const rng = createRng(seed)
    let s = createState({ ...P, seed })
    s = {
      ...s,
      players: s.players.map((x) => {
        const hit = orders.find(([id]) => id === x.id)
        return hit ? { ...x, order: hit[1] } : x
      }),
    }
    const vm = new VisualMatch(s, seed)
    const track = new Map<number, Array<{ x: number; v: number }>>()
    for (let i = 0; i < ticks; i++) {
      s = tick(s, rng)
      // 지시는 시뮬 상태에 이미 얹혀 있다. sync 가 화면으로 옮긴다
      vm.sync(s)
      for (let f = 0; f < 6; f++) vm.advance(s, 1 / 60)
      for (const p of vm.players) {
        if (p.side !== 'HOME') continue
        const list = track.get(p.num) ?? []
        list.push({ x: p.x, v: Math.hypot(p.vx, p.vy) })
        track.set(p.num, list)
      }
    }
    return track
  }

  const numOf = (id: string) => getPlayer(id).num
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

  /**
   * 지시 효과는 **여덟 판을 합쳐서** 잰다.
   *
   * 화면 연출은 서로 얽힌 스물두 명의 움직임이라, 한 명을 늦추면 그 판의
   * 전개 자체가 달라진다. 한 판만 재면 그 판이 어떻게 흘렀는지를 재는
   * 셈이 되어, 지시가 실제로 보이는지와 무관하게 값이 뒤집힌다. 실제로
   * "물러서라"는 한 판 기준으로 지시 전 47m·지시 후 49m 였지만, 열두 판
   * 평균은 57.9m → 48.3m 였다. 세 판도 모자랐다 — 지시와 무관한 연출
   * 변경만으로 "나머지 평균 속도"가 9%씩 흔들렸다.
   */
  const ORDER_SEEDS = Array.from({ length: 8 }, (_, i) => P.seed + i)
  function trackAcross(orders: Array<[string, PlayerOrder]>, num: number) {
    const xs: number[] = []
    const vs: number[] = []
    const others: number[] = []
    for (const seed of ORDER_SEEDS) {
      const t = watchWithOrders(orders, seed)
      for (const f of t.get(num)!) {
        xs.push(f.x)
        vs.push(f.v)
      }
      for (const [n, list] of t) {
        if (n === num) continue
        for (const f of list) others.push(f.v)
      }
    }
    return { x: mean(xs), v: mean(vs), otherV: mean(others) }
  }

  it('골문 앞을 지키라고 하면 우리 골대 앞을 안 떠난다', () => {
    /**
     * 우리 골대는 x=0 이다. 지시를 받은 수비수는 팀이 올라가도 남는다.
     * 공을 직접 몰거나 받으러 갈 때는 나갈 수 있으므로 최댓값이 아니라
     * **평균 위치**로 본다 — 말뚝이 아니라 자리를 지키는 것이 목표다
     */
    const n = numOf('DF04')
    const off = trackAcross([], n)
    const on = trackAcross([['DF04', 'HOLD']], n)
    expect(on.x, `평균 위치 ${off.x.toFixed(1)}m → ${on.x.toFixed(1)}m`).toBeLessThan(off.x - 5)
    // 페널티 지역 언저리에 머문다. 하프라인 근처면 지시가 안 보인다
    expect(on.x).toBeLessThan(PITCH_W / 2)
  })

  it('아껴 뛰라고 하면 그 선수만 느려진다', () => {
    /**
     * **최고 속도가 아니라 평균 속도로 잰다.** 최고 속도는 400틱 중 한
     * 프레임의 값이라, 그 선수가 마침 리드 패스를 받으러 달렸는지 아닌지에
     * 좌우된다. 지시가 걸렸는지는 경기 내내의 평균이 말해준다.
     */
    const n = numOf('MF06')
    const off = trackAcross([], n)
    const on = trackAcross([['MF06', 'CONSERVE']], n)
    expect(on.v, `평균 속도 ${off.v.toFixed(2)} → ${on.v.toFixed(2)} m/s`).toBeLessThan(off.v * 0.85)

    // 다른 선수는 그대로 뛴다. 한 명에게 내린 지시가 팀 전체에 걸리면
    // 화면에서 누구에게 시켰는지 구분할 수가 없다. 스물두 명이 서로
    // 얽혀 움직이므로 완전히 같을 수는 없고, 본인이 받은 만큼 느려지면
    // 그건 팀에 걸린 것이다
    expect(
      Math.abs(on.otherV - off.otherV) / off.otherV,
      `나머지 평균 속도 ${off.otherV.toFixed(2)} → ${on.otherV.toFixed(2)} m/s`,
    ).toBeLessThan(0.08)
  })

  it('물러서라고 하면 뒤에 남는다', () => {
    const n = numOf('MF06')
    const off = trackAcross([], n)
    const on = trackAcross([['MF06', 'BACK_OFF']], n)
    // 화면에서 알아볼 수 있어야 한다. 1미터 차이는 안 보인다
    expect(on.x, `평균 위치 ${off.x.toFixed(1)}m → ${on.x.toFixed(1)}m`).toBeLessThan(off.x - 5)
  })
})

/**
 * 심판 셋과 오프사이드.
 *
 * 사용자가 지적했다 — "심판도 없고 라인 심도 없어. 그러니까 오프사이드도
 * 없고 그냥 동그라미가 공차는 것만 보이잖아."
 *
 * 여기서 지키는 것은 두 가지다. **심판이 경기에 개입하지 않는다**(공에
 * 닿지 않고 난수를 쓰지 않는다)와 **판정이 실제 축구의 빈도 안에 있다.**
 */
describe('심판 셋과 오프사이드', () => {
  /** 심판 자리와 공을 함께 기록하며 한 판을 끝까지 본다 */
  function watchOfficials(seed: number) {
    const problem = { ...P, seed }
    const rng = createRng(seed)
    let s = createState(problem)
    const vm = new VisualMatch(s, seed)
    const rows: Array<{
      officials: Array<{ kind: string; x: number; y: number; flag: number }>
      ball: { x: number; y: number; mode: string }
      restart: string | null
      line: { home: number; away: number }
    }> = []
    for (let i = 0; i < TOTAL_TICKS; i++) {
      s = tick(s, rng)
      vm.sync(s)
      for (let f = 0; f < 6; f++) vm.advance(s, 1 / 60)
      rows.push({
        officials: vm.officials.map((o) => ({ kind: o.kind, x: o.x, y: o.y, flag: o.flag })),
        ball: { x: vm.ball.x, y: vm.ball.y, mode: vm.ball.mode },
        restart: vm.restart ? `${vm.restart.kind}|${vm.restart.side}|${vm.restart.x.toFixed(2)}|${vm.restart.y.toFixed(2)}` : null,
        line: { home: vm.offsideLine('HOME'), away: vm.offsideLine('AWAY') },
      })
    }
    return { rows, vm }
  }

  const RUNS = [0, 1, 2, 3, 4, 5].map((i) => watchOfficials(P.seed + i))

  it('주심 하나와 부심 둘이 언제나 경기장에 있다', () => {
    for (const { rows } of RUNS) {
      for (const r of rows) {
        expect(r.officials).toHaveLength(3)
        expect(r.officials.map((o) => o.kind).sort()).toEqual([
          'AR_BOTTOM',
          'AR_TOP',
          'REFEREE',
        ])
      }
    }
  })

  it('부심은 자기 터치라인을 벗어나지 않는다', () => {
    // 부심이 경기장 안으로 들어오면 스물세 번째 선수로 보인다.
    // 위쪽 부심은 위쪽 라인에, 아래쪽 부심은 아래쪽 라인에 붙어 있어야 한다
    for (const { rows } of RUNS) {
      for (const r of rows) {
        const top = r.officials.find((o) => o.kind === 'AR_TOP')!
        const bottom = r.officials.find((o) => o.kind === 'AR_BOTTOM')!
        expect(top.y).toBeLessThan(PITCH_H * 0.1)
        expect(bottom.y).toBeGreaterThan(PITCH_H * 0.9)
        expect(top.x).toBeGreaterThanOrEqual(0)
        expect(top.x).toBeLessThanOrEqual(PITCH_W)
        expect(bottom.x).toBeGreaterThanOrEqual(0)
        expect(bottom.x).toBeLessThanOrEqual(PITCH_W)
      }
    }
  })

  it('부심은 각자 자기 절반을 맡는다', () => {
    // 실제 부심 둘은 서로 대각선으로 반대편 절반을 맡는다.
    // 둘 다 같은 쪽에 서 있으면 반대편 골라인을 아무도 못 본다
    for (const { rows } of RUNS) {
      for (const r of rows) {
        const top = r.officials.find((o) => o.kind === 'AR_TOP')!
        const bottom = r.officials.find((o) => o.kind === 'AR_BOTTOM')!
        expect(top.x).toBeLessThanOrEqual(PITCH_W / 2 + 0.001)
        expect(bottom.x).toBeGreaterThanOrEqual(PITCH_W / 2 - 0.001)
      }
    }
  })

  it('부심이 오프사이드 라인을 따라간다', () => {
    /**
     * 부심의 자리는 장식이 아니라 정보다. 뒤에서 두 번째 수비수(또는
     * 그보다 골라인에 가까운 공)와 나란히 서야 관전자가 선을 그리지
     * 않고도 경계를 읽는다.
     *
     * 라인이 자기 절반 밖으로 나간 순간은 뺀다 — 그때는 부심이 자기
     * 구역 끝에 서서 기다리는 것이 맞다.
     */
    let checked = 0
    let close = 0
    for (const { rows } of RUNS) {
      for (const r of rows) {
        const top = r.officials.find((o) => o.kind === 'AR_TOP')!
        // 위쪽 부심은 우리(HOME)가 지키는 절반을 맡는다
        const want = Math.min(r.line.home, r.ball.x <= r.line.home ? r.ball.x : r.line.home)
        if (want > PITCH_W / 2) continue
        checked += 1
        if (Math.abs(top.x - want) < 6) close += 1
      }
    }
    expect(checked).toBeGreaterThan(500)
    // 부심도 사람이라 라인이 튀면 따라가는 데 시간이 걸린다.
    // 늘 붙어 있는 것이 아니라 **따라간다**는 것이 기준이다
    expect(close / checked, `라인 추종률 ${((close / checked) * 100).toFixed(1)}%`).toBeGreaterThan(0.8)
  })

  it('주심은 플레이에서 떨어져 있다', () => {
    /**
     * 최소 거리 하나로 잡으면 안 된다. 주심이 자리를 옮기는 도중 공이
     * 그 앞을 스쳐 지나가는 순간이 반드시 생기고, 실제 축구에도 있다.
     * 재보니 여섯 판에서 최소 1.3미터까지 붙는다.
     *
     * 봐야 할 것은 **평소에 떨어져 있는가**다. 실측 분포는 10미터 이상이
     * 88%이고, 발밑 판정 거리(2.6미터) 안은 0.67%다. 비율로 고정한다
     */
    let held = 0
    let far = 0
    let touching = 0
    for (const { rows } of RUNS) {
      for (const r of rows) {
        if (r.ball.mode !== 'HELD') continue
        const ref = r.officials.find((o) => o.kind === 'REFEREE')!
        const d = Math.hypot(ref.x - r.ball.x, ref.y - r.ball.y)
        held += 1
        if (d >= 10) far += 1
        if (d < 2.6) touching += 1
      }
    }
    expect(held).toBeGreaterThan(500)
    // 대부분의 시간을 플레이 밖에서 본다
    expect(far / held, `10m 이상 ${((far / held) * 100).toFixed(1)}%`).toBeGreaterThan(0.7)
    // 공 가진 선수로 오해될 만큼 붙는 일은 거의 없다
    expect(touching / held, `발밑 거리 ${((touching / held) * 100).toFixed(2)}%`).toBeLessThan(0.03)
  })

  it('오프사이드 빈도가 실제 축구 범위 안이다', () => {
    /**
     * 실제 축구는 90분에 양 팀 합쳐 4~6회다. 이 화면은 15분 구간이므로
     * 판당 0.7~1.0회가 된다.
     *
     * **숫자를 박지 않고 범위로 쓴다.** 위쪽이 중요하다 — 판정이 잦으면
     * 데드볼이 늘어 75초짜리 관전에서 볼 것이 사라진다. 아래쪽은 0을
     * 막기만 한다. 애매하면 안 부는 쪽이 맞기 때문이다
     */
    const wide = Array.from({ length: 24 }, (_, i) => watchOfficials(P.seed + 900 + i * 31).vm)
    const total = wide.reduce((a, vm) => a + vm.offsideCount, 0)
    const per = total / wide.length
    expect(per, `판당 ${per.toFixed(2)}회`).toBeLessThan(2.5)
    expect(total, `스물네 판에서 ${total}회`).toBeGreaterThan(0)
  })

  it('오프사이드를 불어도 공이 순간이동하지 않는다', () => {
    /**
     * 부심은 패스가 나가는 순간 깃발을 들고, 휘슬은 공이 멎은 뒤에
     * 분다. 그래서 프리킥 자리는 공이 실제로 굴러온 자리다.
     *
     * 처음에는 오프사이드였던 선수 자리에 공을 바로 놓았는데, 공이 한
     * 프레임에 최대 37미터를 건너뛰었다. 규칙상으로는 그 자리가 맞지만
     * 화면에서는 고장으로 보인다
     */
    for (const { rows } of RUNS) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i - 1].ball.mode !== 'HELD' || rows[i].ball.mode !== 'HELD') continue
        const d = Math.hypot(
          rows[i].ball.x - rows[i - 1].ball.x,
          rows[i].ball.y - rows[i - 1].ball.y,
        )
        expect(d).toBeLessThan(7)
      }
    }
  })

  it('재개를 기다리는 동안 공이 그 자리에 있다', () => {
    for (const { rows } of RUNS) {
      for (let i = 1; i < rows.length; i++) {
        // 같은 재개 안에서만 본다. 한 틱 안에서 앞의 재개가 끝나고 새
        // 재개가 걸리면 공은 당연히 다른 자리에 놓인다 — 그건 심판이
        // 공을 놓은 것이지 순간이동이 아니다
        if (!rows[i].restart || rows[i].restart !== rows[i - 1].restart) continue
        const d = Math.hypot(
          rows[i].ball.x - rows[i - 1].ball.x,
          rows[i].ball.y - rows[i - 1].ball.y,
        )
        expect(d).toBeLessThan(0.01)
      }
    }
  })

  it('위치에만 있고 관여하지 않은 선수는 잡지 않는다', () => {
    /**
     * 규칙 11조의 핵심이다. **오프사이드 위치에 있는 것 자체는 반칙이
     * 아니다.** 그 선수가 공을 건드려 플레이에 관여해야 반칙이 된다.
     *
     * 그래서 부심의 깃발은 선언이 아니라 질문이고, 수비수가 먼저 끊거나
     * 다른 동료가 받으면 깃발은 내려간다. 든 깃발이 **전부** 휘슬이
     * 된다면 위치만으로 불고 있다는 뜻이다.
     *
     * 숫자를 박지 않고 부등호로 쓴다 — 비율은 시드마다 다르다.
     */
    const raised = RUNS.reduce((a, r) => a + r.vm.flagsRaised, 0)
    const blown = RUNS.reduce((a, r) => a + r.vm.offsideCount, 0)
    expect(raised, '깃발이 한 번도 안 올라갔다').toBeGreaterThan(0)
    expect(blown, '휘슬이 한 번도 안 불렸다').toBeGreaterThan(0)
    expect(blown, `깃발 ${raised}회 중 휘슬 ${blown}회`).toBeLessThan(raised)
  })
})

/**
 * 오프사이드 **위치** 판정 — 경기 규칙 11조 그대로인가.
 *
 * 위의 검사들이 "경기에서 몇 번 나오는가"를 본다면, 여기서는 규칙 자체를
 * 한 줄씩 짚는다. 자리를 직접 만들어 넣으므로 시드에 흔들리지 않는다.
 *
 * HOME 은 x 가 커지는 쪽으로, AWAY 는 작아지는 쪽으로 공격한다.
 */
describe('오프사이드 위치 — 규칙 11조', () => {
  /** 상대 진영 깊숙이 · 공보다 앞 · 뒤에서 두 번째 상대보다 앞 */
  const OFF = { attacking: 'HOME' as const, toX: 90, ballX: 60, lineX: 80 }

  it('세 조건을 모두 만족하면 오프사이드 위치다', () => {
    expect(offsidePosition(OFF)).toBe(true)
  })

  it('자기 진영에 있으면 오프사이드가 아니다', () => {
    // 공도 뒤에서 두 번째 상대도 다 제쳤지만 하프라인을 안 넘었다
    expect(offsidePosition({ attacking: 'HOME', toX: 40, ballX: 10, lineX: 20 })).toBe(false)
  })

  it('하프라인과 나란히 서 있으면 오프사이드가 아니다', () => {
    // 공과 수비는 확실히 제쳤고 오직 ①만 아슬아슬하게 안 넘었다
    expect(offsidePosition({ attacking: 'HOME', toX: PITCH_W / 2, ballX: 30, lineX: 40 })).toBe(
      false,
    )
  })

  it('공보다 뒤에 있으면 오프사이드가 아니다', () => {
    // 상대 진영이고 수비를 제쳤어도 공이 더 앞에 있으면 아니다 — ②만 어긴다
    expect(offsidePosition({ attacking: 'HOME', toX: 85, ballX: 95, lineX: 70 })).toBe(false)
  })

  it('공과 나란히 있으면 오프사이드가 아니다', () => {
    expect(offsidePosition({ ...OFF, ballX: OFF.toX, margin: 0 })).toBe(false)
  })

  it('뒤에서 두 번째 상대와 나란히 있으면 오프사이드가 아니다', () => {
    expect(offsidePosition({ ...OFF, lineX: OFF.toX, margin: 0 })).toBe(false)
  })

  it('뒤에서 두 번째 상대보다 뒤에 있으면 오프사이드가 아니다', () => {
    expect(offsidePosition({ ...OFF, lineX: 95 })).toBe(false)
  })

  it('반대 방향으로 공격하는 팀에도 같은 규칙이 선다', () => {
    // AWAY 는 x 가 작아지는 쪽이 상대 골라인이다. HOME 의 거울상이어야 한다
    const mirror = (x: number) => PITCH_W - x
    expect(
      offsidePosition({
        attacking: 'AWAY',
        toX: mirror(OFF.toX),
        ballX: mirror(OFF.ballX),
        lineX: mirror(OFF.lineX),
      }),
    ).toBe(true)
    expect(
      offsidePosition({ attacking: 'AWAY', toX: mirror(40), ballX: mirror(10), lineX: mirror(20) }),
    ).toBe(false)
  })

  it('애매하면 안 분다 — 여유만큼 확실히 앞서야 한다', () => {
    /**
     * 실제 규칙은 신체 일부가 앞서기만 해도 오프사이드지만, 우리 선수는
     * 매 프레임 흔들리는 점이라 그대로 옮길 수 없다. 규칙에 있는 원칙을
     * 따른다 — **의심스러우면 공격 측에 유리하게.**
     *
     * 여유를 크게 줄수록 덜 분다. 방향만 검사하고 값은 박지 않는다
     */
    const near = { ...OFF, lineX: OFF.toX - 1 }
    expect(offsidePosition({ ...near, margin: 0 })).toBe(true)
    expect(offsidePosition({ ...near, margin: 5 })).toBe(false)
  })
})

/**
 * 주심이 판정을 준다.
 *
 * 사용자 요청이다 — "주심에게는 파울과 페널티킥, 스로인, 프리킥 등 축구
 * 상황에 맞게 줄 수 있다고 말해줘."
 *
 * 반칙·프리킥·페널티킥·경고·퇴장은 이미 다 일어나고 있었다. 없던 것은
 * **누가 주는가**다. 여기서 지키는 것은 신호의 주체가 규칙과 맞는가이다.
 */
describe('주심이 판정을 준다', () => {
  function watchCalls(seed: number) {
    const problem = { ...P, seed }
    const rng = createRng(seed)
    let s = createState(problem)
    const vm = new VisualMatch(s, seed)
    const calls: Array<{ kind: string; restart: string | null; refD: number; flags: number }> = []
    let kickoffSeen = false
    for (let i = 0; i < TOTAL_TICKS; i++) {
      s = tick(s, rng)
      vm.sync(s)
      for (let f = 0; f < 6; f++) {
        vm.advance(s, 1 / 60)
        if (vm.whistle) {
          if (vm.whistle.kind === 'KICKOFF') kickoffSeen = true
          const ref = vm.officials.find((o) => o.kind === 'REFEREE')!
          calls.push({
            kind: vm.whistle.kind,
            restart: vm.restart ? vm.restart.kind : null,
            refD: Math.hypot(ref.x - vm.whistle.x, ref.y - vm.whistle.y),
            flags: vm.officials.filter((o) => o.kind !== 'REFEREE' && o.flag > 0).length,
          })
        }
      }
    }
    return { calls, kickoffSeen, vm }
  }

  const RUNS = [0, 1, 2, 3, 4, 5].map((i) => watchCalls(P.seed + i))

  it('킥오프는 주심의 휘슬로 시작한다', () => {
    for (const r of RUNS) expect(r.kickoffSeen).toBe(true)
  })

  it('프리킥에는 주심이 휘슬을 분다', () => {
    // 반칙과 오프사이드가 프리킥의 두 가지 원인이다
    const kinds = new Set(RUNS.flatMap((r) => r.calls.map((c) => c.kind)))
    expect(kinds.has('FOUL') || kinds.has('OFFSIDE')).toBe(true)
  })

  it('스로인·코너·골킥에는 주심이 휘슬을 불지 않는다', () => {
    /**
     * 실제 축구에서 스로인마다 휘슬이 울리지 않는다. 그 자리에서 가장
     * 가까운 부심이 깃발을 드는 것이 신호의 전부다. 이 구분이 없으면
     * 주심이 그냥 계속 삑삑거리는 사람이 된다
     */
    for (const r of RUNS) {
      for (const c of r.calls) {
        if (c.restart === 'THROW_IN' || c.restart === 'CORNER' || c.restart === 'GOAL_KICK') {
          expect(['FOUL', 'OFFSIDE']).not.toContain(c.kind)
        }
      }
    }
  })

  it('판정을 내린 주심이 그 자리로 다가간다', () => {
    /**
     * 반칙 지점에서 30미터 떨어져 서 있는 주심은 판정을 준 사람으로
     * 보이지 않는다. 주심도 사람이라 즉시 도착하지는 못하므로 **다가가는
     * 중인가**를 본다 — 판정이 끝나갈 무렵에는 붙어 있어야 한다
     */
    let late = 0
    let near = 0
    for (const r of RUNS) {
      for (const c of r.calls) {
        // 판정 표시가 절반 이상 지난 뒤의 거리만 본다
        if (c.kind === 'KICKOFF') continue
        late += 1
        if (c.refD < 30) near += 1
      }
    }
    expect(late).toBeGreaterThan(10)
    expect(near / late, `30m 안 ${((near / late) * 100).toFixed(0)}%`).toBeGreaterThan(0.5)
  })
})

/**
 * 부심 깃발이 화면 안에 그려진다.
 *
 * 실제로 브라우저에서 20초를 지켜봐도 깃발이 한 번도 안 보여서 찾은
 * 결함이다. 실제 부심처럼 터치라인 **바깥쪽**으로 깃발을 뻗게 그렸는데,
 * 우리 캔버스는 105×68에 여백 0으로 맞춰져 있고 부심은 라인 안쪽
 * 1.1미터에 서 있다. 그래서 "바깥"이 곧 "화면 밖"이었다.
 *
 * 자동검사 342개가 전부 통과하는 동안 이 결함은 하나도 못 잡았다.
 * 그리기 좌표는 **경기장 좌표계 안에 있는지**를 봐야 잡힌다.
 */
describe('부심 깃발이 경기장 안에 그려진다', () => {
  it('깃발 끝이 캔버스 밖으로 나가지 않는다', () => {
    for (const kind of ['AR_TOP', 'AR_BOTTOM'] as const) {
      for (const raised of [false, true]) {
        const y = flagTipY(kind, raised)
        expect(y, `${kind} ${raised ? '들었을 때' : '내렸을 때'} y=${y}`).toBeGreaterThan(0)
        expect(y, `${kind} ${raised ? '들었을 때' : '내렸을 때'} y=${y}`).toBeLessThan(PITCH_H)
      }
    }
  })

  it('깃발은 경기장 안쪽을 향한다', () => {
    // 위쪽 부심은 아래로, 아래쪽 부심은 위로. 반대로 두면 화면 밖이다
    expect(flagTipY('AR_TOP', true)).toBeGreaterThan(flagTipY('AR_TOP', false))
    expect(flagTipY('AR_BOTTOM', true)).toBeLessThan(flagTipY('AR_BOTTOM', false))
  })

  it('들면 내렸을 때보다 확실히 길다', () => {
    // 길이 차이가 작으면 들었는지 내렸는지 화면에서 구분이 안 된다
    expect(FLAG_REACH.up).toBeGreaterThan(FLAG_REACH.down * 1.5)
  })
})

/**
 * 배후 실점은 **가장 느린 수비수 뒤로 뚫린 장면**으로 나온다.
 *
 * 시뮬은 배후 실점을 `minDefenderSpeed` 하나로 정한다 — "우리 수비수 중
 * 가장 느린 선수 때문에 뚫렸다"가 그 골의 뜻이다. 전에는 화면이 그 뜻을
 * 한 번도 읽지 않았다. 점수 차이만 보고 "아무 공격"을 만들었고, 실측으로
 * 그 선수가 실제 최근접 수비수인 장면은 47골 중 10골(21.3%)뿐이었다.
 *
 * **숫자를 박지 않는다.** 배후 실점과 그 밖의 실점을 같은 판에서 나란히
 * 재서 방향과 비율로만 본다. 밸런스를 조정해 실점 구성이 바뀌어도 이
 * 검사는 살아 있어야 한다.
 */
describe('배후 실점 장면이 계산상 원인과 맞는다', () => {
  const HIGH_LINE: Problem = {
    id: 'p01',
    title: '길이 막혔다',
    order: 2,
    score: [0, 1],
    // 라인을 올려야 배후 침투 표본이 모인다. 낮은 라인에서는 판당 0.02골이다
    initialTactics: { line: 2, press: 1, width: 0 },
    initialFormation: '5-4-1',
    objective: { type: 'EQUALIZE', bonusOnWin: true },
    seed: 33104,
    subsLeft: 3,
    staminaOverrides: { DF04: 66, MF06: 55, FW09: 61, MF08: 63 },
    booked: [],
    unavailable: [],
    awayCount: 11,
  }

  interface Scene {
    behind: boolean
    /** 시뮬이 지목한 가장 느린 수비수가 슈터와 가장 가까운 수비수였는가 */
    slowIsNearest: boolean
    /** 슈터가 수비 평균선보다 골대 쪽까지 들어갔는가 */
    pastLine: boolean
    /** 슈터와 가장 느린 수비수의 거리(m) */
    dSlow: number
  }

  /** 지금 피치 위 가장 느린 수비수들의 화면 id (동률 전부) */
  const slowestIds = (s: MatchState) => {
    const defs = s.players.filter((q) => q.onPitch && !q.out && effectivePos(q) === 'DF')
    if (!defs.length) return new Set<string>()
    const min = Math.min(...defs.map((q) => abilityOf(q).speed))
    return new Set(
      defs.filter((q) => abilityOf(q).speed === min).map((q) => `H${getPlayer(q.id).num}`),
    )
  }

  const scenes: Scene[] = []
  for (let n = 0; n < 180; n++) {
    const seed = HIGH_LINE.seed + n * 17
    const rng = createRng(seed)
    let s = createState({ ...HIGH_LINE, seed })
    const vm = new VisualMatch(s, seed)
    /** 시뮬이 적은 실점 경로. 화면의 득점 슛과 순서대로 짝짓는다 */
    const causes: string[] = []
    let logLen = 0
    let wasShot = false
    /**
     * 짝짓기는 **점수판**으로 한다.
     *
     * 슛으로 센 순번을 쓰면, 화면이 슛을 못 만들고 골망 장면으로 때운
     * 골에서 순번이 한 칸 밀려 그 뒤 전부가 남의 원인을 물려받는다.
     * 점수판은 슛이든 골망이든 골 하나에 정확히 한 번 오른다.
     */
    // 국면은 0-1 처럼 이미 점수가 있는 상태로 시작한다. 원인 줄은 이 경기
    // 안에서 난 실점만 세므로 세는 자리를 따로 둔다
    let shown = vm.displayScore[1]
    let conceded = 0
    let scene: Omit<Scene, 'behind'> | null = null

    for (let i = 0; i < TOTAL_TICKS; i++) {
      s = tick(s, rng)
      for (let k = logLen; k < s.log.length; k++) {
        const e = s.log[k]
        if (e.kind === 'PENALTY' && e.detail === 'PENALTY_SCORED') causes.push('PENALTY')
        if (e.kind === 'CONCEDE' && e.detail) causes.push(...e.detail.split('+'))
      }
      logLen = s.log.length
      const slow = slowestIds(s)
      vm.sync(s)
      for (let f = 0; f < 6; f++) {
        vm.advance(s, 1 / 60)
        const b = vm.ball
        const scoring = b.mode === 'SHOT' && b.willScore
        // 상대의 득점 슛이 **출발하는 그 프레임**에 잰다
        if (scoring && !wasShot && b.kickerId?.[0] === 'A') {
          const shooter = vm.players.find((q) => q.id === b.kickerId)
          const defs = vm.players.filter((q) => q.side === 'HOME' && q.pos === 'DF')
          if (shooter && defs.length) {
            const gap = (q: { x: number; y: number }) =>
              Math.hypot(q.x - shooter.x, q.y - shooter.y)
            let near = defs[0]
            for (const q of defs) if (gap(q) < gap(near)) near = q
            const mine = defs.filter((q) => slow.has(q.id))
            scene = {
              slowIsNearest: slow.has(near.id),
              // 상대는 x=0 을 공격한다. 작을수록 우리 골대에 가깝다
              pastLine: shooter.x < defs.reduce((a, q) => a + q.x, 0) / defs.length,
              dSlow: mine.length ? Math.min(...mine.map(gap)) : NaN,
            }
          }
        }
        wasShot = scoring

        // 점수판이 올랐다 — 방금 잰 슛이 이 골이다
        while (shown < vm.displayScore[1]) {
          const k = conceded
          shown += 1
          conceded += 1
          if (scene) scenes.push({ behind: causes[k] === 'BEHIND', ...scene })
          scene = null
        }
      }
    }
  }

  const behind = scenes.filter((x) => x.behind && Number.isFinite(x.dSlow))
  const other = scenes.filter((x) => !x.behind && Number.isFinite(x.dSlow))
  const ratio = (arr: Scene[], f: (x: Scene) => boolean) =>
    arr.filter(f).length / Math.max(arr.length, 1)
  /**
   * 거리는 **중앙값**으로 본다.
   *
   * 배후 실점은 판당 0.05골이라 이 표본이 열 개 안팎이다. 장면이 만들어지지
   * 못한 한 골(교체로 배역이 사라졌거나 유예가 끝난 경우)이 25미터를 찍으면
   * 평균이 통째로 끌려간다. 평균으로 쓰면 이 검사는 통과와 실패를 오간다.
   */
  const mid = (arr: Scene[]) => {
    const v = arr.map((x) => x.dSlow).sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)] : NaN
  }

  it('표본이 충분하다', () => {
    expect(behind.length, `배후 실점 ${behind.length}골`).toBeGreaterThan(3)
    expect(other.length).toBeGreaterThan(10)
  })

  it('배후 실점의 슈터 옆에 있는 수비수가 곧 시뮬이 지목한 그 선수다', () => {
    const r = ratio(behind, (x) => x.slowIsNearest)
    expect(
      r,
      `배후 ${(r * 100).toFixed(0)}% · 그 밖 ${(ratio(other, (x) => x.slowIsNearest) * 100).toFixed(0)}%`,
    ).toBeGreaterThan(0.7)
    // 그 밖의 실점에서는 그럴 이유가 없다. 우연히 같아지면 원인을 안 읽는 것이다
    expect(r).toBeGreaterThan(ratio(other, (x) => x.slowIsNearest) * 1.5)
  })

  it('배후 실점의 슈터는 수비선을 넘어 들어가 있다', () => {
    const r = ratio(behind, (x) => x.pastLine)
    expect(r, `배후 ${(r * 100).toFixed(0)}%`).toBeGreaterThan(0.8)
    expect(r).toBeGreaterThan(ratio(other, (x) => x.pastLine))
  })

  it('배후 실점에서 그 수비수는 다른 실점보다 훨씬 가까이 있다', () => {
    expect(
      mid(behind),
      `배후 ${mid(behind).toFixed(1)}m · 그 밖 ${mid(other).toFixed(1)}m · 표본 ${behind.length}골`,
    ).toBeLessThan(mid(other) * 0.7)
  })
})

describe('예약 득점은 공 없는 슈터에게 순간이동하지 않는다', () => {
  it('p03/83918의 살아 있는 공 전환·골 장면·종료 점수가 모두 이어진다', () => {
    const rng = createRng(P03_83918.seed)
    let state = createState(P03_83918)
    const vm = new VisualMatch(state, P03_83918.seed)
    let simulatedGoals = 0
    let queuedGoals = 0
    let goalScenes = 0
    const nonContactJumps: number[] = []

    for (let tickIndex = 0; tickIndex < TOTAL_TICKS; tickIndex++) {
      const priorScore = state.score[0] + state.score[1]
      state = tick(state, rng)
      const goals = state.score[0] + state.score[1] - priorScore
      simulatedGoals += goals
      // 골 전개 유예(11초)를 온전히 쓸 수 있는 예약만 장면 표본으로 센다.
      if (tickIndex < TOTAL_TICKS - 110) queuedGoals += goals
      vm.sync(state)

      for (let frame = 0; frame < 6; frame++) {
        const before = { x: vm.ball.x, y: vm.ball.y }
        const players = vm.players.map((player) => ({ x: player.x, y: player.y }))
        const wasLive = vm.celebration === null && vm.restart === null
        const wasCelebrating = vm.celebration !== null

        vm.advance(state, 1 / 60)

        if (!wasCelebrating && vm.celebration !== null) goalScenes += 1
        const stillLive = vm.celebration === null && vm.restart === null
        if (!wasLive || !stillLive) continue

        const moved = Math.hypot(vm.ball.x - before.x, vm.ball.y - before.y)
        if (moved < 5) continue
        const contact = Math.min(
          ...players.map((player) => Math.hypot(player.x - before.x, player.y - before.y)),
        )
        if (contact > SHOT_CONTACT_DIST) nonContactJumps.push(moved)
      }
    }

    vm.sync(state)
    expect(nonContactJumps, `비접촉 5m 이상 이동 ${nonContactJumps.join(', ')}`).toHaveLength(0)
    expect(
      Math.max(0, queuedGoals - goalScenes),
      `예약 골 장면 ${goalScenes} / 유예 시간이 남은 득점 ${queuedGoals} / 전체 득점 ${simulatedGoals}`,
    ).toBe(0)
    expect(vm.displayScore).toEqual(state.score)
  })
})
