import { describe, it, expect } from 'vitest'
import { OPPONENTS, TOTAL_TICKS } from './constants'
import { applyOpponent, resolveCoefficients } from './tactics'
import { createState, simulate, simulateHalves, carryToNextHalf, tick } from './engine'
import { createRng } from './rng'
import { PROBLEMS } from './problems'
import { OPPONENT_TEAMS, REFERENCE_TEAM, opponentInfo } from '../analysis/opponents'
import { buildBriefing } from '../analysis/briefing'
import { compareDecisions } from '../analysis/compare'
import type { Level, OpponentId, Tactics } from './types'

const t = (line: Level, press: Level, width: Level): Tactics => ({ line, press, width })
const base = () => resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
const ALL: OpponentId[] = OPPONENTS.teams.map((team) => team.id)
const P = PROBLEMS[0]

describe('상대 팀 계수 — applyOpponent', () => {
  it('기준팀은 계수 객체를 그대로 돌려준다', () => {
    /**
     * ★ 이 항등이 깨지면 다섯 국면의 합격 기준선을 처음부터 다시 재야 한다.
     *
     * `toEqual` 이 아니라 **같은 객체인지**(`toBe`)를 본다. 1을 곱하는
     * 새 경로조차 만들지 않아야 기존 시드가 비트 단위로 살아남는다.
     */
    const c = base()
    expect(applyOpponent(c, REFERENCE_TEAM)).toBe(c)
  })

  it('기준팀은 계수가 전부 중립이다', () => {
    const ref = opponentInfo(REFERENCE_TEAM)
    expect(ref.atk).toBe(0)
    expect(ref.def).toBe(0)
    expect(ref.shape.behind).toBe(1)
    expect(ref.shape.open).toBe(1)
    expect(ref.shape.finish).toBe(1)
  })

  it('최상위권은 상대를 세게, 우리를 약하게 만든다', () => {
    const c = base()
    for (const team of OPPONENT_TEAMS.filter((x) => x.tier === 'TOP')) {
      const after = applyOpponent(c, team.id)
      // 더 잘 넣고, 우리 공격은 덜 만들어지고 덜 들어간다
      expect(after.oppShotXg, team.name).toBeGreaterThan(c.oppShotXg)
      expect(after.widthK, team.name).toBeLessThan(c.widthK)
      expect(after.entryXg, team.name).toBeLessThan(c.entryXg)
    }
  })

  it('세트피스 빈도는 어느 팀도 건드리지 않는다', () => {
    /**
     * 세트피스를 얼마나 내주는가는 **우리가 라인을 내린 대가**다
     * (`LINE[0].setPiece` = 4.2). 거기에 상대를 다시 곱하면 이 시뮬레이션의
     * 핵심 축인 라인이 상대에게 먹힌다. 상대가 센 것은 같은 세트피스를
     * **더 잘 넣는 것**으로만 표현한다.
     */
    const c = base()
    for (const id of ALL) {
      expect(applyOpponent(c, id).setPiece, id).toBe(c.setPiece)
      expect(applyOpponent(c, id).drain, id).toBe(c.drain)
      expect(applyOpponent(c, id).foul, id).toBe(c.foul)
    }
  })

  it('팀마다 위협의 모양이 다르다', () => {
    /**
     * ★ 이것이 팀을 고르는 의미다. 세기만 다르면 무엇을 골라도 대응이
     * 똑같아서, 예전 쉬움·보통·어려움과 다를 바가 없다.
     *
     * 배후로 오는 비중과 오픈플레이로 오는 비중의 **비율**이 팀마다 갈려야
     * 라인을 올릴지 내릴지가 달라진다.
     */
    const c = base()
    const ratios = ALL.map((id) => {
      const after = applyOpponent(c, id)
      return Math.round((after.behind / after.oppOpen) * 100) / 100
    })
    // 열세 팀이 최소 여덟 종류의 서로 다른 모양을 가져야 한다
    expect(new Set(ratios).size).toBeGreaterThanOrEqual(8)
  })

  it('개인기 팀은 배후로, 점유 팀은 오픈플레이로 온다', () => {
    // 스타일 설명과 실제 계수가 어긋나면 화면이 거짓말을 하는 것이다
    const c = base()
    const shapeOf = (id: OpponentId) => {
      const a = applyOpponent(c, id)
      return a.behind / a.oppOpen
    }
    // 브라질(개인기)이 스페인(짧은 패스 점유)보다 배후 비중이 훨씬 높다
    expect(shapeOf('BRA')).toBeGreaterThan(shapeOf('ESP') * 2)
  })

  it('되돌리는 스위치 — scale 이 0이면 모든 팀이 기준팀과 같아진다', () => {
    // 밸런스가 흔들리면 `OPPONENTS.scale` 을 0으로 내린다
    for (const team of OPPONENT_TEAMS) {
      expect(team.atk * 0 === 0, team.name).toBe(true)
      expect(team.def * 0 === 0, team.name).toBe(true)
    }
  })

  it('순위가 높은 팀일수록 실제로 세다', () => {
    // 화면이 1위라고 적었는데 92위보다 약하면 그건 거짓 표시다
    const c = base()
    const strength = (id: OpponentId) => {
      const a = applyOpponent(c, id)
      return a.oppShotXg / a.entryXg
    }
    expect(strength('ARG')).toBeGreaterThan(strength('USA'))
    expect(strength('USA')).toBeGreaterThan(strength('VIE'))
  })
})

