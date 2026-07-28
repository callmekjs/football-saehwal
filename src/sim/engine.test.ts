import { describe, it, expect } from 'vitest'
import { simulate, createState, tick, checkOrder } from './engine'
import { createRng } from './rng'
import { TOTAL_TICKS } from './constants'
import { HOME_XI, BENCH } from './squad'
import type { Decision, Problem } from './types'

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
      { tick: 0, type: 'ORDER', target: 'DF04', order: 'HOLD' },
      { tick: 10, type: 'SUB', out: 'DF04', in: 'DF15' },
    ])
    expect(r.final.players.find((x) => x.id === 'DF04')!.order).toBe('NONE')
    expect(r.final.players.find((x) => x.id === 'DF15')!.order).toBe('NONE')
  })
})
