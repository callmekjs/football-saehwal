import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { FORMATION_IDS } from '../sim/formations'
import { PROBLEMS } from '../sim/problems'
import { AWAY_SHAPE_BY_MOOD, awaySlots } from '../sim/awayShape'
import { homeCaptainNumber, awayCaptainNumber } from '../captain'
import { AwayPanel, SquadPanel, awaySummary } from './SquadPanel'

const stateOf = (id: string) =>
  createState(PROBLEMS.find((problem) => problem.id === id)!)

describe('우리 팀 배치판', () => {
  it('수비수 한 명이 없는 4-4-2를 수비 3 · 중원 4 · 공격 2로 설명한다', () => {
    const html = renderToStaticMarkup(
      <SquadPanel
        state={stateOf('p04')}
        locked={false}
        onOrder={() => null}
        onPosition={() => null}
        onFormation={() => undefined}
      />,
    )
    expect(html).toContain('수비 3명')
    expect(html).toContain('중원 4명')
    expect(html).toContain('공격 2명')
    expect(html).toContain('11번 FW')
  })

  it('5-4-1 수비 자리에 배정된 선수를 등록 포지션이 아닌 현재 역할로 표시한다', () => {
    const html = renderToStaticMarkup(
      <SquadPanel
        state={stateOf('p01')}
        locked={false}
        onOrder={() => null}
        onPosition={() => null}
        onFormation={() => undefined}
      />,
    )

    expect(html).toContain('11번 DF')
    expect(html).not.toContain('11번 FW')
  })

  it('잠긴 뒤에는 포메이션 아홉 개를 모두 누를 수 없다', () => {
    const html = renderToStaticMarkup(
      <SquadPanel
        state={stateOf('p02')}
        locked
        onOrder={() => null}
        onPosition={() => null}
        onFormation={() => undefined}
      />,
    )
    expect((html.match(/formation-choice/g) ?? []).length).toBe(FORMATION_IDS.length)
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(
      FORMATION_IDS.length,
    )
  })

  it('자유 배치 캡션과 골키퍼 이동 불가를 한국어로 보여준다', () => {
    const html = renderToStaticMarkup(
      <SquadPanel
        state={stateOf('p02')}
        locked={false}
        onOrder={() => null}
        onPosition={() => null}
        onFormation={() => undefined}
      />,
    )
    expect(html).toContain('원하는 곳에 놓기')
    expect(html).toContain('골키퍼는 자리를 옮길 수 없습니다')
    expect(html).not.toContain('위아래로 끌어')
  })

  it('우리 주장 카드에 C와 한국어 접근성 이름을 함께 붙인다', () => {
    const html = renderToStaticMarkup(
      <SquadPanel
        state={stateOf('p02')}
        locked={false}
        onOrder={() => null}
        onPosition={() => null}
        onFormation={() => undefined}
      />,
    )
    expect(html).toContain('class="captain-marker"')
    // 주장은 리더십으로 정해져 판마다 다르다. 등번호를 박지 않고
    // 완장을 찬 선수가 실제로 화면에 주장으로 적히는지만 본다
    const captain = homeCaptainNumber(stateOf('p02').players)
    expect(html).toContain(`aria-label="${captain}번 주장,`)
  })
})

describe('상대 배치판', () => {
  it('상대 주장 카드에도 C와 한국어 접근성 이름을 함께 붙인다', () => {
    const state = stateOf('p02')
    const html = renderToStaticMarkup(<AwayPanel state={state} />)
    expect(html).toContain('class="captain-marker"')
    // 상대 주장도 팀마다 다르다. 등번호를 박지 않는다
    const captain = awayCaptainNumber(
      state.away.formation,
      state.awayCount,
      state.opponentTeam,
    )
    expect(html).toContain(`aria-label="${captain}번 주장,`)
  })

  it('전부 올라오는 상대를 뒤로 물러난다고 설명하지 않는다', () => {
    const state = { ...stateOf('p01'), opponent: 'ALL_OUT' as const }
    const text = awaySummary(state)
    expect(text).toContain('전부 올라와')
    expect(text).not.toContain('뒤로 물러나')
    expect(text).toMatch(/수비 \d+명·중원 \d+명·공격 \d+명입니다/)
    expect(renderToStaticMarkup(<AwayPanel state={state} />)).toContain(text)
  })

  it('열 명이어도 최전방을 통째로 지우지 않는다', () => {
    /**
     * 상대 대형은 판마다 다르므로 특정 숫자를 박지 않는다. 지켜야 하는
     * 것은 **줄 하나가 통째로 사라지지 않는다**는 것이다. 앞에서부터
     * 기계적으로 자르면 5-4-1 에서 유일한 공격수가 없어진다.
     */
    const state = stateOf('p05')
    expect(state.awayCount).toBe(10)
    const shown = awaySlots(state.away.formation, state.awayCount)
    expect(shown.length).toBe(10)
    for (const pos of ['GK', 'DF', 'MF', 'FW'] as const) {
      expect(shown.filter(([p]) => p === pos).length, `${pos} 수`).toBeGreaterThan(0)
    }
    expect(awaySummary(state)).toContain(state.away.formation)
  })

  it('상대 대형은 성향에 어울리는 것만 나온다', () => {
    // 버스를 세운 팀이 4-3-3 으로 서 있으면 화면이 브리핑과 다른 말을 한다
    for (const id of ['p01', 'p02', 'p03', 'p04', 'p05'] as const) {
      const state = stateOf(id)
      expect(
        AWAY_SHAPE_BY_MOOD[state.opponent] as readonly string[],
        `${id} · ${state.opponent}`,
      ).toContain(state.away.formation)
    }
  })

  it('같은 국면이라도 시드가 다르면 다른 상대를 만난다', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const s = createState({ ...PROBLEMS[1], seed: 1000 + i * 37 })
      seen.add(`${s.away.formation}|${s.away.booked.join('.')}|${s.away.injured}|${s.away.stamina}`)
    }
    expect(seen.size, '마흔 시드에서 서로 다른 상대').toBeGreaterThan(20)
  })
})