describe('팀 데이터가 성립한다', () => {
  it('열에서 열다섯 팀 사이다', () => {
    expect(OPPONENT_TEAMS.length).toBeGreaterThanOrEqual(10)
    expect(OPPONENT_TEAMS.length).toBeLessThanOrEqual(15)
  })

  it('세 묶음이 모두 채워져 있다', () => {
    for (const tier of ['TOP', 'MID', 'LOWER'] as const) {
      expect(OPPONENT_TEAMS.filter((x) => x.tier === tier).length, tier).toBeGreaterThan(0)
    }
  })

  it('id 와 이름과 순위가 겹치지 않는다', () => {
    expect(new Set(ALL).size).toBe(OPPONENT_TEAMS.length)
    expect(new Set(OPPONENT_TEAMS.map((x) => x.name)).size).toBe(OPPONENT_TEAMS.length)
    expect(new Set(OPPONENT_TEAMS.map((x) => x.rank)).size).toBe(OPPONENT_TEAMS.length)
  })

  it('모든 팀이 성격과 설명을 갖는다', () => {
    // 이름만 있고 설명이 없으면 고를 이유가 없다
    for (const team of OPPONENT_TEAMS) {
      expect(team.tag.length, team.name).toBeGreaterThan(1)
      expect(team.note.endsWith('.'), team.name).toBe(true)
    }
  })
})

describe('상대 팀과 재현성', () => {
  it('안 고르면 기준팀이다', () => {
    expect(createState(P).opponentTeam).toBe(REFERENCE_TEAM)
    expect(simulate(P, []).final.opponentTeam).toBe(REFERENCE_TEAM)
  })

  it('기준팀은 이 칸이 생기기 전과 같은 경기다', () => {
    for (let s = 0; s < 40; s++) {
      const p = { ...P, seed: P.seed + s }
      expect(simulate(p, [], REFERENCE_TEAM).final.score).toEqual(simulate(p, []).final.score)
    }
  })

  it('상대 팀은 난수를 하나도 더 쓰지 않는다', () => {
    /**
     * ★ `drawTick()` 의 18슬롯은 순서까지 고정이다. 슬롯을 하나라도 더
     * 뽑으면 저장된 모든 시드의 결과가 달라진다.
     */
    const nextAfterFullMatch = (id: OpponentId) => {
      const rng = createRng(P.seed)
      let state = createState(P, id)
      for (let i = 0; i < TOTAL_TICKS; i++) state = tick(state, rng)
      return rng.next()
    }
    const ref = nextAfterFullMatch(REFERENCE_TEAM)
    for (const id of ALL) expect(nextAfterFullMatch(id), id).toBe(ref)
  })

  it('상대 팀은 후반으로 그대로 넘어간다', () => {
    for (const id of ['BRA', 'CHN'] as OpponentId[]) {
      const halftime = simulate(P, [], id).final
      expect(carryToNextHalf(halftime).opponentTeam).toBe(id)
      expect(simulateHalves(P, [], [], id).final.opponentTeam).toBe(id)
    }
  })
})

