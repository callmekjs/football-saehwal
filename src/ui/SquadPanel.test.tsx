import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { FORMATION_IDS } from '../sim/formations'
import { PROBLEMS } from '../sim/problems'
import { AWAY_SHAPE_BY_MOOD, awaySlots } from '../sim/awayShape'
import { positionFactors } from '../sim/tactics'
import { getPlayer } from '../sim/squad'
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

describe('배치가 확률에 주는 효과를 화면이 말한다', () => {
  /**
   * 사용자가 물었다 — *"포지션을 바꾸면 이게 실제로 어떤 영향을 준다
   * (예, 골 넣을 확률이 22% 올라갔다) 이런게 실제로 나오나?"*
   *
   * 나오지 않았다. 계산에는 들어가는데(`applyPositions` 가 상대 배후
   * 침투·오픈플레이와 우리 공격 폭에 곱한다) 화면에는 「7번 — 중원 ·
   * 오른쪽」이라는 **자리 이름**만 떴다. 효과가 있는데 감독이 그걸 알
   * 방법이 없었다.
   */
  const placed = (spots: Array<{ id: string; x: number; y: number }>) => {
    const base = stateOf('p02')
    return {
      ...base,
      players: base.players.map((p) => {
        const at = spots.find((s) => s.id === p.id)
        return at ? { ...p, position: { x: at.x, y: at.y } } : p
      }),
    }
  }

  const render = (state: ReturnType<typeof stateOf>) =>
    renderToStaticMarkup(
      <SquadPanel
        state={state}
        locked={false}
        onOrder={() => null}
        onPosition={() => null}
        onFormation={() => undefined}
      />,
    )

  it('아무도 안 옮겼으면 효과 줄을 만들지 않는다', () => {
    // 배치가 0명이면 계수가 정확히 항등이다. 「+0.0%」를 띄우면 무언가
    // 걸려 있는 것처럼 읽힌다
    expect(render(stateOf('p02'))).not.toContain('지금 배치')
  })

  it('화면에 뜨는 숫자가 엔진이 쓰는 값과 같다', () => {
    /**
     * ★ **화면이 자기 계산을 따로 가지면 안 된다.** 언젠가 한쪽만
     * 바뀌어 「+7.8%」라고 써 놓고 실제로는 다르게 계산되는 화면이 된다.
     * 그래서 엔진과 같은 `positionFactors` 를 부르는지 값으로 확인한다.
     */
    const onPitch = stateOf('p02').players.filter((p) => p.onPitch && !p.out)
    const forward = onPitch.filter((p) => getPlayer(p.id).pos === 'FW').slice(0, 2)
    expect(forward.length, '공격수 표본').toBe(2)

    const state = placed(forward.map((p, i) => ({ id: p.id, x: 95, y: i === 0 ? 4 : 64 })))
    const factors = positionFactors(state.players)
    expect(factors, '배치 계수').not.toBeNull()

    const pct = `${((factors!.attack - 1) * 100).toFixed(1)}%`
    const html = render(state)
    expect(html).toContain('지금 배치')
    expect(html, `엔진 값 ${pct} 가 화면에 있어야 한다`).toContain(pct)
  })

  it('앞으로 벌리면 공격과 위험이 **함께** 오른다', () => {
    // 이 게임의 핵심 거래다. 하나만 움직이면 전진이 공짜가 된다
    const onPitch = stateOf('p02').players.filter((p) => p.onPitch && !p.out)
    const fw = onPitch.find((p) => getPlayer(p.id).pos === 'FW')!

    const up = positionFactors(placed([{ id: fw.id, x: 95, y: 4 }]).players)!
    const back = positionFactors(placed([{ id: fw.id, x: 15, y: 34 }]).players)!

    expect(up.attack).toBeGreaterThan(1)
    expect(up.risk).toBeGreaterThan(1)
    expect(back.attack).toBeLessThan(1)
    expect(back.risk).toBeLessThan(1)
    // 공짜가 없다 — 공격 이득과 수비 위험이 같은 크기로 움직인다
    expect(up.attack).toBeCloseTo(up.risk, 10)
    expect(back.attack).toBeCloseTo(back.risk, 10)

    // 화면도 둘 다 말한다. 하나만 보여주면 거래가 사라진다
    const html = render(placed([{ id: fw.id, x: 95, y: 4 }]))
    expect(html).toContain('우리 공격')
    expect(html).toContain('상대 역습 위험')
  })
})
