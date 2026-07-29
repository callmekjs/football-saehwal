import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { EVENTS } from '../sim/constants'
import { AWAY_XI, BENCH, HOME_SQUAD, getPlayer, minDefenderSpeed } from '../sim/squad'
import type { MatchState, Problem } from '../sim/types'
import { PROBLEMS } from '../sim/problems'
import { CAPTAIN_EFFECT_IDS } from '../sim/setup'
import { CORE_BRIEFING_LINES, buildBriefing, captainOf } from './briefing'

const byId = (id: string): Problem => PROBLEMS.find((p) => p.id === id)!

const stateOf = (id: string): MatchState => createState(byId(id))

const idsOf = (state: MatchState, problem: Problem): string[] => {
  const b = buildBriefing(problem, state)
  return [...b.core, ...b.more].map((l) => l.id)
}

const textOf = (state: MatchState, problem: Problem, id: string): string | null => {
  const b = buildBriefing(problem, state)
  return [...b.core, ...b.more].find((l) => l.id === id)?.text ?? null
}

/** 피치 위 선수 한 명을 골라 상태를 바꾼다 */
function withPlayer(state: MatchState, id: string, patch: Partial<MatchState['players'][0]>) {
  return {
    ...state,
    players: state.players.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }
}

describe('주장 브리핑', () => {
  it('국면마다 다른 말이 나온다', () => {
    const sets = PROBLEMS.map((p) => idsOf(createState(p), p).join('|'))
    expect(new Set(sets).size).toBe(PROBLEMS.length)
  })

  it('핵심 줄은 정해진 개수만 세우고 나머지는 접는다', () => {
    for (const p of PROBLEMS) {
      const b = buildBriefing(p, createState(p))
      expect(b.core).toHaveLength(CORE_BRIEFING_LINES)
      // 접는 것이 없으면 굳이 접을 이유가 없다. 국면마다 할 말이 남아야 한다
      expect(b.more.length).toBeGreaterThan(0)
    }
  })

  it('첫 줄은 언제나 점수와 목표다', () => {
    for (const p of PROBLEMS) {
      const b = buildBriefing(p, createState(p))
      expect(b.core[0].id).toBe('score')
      expect(b.core[0].text).toContain(`${p.score[0]} 대 ${p.score[1]}`)
    }
  })

  it('주장 컨디션 보고는 항상 보이고 여섯 종류가 서로 다르다', () => {
    const problem = byId('p02')
    const state = stateOf('p02')
    const reports = CAPTAIN_EFFECT_IDS.map((captainEffect) => {
      const changed = { ...state, captainEffect }
      expect(buildBriefing(problem, changed).core.map((line) => line.id))
        .toContain('captain-effect')
      return textOf(changed, problem, 'captain-effect')
    })
    expect(reports.every(Boolean)).toBe(true)
    expect(new Set(reports).size).toBe(CAPTAIN_EFFECT_IDS.length)
  })

  it('말하는 사람은 피치 위 필드 플레이어의 등번호다', () => {
    for (const p of PROBLEMS) {
      const state = createState(p)
      const onPitch = state.players.filter((s) => s.onPitch && !s.out)
      const nums = onPitch.map((s) => getPlayer(s.id).num)
      expect(nums).toContain(captainOf(onPitch))
      expect(getPlayer(onPitch.find((s) => getPlayer(s.id).num === captainOf(onPitch))!.id).pos)
        .not.toBe('GK')
    }
  })

  it('빠진 선수가 있는 국면에서만 인원 이야기를 한다', () => {
    const short = byId('p04')
    const full = byId('p02')
    expect(idsOf(stateOf('p04'), short)).toContain('ten-men')
    expect(idsOf(stateOf('p02'), full)).not.toContain('ten-men')
    expect(textOf(stateOf('p04'), short, 'ten-men')).toContain('10명')
  })

  it('경고 보유자가 없으면 경고·퇴장 이야기를 아예 하지 않는다', () => {
    /**
     * 경고 보유자는 이제 **판마다 다르다**(시작 조건을 시드에서 뽑는다).
     * 그래서 국면 데이터의 `booked` 가 비었다는 것으로는 아무것도 알 수
     * 없고, 지금 이 경기 상태에 경고 보유자가 있는지를 봐야 한다.
     */
    const p = byId('p01')
    const clean = {
      ...stateOf('p01'),
      players: stateOf('p01').players.map((s) => ({ ...s, booked: false })),
    }
    expect(clean.players.every((s) => !s.booked)).toBe(true)
    const ids = idsOf(clean, p)
    expect(ids).not.toContain('booked')
    expect(ids).not.toContain('send-off-risk')
  })

  it('강 압박에서만 퇴장 위험을 말하고, 그 아래에서는 꺼져 있다고 말한다', () => {
    const p = byId('p02')
    const base = stateOf('p02')
    // 경고 보유자는 판마다 다르다. 이 테스트가 보는 것은 "경고가 있을 때
    // 압박에 따라 말이 달라지는가"이므로 한 명을 확실히 세워둔다
    const calm = {
      ...withPlayer(base, 'MF06', { booked: true }),
      tactics: { ...base.tactics, press: 0 as const },
    }
    expect(idsOf(calm, p)).toContain('booked')
    expect(idsOf(calm, p)).not.toContain('send-off-risk')

    const hard = { ...calm, tactics: { ...calm.tactics, press: 2 as const } }
    expect(idsOf(hard, p)).toContain('send-off-risk')
    expect(idsOf(hard, p)).not.toContain('booked')
  })

  it('체력이 다 멀쩡하면 부상 이야기를 하지 않는다', () => {
    // 체력도 판마다 흔들린다. 전원을 확실히 채워놓고 본다
    const p = byId('p01')
    const fresh = {
      ...stateOf('p01'),
      players: stateOf('p01').players.map((s) => ({ ...s, stamina: 90 })),
    }
    const ids = idsOf(fresh, p)
    expect(ids).not.toContain('stamina')
    expect(ids).not.toContain('injury-now')
  })

  it('부상 임계 아래로 내려간 선수는 따로 급하게 짚는다', () => {
    const p = byId('p02')
    const hurt = withPlayer(stateOf('p02'), 'MF06', { stamina: EVENTS.injuryThreshold - 5 })
    const text = textOf(hurt, p, 'injury-now')
    expect(text).toContain('6번')
    expect(text).toContain(String(EVENTS.injuryThreshold))
  })

  it('가장 위협적인 상대는 명단에서 실제로 제일 빠른 공격 자원이다', () => {
    const p = byId('p02')
    const state = stateOf('p02')
    const fastest = AWAY_XI.filter((a) => a.pos === 'FW' || a.pos === 'MF').reduce((best, a) =>
      a.speed > best.speed ? a : best,
    )
    const text = textOf(state, p, 'top-threat')!
    expect(text).toContain(`${fastest.num}번`)
    expect(text).toContain(String(fastest.speed))
    // 우리 쪽 대조군도 실제 계산값이어야 한다
    expect(text).toContain(String(minDefenderSpeed(state.players)))
  })

  it('상대가 열 명이면 배치판에서 빠진 11번을 위협 후보에서도 뺀다', () => {
    const p = byId('p05')
    const state = stateOf('p05')
    const text = textOf(state, p, 'top-threat')!
    expect(state.awayCount).toBe(10)
    expect(text).not.toContain('11번')
    expect(text).toContain('7번')
  })

  it('상대가 열한 명이면 가장 빠른 11번 설명을 유지한다', () => {
    const p = byId('p02')
    expect(textOf(stateOf('p02'), p, 'top-threat')).toContain('11번')
  })

  it('뒷선이 바뀌면 대조하는 숫자도 함께 바뀐다', () => {
    const p = byId('p02')
    const before = stateOf('p02')
    const slowest = before.players
      .filter((s) => s.onPitch && !s.out && getPlayer(s.id).pos === 'DF')
      .reduce((worst, s) => (getPlayer(s.id).speed < getPlayer(worst.id).speed ? s : worst))
    const after = withPlayer(before, slowest.id, { onPitch: false })

    const a = textOf(before, p, 'top-threat')!
    const b = textOf(after, p, 'top-threat')!
    expect(a).not.toBe(b)
    expect(b).toContain(String(minDefenderSpeed(after.players)))
  })

  it('벤치 이야기는 실제 벤치 자원과 남은 교체 카드에 묶여 있다', () => {
    const p = byId('p02')
    const state = stateOf('p02')
    const benchNums = BENCH.map((b) => b.num)

    for (const id of ['bench-back', 'bench-finisher', 'bench-fast']) {
      const text = textOf(state, p, id)
      expect(text, id).not.toBeNull()
      expect(benchNums.some((n) => text!.includes(`${n}번`)), id).toBe(true)
    }

    const spent = { ...state, subsLeft: 0 }
    const ids = idsOf(spent, p)
    expect(ids).not.toContain('bench-back')
    expect(ids).not.toContain('bench-finisher')
    expect(ids).not.toContain('bench-fast')
    expect(textOf(spent, p, 'subs')).toContain('다 썼습니다')
  })

  it('쫓는 판과 지키는 판은 벤치 자원을 말하는 순서가 다르다', () => {
    const chase = buildBriefing(byId('p01'), stateOf('p01'))
    const hold = buildBriefing(byId('p02'), stateOf('p02'))
    const order = (b: typeof chase) => {
      const ids = [...b.core, ...b.more].map((l) => l.id)
      return ids.indexOf('bench-finisher') < ids.indexOf('bench-back')
    }
    expect(order(chase)).toBe(true)
    expect(order(hold)).toBe(false)
  })

  it('앞 감독이 남긴 설정이 이름 붙은 전술인지 그대로 말한다', () => {
    for (const p of PROBLEMS) {
      const text = textOf(createState(p), p, 'inherited')!
      // 세 국면 모두 전제가 "정상 전술이 아니다" 이다
      expect(text).toContain('어디에도 맞지 않습니다')
    }
    const p = byId('p02')
    const balanced = {
      ...stateOf('p02'),
      tactics: { line: 1 as const, press: 1 as const, width: 1 as const },
    }
    expect(textOf(balanced, p, 'inherited')).toContain('균형')
  })

  it('무엇을 하라고 지시하지 않는다', () => {
    const 명령 = ['하세요', '넣으세요', '빼세요', '바꾸세요', '올리세요', '내리세요', '하십시오']
    for (const p of PROBLEMS) {
      const b = buildBriefing(p, createState(p))
      for (const line of [...b.core, ...b.more]) {
        for (const word of 명령) expect(line.text, line.id).not.toContain(word)
      }
    }
  })

  it('선수를 이름이 아니라 등번호로만 부른다', () => {
    // 명단에 이름 칸 자체가 없다는 사실을 브리핑에서도 다시 확인한다
    for (const p of HOME_SQUAD) expect(p).not.toHaveProperty('name')
    for (const problem of PROBLEMS) {
      const b = buildBriefing(problem, createState(problem))
      const said = [...b.core, ...b.more].map((l) => l.text).join(' ')
      // 등번호를 부를 때는 반드시 "N번" 형태다
      for (const match of said.matchAll(/(\d+)번/g)) {
        expect(Number(match[1])).toBeGreaterThan(0)
      }
      expect(b.speaker).toBeGreaterThan(0)
    }
  })

  it('같은 상태에는 언제나 같은 문장이 나온다', () => {
    for (const p of PROBLEMS) {
      const a = buildBriefing(p, createState(p))
      const b = buildBriefing(p, createState(p))
      expect(a).toEqual(b)
    }
  })
})
