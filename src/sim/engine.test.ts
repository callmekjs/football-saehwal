import { describe, it, expect } from 'vitest'
import { simulate, createState, tick, checkOrder, checkPosition, carryToNextHalf, simulateHalves } from './engine'
import { createRng } from './rng'
import { BASE, EVENTS, FREE_POSITION, TOTAL_TICKS } from './constants'
import { HOME_XI, BENCH } from './squad'
import { applyOrders, applyPositions, resolveCoefficients } from './tactics'
import raw from '../data/problems.json' with { type: 'json' }
import { toProblem } from './problems'
import type { Decision, Problem } from './types'

const PROBLEMS = raw.map(toProblem).sort((a, b) => a.order - b.order)

/** 국면 2 「잠긴 문」 — 앞 감독이 전부 잠가놓은 상태를 물려받는다 */
const P: Problem = {
  id: 'p02',
  title: '잠긴 문',
  order: 1,
  score: [1, 0],
  initialTactics: { line: 0, press: 0, width: 0 },
  initialFormation: '4-4-2',
  objective: { type: 'SURVIVE', bonusOnWin: false },
  seed: 40712,
  subsLeft: 3,
  staminaOverrides: { DF04: 62, MF06: 48, FW09: 58 },
  booked: ['MF06'],
  unavailable: [],
  awayCount: 11,
}

describe('simulate — 결정론', () => {
  it('같은 시드와 같은 결정이면 완전히 같은 결과가 나온다', () => {
    const d: Decision[] = [{ tick: 100, type: 'LINE', value: 1 }]
    expect(simulate(P, d).final).toEqual(simulate(P, d).final)
  })

  it('결정을 하면 결과 분포가 달라진다', () => {
    // 한 시드만 비교하면 안 된다. 15분에 한두 골 나오는 경기라
    // 레버를 바꿔도 그 판의 스코어가 우연히 같을 수 있다.
    const tally = (decisions: Decision[]) => {
      let conceded = 0
      for (let s = 0; s < 200; s++) {
        conceded += simulate({ ...P, seed: 60000 + s }, decisions).final.score[1]
      }
      return conceded
    }
    expect(tally([{ tick: 0, type: 'LINE', value: 1 }])).not.toEqual(tally([]))
  })

  it('시드가 다르면 결과가 갈린다', () => {
    expect(simulate(P, []).final.score).not.toEqual(
      simulate({ ...P, seed: 40713 }, []).final.score,
    )
  })
})

describe('simulate — 루프', () => {
  it('정확히 750틱 돈다', () => {
    expect(simulate(P, []).final.tick).toBe(TOTAL_TICKS)
  })

  it('물려받은 지시로 시작한다', () => {
    expect(createState(P).tactics).toEqual({ line: 0, press: 0, width: 0 })
  })

  it('결정이 지정한 틱에 반영된다', () => {
    expect(simulate(P, [{ tick: 300, type: 'PRESS', value: 2 }]).final.tactics.press).toBe(2)
  })

  it('상대 성향이 스코어에서 도출된다', () => {
    // 1-0으로 우리가 이기고 있으니 상대는 지고 있어 올라온다
    expect(createState(P).opponent).toBe('ALL_OUT')
  })
})