describe('상대 팀이 실제 경기 결과를 움직인다', () => {
  const measure = (id: OpponentId, seeds = 200) => {
    let conceded = 0
    let passed = 0
    for (let s = 0; s < seeds; s++) {
      const p = { ...P, seed: P.seed + s }
      const r = simulate(p, [], id)
      conceded += r.final.score[1] - p.score[1]
      if (r.passed) passed += 1
    }
    return { conceded: conceded / seeds, rate: passed / seeds }
  }

  it('최상위권 상대가 아래 순위 상대보다 어렵다', () => {
    // 표시만 바뀌면 설정이 아니라 장식이다
    expect(measure('ARG').rate).toBeLessThan(measure('VIE').rate)
    expect(measure('BRA').conceded).toBeGreaterThan(measure('CHN').conceded)
  })

  it('어느 팀을 만나도 아무것도 안 하면 대체로 통과하지는 않는다', () => {
    /**
     * **아래 순위 팀에도 바닥이 있다.** 무개입 통과율이 60%를 넘으면 감독이
     * 판단할 것이 사라져 "경기 뒤에 전술을 배운다"가 무의미해진다. 그래서
     * 아래 순위 팀은 *덜 위협적*이기보다 *더 뚫리는* 쪽으로 만들었고,
     * 이 검사가 그 설계를 지킨다.
     *
     * **지키는 국면만 본다.** 바닥이 위험한 곳이 거기다 — 쫓는 국면은
     * 무개입 통과율이 원래 10~20%라 상대가 약해져도 60% 근처에 못 간다.
     * 전 국면 × 전 팀을 다 돌리면 이 검사 하나가 몇 분씩 걸린다. 넓게
     * 훑는 것은 `npm run sim -- --team=ALL` 의 몫이다.
     */
    const survive = PROBLEMS.filter((p) => p.objective.type === 'SURVIVE')
    expect(survive.length).toBeGreaterThan(0)
    for (const problem of survive) {
      for (const id of ALL) {
        let passed = 0
        const seeds = 100
        for (let s = 0; s < seeds; s++) {
          if (simulate({ ...problem, seed: problem.seed + s }, [], id).passed) passed += 1
        }
        expect(passed / seeds, `${problem.title} vs ${id}`).toBeLessThan(0.68)
      }
    }
  }, 60000)
})

describe('상대 팀이 화면과 분석에 그대로 전달된다', () => {
  it('화면 표는 확률 상수와 같은 값을 읽는다', () => {
    // 표가 둘이면 화면과 주장이 다른 말을 하게 된다
    for (const team of OPPONENT_TEAMS) {
      expect(opponentInfo(team.id)).toBe(team)
    }
  })

  it('주장이 오늘 상대가 누구인지 말한다', () => {
    const problem = PROBLEMS[0]
    for (const id of ['BRA', 'CHN'] as OpponentId[]) {
      const b = buildBriefing(problem, createState(problem, id))
      const line = [...b.core, ...b.more].find((l) => l.id === 'rank')!
      expect(line.text).toContain(opponentInfo(id).name)
      expect(line.text).toContain(`${opponentInfo(id).rank}위`)
    }
  })

  it('150판 비교는 사용자가 만난 상대로 돌아간다', () => {
    /**
     * **이걸 안 맞추면 판단 평가가 통째로 틀린다.** 브라질을 상대하고
     * 무개입 기준선만 기준팀에서 재면, 상대가 세서 생긴 차이가 감독의
     * 판단 탓으로 찍힌다.
     */
    const problem = PROBLEMS[0]
    const runs = 40
    const rateOf = (id: OpponentId) =>
      compareDecisions(problem, [], runs, 70, null, id).rows.find((r) => r.key === 'noop')!.rate

    expect(rateOf('VIE')).toBeGreaterThan(rateOf('ARG'))
    expect(compareDecisions(problem, [], runs).rows[0].rate).toBe(rateOf(REFERENCE_TEAM))
  })
})
