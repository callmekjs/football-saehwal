import { describe, expect, it, vi } from 'vitest'
import { createState, simulate, simulateHalves } from '../sim/engine'
import { createRng } from '../sim/rng'
import { PROBLEMS } from '../sim/problems'
import type { Decision, Level } from '../sim/types'
import {
  applyRecommendationOnce,
  recommendationDecisions,
} from './recommendation'
import {
  VARIANT_COMPARISON_NOTE,
  variantComparisonTitle,
} from './comparisonCopy'

const problem = PROBLEMS[0]
const recommendation = problem.recommendation!

function capturePlan(half: 1 | 2, applied = new Set<1 | 2>()) {
  const decisions: Decision[] = []
  const didApply = applyRecommendationOnce(half, applied, recommendation, {
    setFormation: (value) => {
      decisions.push({ tick: 0, type: 'FORMATION', value })
    },
    setLever: (type, value) => {
      decisions.push({ tick: 0, type, value })
    },
  })
  return { decisions, didApply, applied }
}

describe('권장안 자동 적용', () => {
  it('화면과 150판 분석이 함께 쓰는 네 개의 0틱 결정만 만든다', () => {
    expect(recommendationDecisions(recommendation)).toEqual([
      { tick: 0, type: 'FORMATION', value: recommendation.formation },
      { tick: 0, type: 'LINE', value: recommendation.tactics.line },
      { tick: 0, type: 'PRESS', value: recommendation.tactics.press },
      { tick: 0, type: 'WIDTH', value: recommendation.tactics.width },
    ])
  })

  it('StrictMode처럼 같은 반에서 두 번 불러도 네 결정을 한 번만 적용한다', () => {
    const applied = new Set<1 | 2>()
    const setFormation = vi.fn()
    const setLever = vi.fn<(type: 'LINE' | 'PRESS' | 'WIDTH', value: Level) => void>()
    const controls = { setFormation, setLever }

    expect(applyRecommendationOnce(2, applied, recommendation, controls)).toBe(true)
    expect(applyRecommendationOnce(2, applied, recommendation, controls)).toBe(false)
    expect(setFormation).toHaveBeenCalledTimes(1)
    expect(setLever).toHaveBeenCalledTimes(3)
  })

  it('전반에서 시작하면 전반과 후반에 각각 네 결정을 적용한다', () => {
    const applied = new Set<1 | 2>()
    const first = capturePlan(1, applied)
    const second = capturePlan(2, applied)

    expect(first.decisions).toHaveLength(4)
    expect(second.decisions).toHaveLength(4)
    expect([...applied]).toEqual([1, 2])
  })

  it('후반에서 시작하면 후반에만 네 결정을 적용한다', () => {
    const { decisions, applied } = capturePlan(2)

    expect(decisions).toHaveLength(4)
    expect([...applied]).toEqual([2])
  })

  it('자동 적용 전의 시작 상태와 경기 난수 수열은 사용자 판과 같다', () => {
    const userInitial = createState(problem, 'USA')
    const watchInitial = createState(problem, 'USA')
    const before = createRng(problem.seed)
    const after = createRng(problem.seed)

    capturePlan(2)

    expect(watchInitial).toEqual(userInitial)
    expect(Array.from({ length: 36 }, () => after.next())).toEqual(
      Array.from({ length: 36 }, () => before.next()),
    )
  })

  it('자동 setter로 만든 계획과 손으로 같은 권장안을 넣은 최종 상태가 같다', () => {
    const automatic = capturePlan(2).decisions
    const manual = recommendationDecisions(recommendation)

    expect(simulate(problem, automatic, 'USA').final).toEqual(
      simulate(problem, manual, 'USA').final,
    )
  })

  it('전·후반 자동 계획도 손으로 두 반에 넣은 계획과 최종 상태가 같다', () => {
    const applied = new Set<1 | 2>()
    const first = capturePlan(1, applied).decisions
    const second = capturePlan(2, applied).decisions
    const manual = recommendationDecisions(recommendation)

    expect(simulateHalves(problem, first, second, 'USA').final).toEqual(
      simulateHalves(problem, manual, manual, 'USA').final,
    )
  })

  it('권장안 관전 준비가 기존 시드의 무개입 결과를 바꾸지 않는다', () => {
    for (const seed of [problem.seed, problem.seed + 7919, problem.seed + 15838]) {
      const replay = { ...problem, seed }
      const before = simulate(replay, [], 'USA').final
      capturePlan(2)
      expect(simulate(replay, [], 'USA').final).toEqual(before)
    }
  })
})

describe('150판 비교 범위 문구', () => {
  it('한 판 관전과 여러 변형의 짝지은 비교를 구분한다', () => {
    expect(variantComparisonTitle(150)).toBe('같은 국면의 변형 150판 비교')
    expect(VARIANT_COMPARISON_NOTE).toContain('판마다')
    expect(VARIANT_COMPARISON_NOTE).toContain('각 변형 안에서는')
    expect(VARIANT_COMPARISON_NOTE).toContain('같은 조건')
  })
})