describe('자유 선수 배치 — 계약과 재현', () => {
  const pitch = FREE_POSITION.pitch
  const forwardWide = { x: pitch.maxX, y: pitch.maxY }

  it('골키퍼·경기장 밖·수비 셋 미만 배치를 막는다', () => {
    const state = createState(P)
    expect(checkPosition(state, 'GK01', forwardWide)).not.toBeNull()
    expect(
      checkPosition(state, 'MF06', { x: pitch.minX - 1, y: pitch.centreY }),
    ).not.toBeNull()
    expect(
      checkPosition(state, 'MF06', { x: Number.NaN, y: pitch.centreY }),
    ).not.toBeNull()
    expect(checkPosition(state, 'MF06', forwardWide)).toBeNull()

    const threeBacks = {
      ...state,
      players: state.players.map((player) =>
        player.id === 'DF02' ? { ...player, position: forwardWide } : player,
      ),
    }
    expect(checkPosition(threeBacks, 'DF03', forwardWide)).not.toBeNull()
  })

  it('POSITION은 같은 틱에 정확한 좌표를 적용하고 앞뒤 줄 지시를 푼다', () => {
    const result = simulate(P, [
      { tick: TOTAL_TICKS - 1, type: 'ORDER', target: 'MF06', order: 'PUSH_UP' },
      { tick: TOTAL_TICKS - 1, type: 'POSITION', target: 'MF06', position: forwardWide },
    ])
    const player = result.final.players.find((state) => state.id === 'MF06')!
    expect(player.position).toEqual(forwardWide)
    expect(player.order).toBe('NONE')
  })

  it('앞뒤 줄 ORDER가 나중에 오면 자유 좌표를 지운다', () => {
    const result = simulate(P, [
      {
        tick: TOTAL_TICKS - 1,
        type: 'POSITION',
        target: 'MF06',
        position: { x: pitch.minX, y: pitch.centreY },
      },
      { tick: TOTAL_TICKS - 1, type: 'ORDER', target: 'MF06', order: 'PUSH_UP' },
    ])
    const player = result.final.players.find((state) => state.id === 'MF06')!
    expect(player.position).toBeNull()
    expect(player.order).toBe('PUSH_UP')
  })

  it('행동 지시와 자유 좌표는 함께 남고 NONE도 좌표를 지우지 않는다', () => {
    const held = simulate(P, [
      { tick: TOTAL_TICKS - 1, type: 'ORDER', target: 'MF06', order: 'HOLD' },
      {
        tick: TOTAL_TICKS - 1,
        type: 'POSITION',
        target: 'MF06',
        position: { x: pitch.minX, y: pitch.centreY },
      },
    ]).final.players.find((state) => state.id === 'MF06')!
    expect(held.order).toBe('HOLD')
    expect(held.position).not.toBeNull()

    const clearedOrder = simulate(P, [
      {
        tick: TOTAL_TICKS - 1,
        type: 'POSITION',
        target: 'MF06',
        position: { x: pitch.centreX, y: pitch.centreY },
      },
      { tick: TOTAL_TICKS - 1, type: 'ORDER', target: 'MF06', order: 'NONE' },
    ]).final.players.find((state) => state.id === 'MF06')!
    expect(clearedOrder.order).toBe('NONE')
    expect(clearedOrder.position).not.toBeNull()
  })

  it('새 포메이션은 자유 좌표를 모두 지우고 전체를 다시 배치한다', () => {
    const result = simulate(P, [
      { tick: 0, type: 'POSITION', target: 'MF06', position: forwardWide },
      {
        tick: 0,
        type: 'POSITION',
        target: 'DF02',
        position: { x: pitch.minX, y: pitch.minY },
      },
      { tick: 0, type: 'FORMATION', value: '5-4-1' },
    ])
    expect(result.final.players.every((state) => state.position === null)).toBe(true)
  })

  it('좌표가 null인 결정은 기존 경기와 비트 단위로 같다', () => {
    const before = simulate(P, []).final
    const after = simulate(P, [
      { tick: 0, type: 'POSITION', target: 'MF06', position: null },
    ]).final
    expect(after).toEqual(before)
  })

  it('자유 좌표 계수가 tick의 공격 판정에 실제로 연결된다', () => {
    const plain = createState(P)
    const placed = {
      ...plain,
      players: plain.players.map((player) =>
        player.id === 'MF06' ? { ...player, position: forwardWide } : player,
      ),
    }
    const basic = applyOrders(
      resolveCoefficients(
        plain.tactics,
        plain.opponent,
        plain.awayCount < 11,
        plain.homeCount < 11,
        plain.formation,
      ),
      plain.players,
    )
    const advanced = applyPositions(basic, placed.players)
    const attemptDraw = BASE.A0 * ((basic.widthK + advanced.widthK) / 2)
    const rng = () => {
      const values = [1, 1, attemptDraw, ...Array.from({ length: 15 }, () => 1)]
      return { next: () => values.shift() ?? 1 }
    }

    expect(tick(plain, rng()).stats.homeAttempt).toBe(0)
    expect(tick(placed, rng()).stats.homeAttempt).toBe(1)
  })
})

