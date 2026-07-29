import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createState } from '../sim/engine'
import { FORMATION_IDS } from '../sim/formations'
import { PROBLEMS } from '../sim/problems'
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
        onFormation={() => undefined}
      />,
    )
    expect(html).toContain('수비 3 중원 4 공격 2')
    expect(html).toContain('11번 FW')
  })

  it('잠긴 뒤에는 포메이션 아홉 개를 모두 누를 수 없다', () => {
    const html = renderToStaticMarkup(
      <SquadPanel
        state={stateOf('p02')}
        locked
        onOrder={() => null}
        onFormation={() => undefined}
      />,
    )
    expect((html.match(/formation-choice/g) ?? []).length).toBe(FORMATION_IDS.length)
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(
      FORMATION_IDS.length,
    )
  })
})

describe('상대 배치판', () => {
  it('전부 올라오는 상대를 뒤로 물러난다고 설명하지 않는다', () => {
    const state = { ...stateOf('p01'), opponent: 'ALL_OUT' as const }
    const text = awaySummary(state)
    expect(text).toContain('전부 올라와')
    expect(text).not.toContain('뒤로 물러나')
    expect(renderToStaticMarkup(<AwayPanel state={state} />)).toContain(text)
  })

  it('열 명이면 실제 4-4-1 형태를 말한다', () => {
    const state = stateOf('p05')
    expect(state.awayCount).toBe(10)
    expect(awaySummary(state)).toContain('수비 4 · 중원 4 · 공격 1')
  })
})