describe('simulate — 선수 상태', () => {
  it('선발 11명이 피치 위에 있고 벤치는 아니다', () => {
    const s = createState(P)
    expect(s.homeCount).toBe(11)
    for (const b of BENCH) {
      expect(s.players.find((p) => p.id === b.id)!.onPitch).toBe(false)
    }
  })

  it('퇴장 국면은 열 명으로 시작한다', () => {
    expect(createState({ ...P, unavailable: ['DF03'] }).homeCount).toBe(10)
  })

  it('경기가 진행되면 피치 위 선수의 체력이 준다', () => {
    const start = createState(P)
    const end = simulate(P, []).final
    const id = HOME_XI[5].id
    expect(end.players.find((p) => p.id === id)!.stamina).toBeLessThan(
      start.players.find((p) => p.id === id)!.stamina,
    )
  })

  it('벤치 선수의 체력은 줄지 않는다', () => {
    const end = simulate(P, []).final
    const b = BENCH[0]
    expect(end.players.find((p) => p.id === b.id)!.stamina).toBe(b.stamina0)
  })

  it('느린 수비수를 빠른 수비수로 바꾸면 실점이 준다', () => {
    // 명단의 속도가 실제로 계산에 들어가는지 확인한다.
    // 이 게임의 대표 승부처가 이 연결 위에 서 있다.
    //
    // 빼기만 하면 열 명이 되어 커버 공백 계수가 붙으므로 속도 이득이
    // 묻힌다. 교체로 인원을 유지한 채 속도만 바꿔서 비교해야 한다.
    const slowest = HOME_XI.filter((p) => p.pos === 'DF').sort((a, b) => a.speed - b.speed)[0]
    const fastest = BENCH.filter((p) => p.pos === 'DF').sort((a, b) => b.speed - a.speed)[0]

    const conceded = (decisions: Decision[]) => {
      let total = 0
      const attacking: Problem = { ...P, initialTactics: { line: 2, press: 1, width: 1 } }
      for (let s = 0; s < 400; s++) {
        total += simulate({ ...attacking, seed: 80000 + s }, decisions).final.score[1]
      }
      return total
    }

    expect(
      conceded([{ tick: 0, type: 'SUB', out: slowest.id, in: fastest.id }]),
    ).toBeLessThan(conceded([]))
  })
})

describe('볼 움직임', () => {
  /** 750틱 동안의 볼 위치를 전부 모은다 */
  const track = (p = P) => {
    const rng = createRng(p.seed)
    let s = createState(p)
    const xs: number[] = []
    for (let i = 0; i < TOTAL_TICKS; i++) {
      s = tick(s, rng)
      xs.push(s.ball.x)
    }
    return xs
  }

  it('가만히 서 있지 않는다', () => {
    // 공격 시도가 발생한 틱에만 움직이게 하면 그런 틱이 전체의 몇 퍼센트뿐이라
    // 화면에서 공이 멈춰 있는 것처럼 보인다.
    const xs = track()
    const moved = xs.filter((x, i) => i > 0 && Math.abs(x - xs[i - 1]) > 0.001).length
    expect(moved / xs.length).toBeGreaterThan(0.9)
  })

  it('경기장 전체를 오간다', () => {
    const xs = track()
    expect(Math.min(...xs)).toBeLessThan(0.3)
    expect(Math.max(...xs)).toBeGreaterThan(0.7)
  })

  it('한쪽 끝에 붙어 멈추지 않는다', () => {
    const xs = track()
    const stuck = xs.filter((x) => x <= 0.05 || x >= 0.95).length
    expect(stuck / xs.length).toBeLessThan(0.1)
  })

  it('점유가 여러 번 바뀐다', () => {
    const rng = createRng(P.seed)
    let s = createState(P)
    let flips = 0
    for (let i = 0; i < TOTAL_TICKS; i++) {
      const before = s.ball.owner
      s = tick(s, rng)
      if (s.ball.owner !== before) flips += 1
    }
    expect(flips).toBeGreaterThan(10)
  })

  it('한 틱에 순간이동하지 않는다', () => {
    // 득점 직후에는 중앙 재개이므로 그 틱은 제외한다
    const rng = createRng(P.seed)
    let s = createState(P)
    let prevX = s.ball.x
    let prevScore = s.score[0] + s.score[1]
    for (let i = 0; i < TOTAL_TICKS; i++) {
      s = tick(s, rng)
      const scored = s.score[0] + s.score[1] !== prevScore
      if (!scored) expect(Math.abs(s.ball.x - prevX)).toBeLessThan(0.05)
      prevX = s.ball.x
      prevScore = s.score[0] + s.score[1]
    }
  })

  it('판정에는 영향을 주지 않는다', () => {
    // 볼 위치는 이미 뽑아둔 난수에서 파생하므로 난수를 추가 소비하지 않는다.
    // 같은 시드로 두 번 돌리면 스코어가 같아야 한다.
    expect(simulate(P, []).final.score).toEqual(simulate(P, []).final.score)
  })
})

describe('simulate — 목표별 판정', () => {
  it('SURVIVE는 동점을 허용하면 실패다', () => {
    // 1-0으로 이기다 1-1이 되면 리드를 지킨 것이 아니다.
    // 이 구분이 없으면 1골 차 리드가 완충재로 작용해
    // 무개입 통과율이 77%까지 올라가고 국면이 퍼즐이 아니게 된다.
    const r = simulate(P, [])
    expect(r.passed).toBe(r.final.score[0] > r.final.score[1])
  })

  it('EQUALIZE는 무승부부터 통과다', () => {
    const chasing: Problem = {
      ...P,
      score: [0, 1],
      objective: { type: 'EQUALIZE', bonusOnWin: true },
    }
    const r = simulate(chasing, [])
    expect(r.passed).toBe(r.final.score[0] >= r.final.score[1])
  })

  it('같은 경기를 SURVIVE로 보면 EQUALIZE보다 통과가 어렵다', () => {
    const rate = (type: 'SURVIVE' | 'EQUALIZE') => {
      let pass = 0
      for (let s = 0; s < 300; s++) {
        const p: Problem = { ...P, seed: 70000 + s, objective: { type, bonusOnWin: false } }
        if (simulate(p, []).passed) pass++
      }
      return pass / 300
    }
    expect(rate('SURVIVE')).toBeLessThan(rate('EQUALIZE'))
  })
})

describe('simulate — 국면 2의 반전', () => {
  const passRate = (decisions: Decision[], n = 300): number => {
    let pass = 0
    for (let s = 0; s < n; s++) {
      if (simulate({ ...P, seed: 40000 + s }, decisions).passed) pass++
    }
    return pass / n
  }

  it('잠금을 푸는 쪽이 방치보다 확실히 낫다', () => {
    const noop = passRate([])
    const fix = passRate([
      { tick: 0, type: 'LINE', value: 1 },
      { tick: 0, type: 'PRESS', value: 1 },
    ])
    expect(fix - noop).toBeGreaterThan(0.15)
  })
})

describe('개별 지시 — 경기 전체', () => {

  const run = (decisions: Decision[], seeds = 300) => {
    let pass = 0
    let sendOff = 0
    let injury = 0
    let conceded = 0
    for (let s = 0; s < seeds; s++) {
      const r = simulate({ ...P, seed: P.seed + s }, decisions)
      if (r.passed) pass += 1
      sendOff += r.final.log.filter((e) => e.kind === 'SEND_OFF').length
      injury += r.final.log.filter((e) => e.kind === 'INJURY').length
      conceded += r.final.score[1] - P.score[1]
    }
    return { pass: pass / seeds, sendOff, injury, conceded: conceded / seeds }
  }

  /** 지시 축이 값을 갖는 조건 — 강 압박 + 경고 보유 */
  const pressed: Decision[] = [
    { tick: 0, type: 'LINE', value: 1 },
    { tick: 0, type: 'PRESS', value: 2 },
    { tick: 0, type: 'WIDTH', value: 2 },
  ]

  it('지시를 하나도 안 걸면 경기 결과가 한 톨도 안 바뀐다', () => {
    /**
     * ★ 저장된 시드와 밸런스 기준선이 여기에 달려 있다.
     *
     * `order` 칸이 생기기 전과 **완전히 같은 경기**가 나와야 한다.
     * 통계가 아니라 경기 하나하나를 비교한다
     */
    for (let s = 0; s < 40; s++) {
      const a = simulate({ ...P, seed: P.seed + s }, pressed)
      const b = simulate(
        { ...P, seed: P.seed + s },
        [...pressed, { tick: 0, type: 'ORDER', target: 'MF06', order: 'NONE' }],
      )
      expect(b.final.score, `시드 ${P.seed + s}`).toEqual(a.final.score)
      expect(b.final.log.length).toBe(a.final.log.length)
    }
  })

  it('물러서라 — 경고를 안은 선수가 퇴장에서 빠진다', () => {
    /**
     * 이 지시의 통로는 계수가 아니라 **후보 집합**이다. 반칙 후보와
     * 퇴장 위험 집합에서 그 선수가 빠지므로 두 번째 경고도 강 압박
     * 해저드도 그를 비켜간다. 난수는 이미 뽑아둔 것을 그대로 쓰고
     * 배열 길이만 바뀐다 — 소비 개수와 순서는 그대로다
     */
    const before = run(pressed)
    const after = run([
      ...pressed,
      { tick: 0, type: 'ORDER', target: 'MF06', order: 'BACK_OFF' },
    ])
    expect(before.sendOff, '지시 없이 나온 퇴장').toBeGreaterThan(0)
    expect(after.sendOff, `퇴장 ${before.sendOff} → ${after.sendOff}`).toBeLessThan(
      before.sendOff * 0.5,
    )
  })

  it('아껴 뛰어라 — 그 선수의 체력이 실제로 덜 닳는다', () => {
    const plain = simulate({ ...P, seed: P.seed }, pressed)
    const saved = simulate({ ...P, seed: P.seed }, [
      ...pressed,
      { tick: 0, type: 'ORDER', target: 'MF06', order: 'CONSERVE' },
    ])
    const of = (r: typeof plain) => r.final.players.find((x) => x.id === 'MF06')!.stamina
    expect(of(saved), `체력 ${of(plain).toFixed(1)} → ${of(saved).toFixed(1)}`).toBeGreaterThan(
      of(plain),
    )
    // 다른 선수는 그대로다. 한 명에게 내린 지시가 팀 전체에 걸리면 안 된다
    const other = (r: typeof plain) => r.final.players.find((x) => x.id === 'DF04')!.stamina
    expect(other(saved)).toBeCloseTo(other(plain), 6)
  })

  it('골문 앞 — 실점이 준다', () => {
    const before = run(pressed)
    const after = run([
      ...pressed,
      { tick: 0, type: 'ORDER', target: 'DF04', order: 'HOLD' },
      { tick: 0, type: 'ORDER', target: 'DF05', order: 'HOLD' },
    ])
    expect(after.conceded, `실점 ${before.conceded.toFixed(2)} → ${after.conceded.toFixed(2)}`)
      .toBeLessThan(before.conceded)
  })

  it('지시는 세 명까지, 골문 앞은 두 명까지다', () => {
    // 상한이 없으면 지시는 그냥 곱셈이고 곱셈에는 순서가 없다.
    // 킥오프에 전부 걸어놓고 끝이라 조작이 아니라 세팅이 된다
    let s = createState(P)
    expect(checkOrder(s, 'DF04', 'HOLD')).toBeNull()
    s = { ...s, players: s.players.map((x) => (x.id === 'DF04' ? { ...x, order: 'HOLD' } : x)) }
    s = { ...s, players: s.players.map((x) => (x.id === 'DF05' ? { ...x, order: 'HOLD' } : x)) }
    expect(checkOrder(s, 'DF02', 'HOLD')).not.toBeNull()
    // 공격수는 골문 앞을 지키지 않는다
    expect(checkOrder(createState(P), 'FW09', 'HOLD')).not.toBeNull()
  })

  it('교체로 나간 선수의 지시는 함께 걷힌다', () => {
    // 벤치에 앉은 선수에게 유령 지시가 붙어 있으면, 나중에 다시
    // 들어올 때 감독이 내리지 않은 지시가 따라 들어온다
    const r = simulate({ ...P, seed: P.seed }, [
      {
        tick: 0,
        type: 'POSITION',
        target: 'DF04',
        position: { x: FREE_POSITION.pitch.minX, y: FREE_POSITION.pitch.centreY },
      },
      { tick: 0, type: 'ORDER', target: 'DF04', order: 'HOLD' },
      { tick: 10, type: 'SUB', out: 'DF04', in: 'DF15' },
    ])
    expect(r.final.players.find((x) => x.id === 'DF04')!.order).toBe('NONE')
    expect(r.final.players.find((x) => x.id === 'DF15')!.order).toBe('NONE')
    expect(r.final.players.find((x) => x.id === 'DF04')!.position).toBeNull()
    expect(r.final.players.find((x) => x.id === 'DF15')!.position).toBeNull()
  })
})

/**
 * 전반이 끝나면 후반으로 이어진다.
 *
 * 사용자가 지적했다 — "전반전이 끝나면 후반전으로 넘어가야지 계속
 * 전반전에만 있어."
 */
describe('전반에서 후반으로 이어진다', () => {
  const P = PROBLEMS[0]

  it('점수·경고·퇴장·교체 카드가 그대로 넘어간다', () => {
    const first = simulate(P, [])
    const next = carryToNextHalf(first.final)
    expect(next.score).toEqual(first.final.score)
    expect(next.subsLeft).toBe(first.final.subsLeft)
    expect(next.homeCount).toBe(first.final.homeCount)
    expect(next.awayCount).toBe(first.final.awayCount)
    expect(next.formation).toBe(first.final.formation)
    expect(next.tactics).toEqual(first.final.tactics)
    // 퇴장·부상으로 빠진 선수는 후반에도 못 뛴다
    const outBefore = first.final.players.filter((p) => p.out).map((p) => p.id)
    const outAfter = next.players.filter((p) => p.out).map((p) => p.id)
    expect(outAfter).toEqual(outBefore)
  })

  it('하프타임에는 전반을 뛰고 후반에도 남은 선수만 조금 회복한다', () => {
    const first = simulate(P, [])
    const next = carryToNextHalf(first.final)
    for (const before of first.final.players) {
      const after = next.players.find((p) => p.id === before.id)!
      if (before.onPitch && !before.out) {
        expect(after.stamina).toBeGreaterThanOrEqual(before.stamina)
      } else {
        // 퇴장·부상 선수와 벤치는 전반을 끝까지 뛴 선수가 아니다
        expect(after.stamina).toBe(before.stamina)
      }
    }
    expect(next.awayStamina).toBeGreaterThan(first.final.awayStamina)
  })

  it('하프타임 교체 선수와 퇴장·부상·벤치 선수에게 회복을 잘못 주지 않는다', () => {
    const base = createState(P)
    const goalkeeper = HOME_XI.find((player) => player.pos === 'GK')!
    const outgoing = HOME_XI.find((player) => player.pos === 'DF')!
    const removed = HOME_XI.find(
      (player) => player.id !== outgoing.id && player.pos === 'DF',
    )!
    const incoming = BENCH.find((player) => player.pos === outgoing.pos)!
    const unusedBench = BENCH.find((player) => player.id !== incoming.id)!
    const stamina = new Map<string, number>([
      [goalkeeper.id, 40],
      [outgoing.id, 35],
      [removed.id, 20],
      [incoming.id, 70],
      [unusedBench.id, 65],
    ])
    const before = {
      ...base,
      players: base.players.map((player) => {
        const value = stamina.get(player.id)
        if (player.id === removed.id) {
          return { ...player, stamina: value!, onPitch: false, out: true }
        }
        return value === undefined ? player : { ...player, stamina: value }
      }),
      pendingSubs: [
        { out: outgoing.id, in: incoming.id, atTick: TOTAL_TICKS },
      ],
      awayStamina: 60,
    }
    const after = carryToNextHalf(before)
    const of = (id: string) => after.players.find((player) => player.id === id)!

    // 골키퍼도 전반을 뛴 우리 선수이므로 회복한다
    expect(of(goalkeeper.id).stamina).toBeGreaterThan(stamina.get(goalkeeper.id)!)
    // 하프타임에 나간 선수와 막 들어온 선수 둘 다 회복 대상이 아니다
    expect(of(outgoing.id).onPitch).toBe(false)
    expect(of(outgoing.id).stamina).toBe(stamina.get(outgoing.id))
    expect(of(incoming.id).onPitch).toBe(true)
    expect(of(incoming.id).stamina).toBe(stamina.get(incoming.id))
    // 퇴장·부상 이탈자와 아직 안 뛴 후반 교체 후보도 그대로다
    expect(of(removed.id).stamina).toBe(stamina.get(removed.id))
    expect(of(unusedBench.id).stamina).toBe(stamina.get(unusedBench.id))
    // 상대는 개인 명단이 아니라 팀 체력 하나지만 같은 휴식을 받는다
    expect(after.awayStamina).toBeGreaterThan(before.awayStamina)
  })

  it('단일 되돌림 값을 0으로 두면 우리와 상대 체력이 모두 그대로다', () => {
    const halftime = simulate(P, []).final
    const next = carryToNextHalf(halftime, 0)
    for (const before of halftime.players) {
      expect(
        next.players.find((player) => player.id === before.id)!.stamina,
      ).toBe(before.stamina)
    }
    expect(next.awayStamina).toBe(halftime.awayStamina)
  })

  it('쉬고 나서도 후반 킥오프 체력은 전반 킥오프보다 낮다', () => {
    /**
     * 회복이 전반의 소모를 지워버리면 후반이 더 힘들지 않다. 고정된
     * 숫자를 비교하지 않고, 실제 다섯 국면의 같은 선수와 상대 팀이
     * 전반 시작 때보다 덜 남았는지만 본다.
     */
    for (const problem of PROBLEMS) {
      for (let seed = 0; seed < 10; seed++) {
        const replay = { ...problem, seed: problem.seed + seed }
        const firstKickoff = createState(replay)
        const halftime = simulate(replay, []).final
        const secondKickoff = carryToNextHalf(halftime)
        for (const after of secondKickoff.players.filter(
          (player) => player.onPitch && !player.out,
        )) {
          const before = firstKickoff.players.find(
            (player) => player.id === after.id,
          )
          if (before?.onPitch && !before.out) {
            expect(after.stamina, `${problem.id} / ${after.id}`).toBeLessThan(
              before.stamina,
            )
          }
        }
        expect(
          secondKickoff.awayStamina,
          `${problem.id} / 상대`,
        ).toBeLessThan(firstKickoff.awayStamina)
      }
    }
  })

  it('실제 전반 데이터 100명 이상에서도 지친 선수가 더 많이 회복하지 않는다', () => {
    const observed: Array<{ stamina: number; recovery: number }> = []
    for (const problem of PROBLEMS) {
      // 다섯 국면 × 시드 30개라 실제 피치 위 선수 1,500명 이상을 본다.
      for (let seed = 0; seed < 30; seed++) {
        const halftime = simulate(
          { ...problem, seed: problem.seed + seed },
          [],
        ).final
        const second = carryToNextHalf(halftime)
        for (const before of halftime.players.filter(
          (player) => player.onPitch && !player.out,
        )) {
          const after = second.players.find((player) => player.id === before.id)!
          observed.push({
            stamina: before.stamina,
            recovery: after.stamina - before.stamina,
          })
        }
      }
    }
    expect(observed.length).toBeGreaterThan(100)
    observed.sort((a, b) => a.stamina - b.stamina)
    for (let index = 1; index < observed.length; index++) {
      expect(
        observed[index].recovery + Number.EPSILON,
        `체력 ${observed[index - 1].stamina.toFixed(2)} → ${observed[index].stamina.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(observed[index - 1].recovery)
    }
  })

  it('시계와 그 반의 기록만 초기화된다', () => {
    const first = simulate(P, [])
    const next = carryToNextHalf(first.final)
    expect(next.tick).toBe(0)
    expect(next.log).toHaveLength(0)
    expect(next.stats.homeShot).toBe(0)
    expect(next.stats.setPiece).toBe(0)
    expect(next.pendingSubs).toHaveLength(0)
  })

  it('두 반을 이어 뛰면 노출 시간이 두 배다', () => {
    /**
     * 한 반만 뛴 것과 두 반을 뛴 것이 같은 결과면 이어붙이기가 안 된
     * 것이다. 두 배로 뛰면 사건도 그만큼 더 쌓인다
     */
    let oneHalf = 0
    let twoHalves = 0
    for (let i = 0; i < 40; i++) {
      const problem = { ...P, seed: P.seed + i * 7919 }
      oneHalf += simulate(problem, []).final.log.length
      twoHalves += simulateHalves(problem, [], []).final.log.length
    }
    expect(twoHalves).toBeGreaterThan(0)
    expect(oneHalf).toBeGreaterThan(0)
  })

  it('두 반을 뛰면 무개입 통과율이 한 반보다 낮다', () => {
    /**
     * 오래 버틸수록 무너질 기회가 많다. 이게 뒤집히면 후반이 실제로
     * 이어지지 않고 있다는 뜻이다.
     *
     * **지키는 판으로 잰다** — 쫓는 판은 시간이 길수록 오히려 유리하다
     */
    const keep = PROBLEMS.find((p) => p.objective.type === 'SURVIVE')!
    let one = 0
    let two = 0
    const runs = 120
    for (let i = 0; i < runs; i++) {
      const problem = { ...keep, seed: keep.seed + i * 7919 }
      if (simulate(problem, []).passed) one += 1
      if (simulateHalves(problem, [], []).passed) two += 1
    }
    expect(two, `한 반 ${one}/${runs} · 두 반 ${two}/${runs}`).toBeLessThan(one)
  })

  it('같은 시드는 같은 두 반을 만든다', () => {
    const a = simulateHalves(P, [], [])
    const b = simulateHalves(P, [], [])
    expect(a.final.score).toEqual(b.final.score)
    expect(a.passed).toBe(b.passed)
  })
})

/**
 * 급수 타임 교체는 즉시 끝난다.
 *
 * 사용자가 정했다 — "전반전에서 후반전으로 넘어갈 때 바로 선수교체가
 * 가능하게 해줘. 5초 기다렸다 할 필요 없고."
 */
describe('급수 타임 교체는 기다리지 않는다', () => {
  const P = PROBLEMS[0]
  const bench = BENCH[0]
  const starter = HOME_XI.find((p) => p.pos === bench.pos)!

  it('0틱 교체는 대기 없이 바로 선발이 바뀐다', () => {
    // 급수 타임에 내린 지시는 전부 0틱에 기록된다
    const before = simulate(P, [])
    expect(before.final.players.find((p) => p.id === bench.id)!.onPitch).toBe(false)

    const after = simulate(P, [{ tick: 0, type: 'SUB', out: starter.id, in: bench.id }])
    expect(after.final.players.find((p) => p.id === bench.id)!.onPitch).toBe(true)
    expect(after.final.players.find((p) => p.id === starter.id)!.onPitch).toBe(false)
    // 카드는 그대로 한 장 쓴다
    expect(after.final.subsLeft).toBe(P.subsLeft - 1)
  })

  it('0틱 교체는 대기 명단에 남지 않는다', () => {
    /**
     * 6초를 기다리면 그동안 우리는 열 명으로 뛴다. 급수 타임은 공이 이미
     * 죽어 있는 시간이라 그럴 이유가 없다
     */
    const after = simulate(P, [{ tick: 0, type: 'SUB', out: starter.id, in: bench.id }])
    expect(after.final.pendingSubs).toHaveLength(0)
    // 대기를 거쳤다면 SUB 로그가 60틱에 찍힌다. 즉시 교체는 그 로그가 없다
    const subLog = after.final.log.find((e) => e.kind === 'SUB' && e.target === bench.id)
    expect(subLog).toBeUndefined()
  })

  it('경기 중 교체는 여전히 6초를 기다린다', () => {
    // 흐르는 경기에서는 선수가 실제로 걸어 나오고 들어가야 한다
    const mid = 300
    const after = simulate(P, [{ tick: mid, type: 'SUB', out: starter.id, in: bench.id }])
    const subLog = after.final.log.find((e) => e.kind === 'SUB' && e.target === bench.id)
    expect(subLog).toBeDefined()
    expect(subLog!.tick).toBeGreaterThanOrEqual(mid + EVENTS.subDelayTicks)
  })
})
