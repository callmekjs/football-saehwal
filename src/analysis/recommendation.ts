import type { Decision, Level, Recommendation } from '../sim/types'
import type { FormationId } from '../sim/formations'
import type { Half } from '../matchClock'

export interface RecommendationControls {
  setFormation: (formation: FormationId) => unknown
  setLever: (type: 'LINE' | 'PRESS' | 'WIDTH', value: Level) => unknown
}

/**
 * 권장 설정을 실제 경기 조작과 같은 네 결정으로 바꾼다.
 *
 * 분석용 150판과 권장안 관전이 이 함수를 함께 써야 화면에 적힌 권장안과
 * 실제로 뛰는 권장안이 갈리지 않는다. 네 결정은 모두 급수 타임의 0틱에
 * 들어가며 난수를 소비하지 않는다.
 */
export function recommendationDecisions(
  recommendation: Recommendation,
): Decision[] {
  const { line, press, width } = recommendation.tactics
  return [
    { tick: 0, type: 'FORMATION', value: recommendation.formation },
    { tick: 0, type: 'LINE', value: line },
    { tick: 0, type: 'PRESS', value: press },
    { tick: 0, type: 'WIDTH', value: width },
  ]
}

/**
 * 한 반의 급수 타임에 권장안을 한 번만 적용한다.
 *
 * React StrictMode가 같은 효과를 다시 실행해도 `applied`가 먼저 닫히므로
 * 네 설정 호출은 한 번만 지나간다. 반환값은 이번 호출이 실제 적용했는지다.
 */
export function applyRecommendationOnce(
  half: Half,
  applied: Set<Half>,
  recommendation: Recommendation,
  controls: RecommendationControls,
): boolean {
  if (applied.has(half)) return false
  applied.add(half)

  for (const decision of recommendationDecisions(recommendation)) {
    if (decision.type === 'FORMATION') {
      controls.setFormation(decision.value)
    } else if (
      decision.type === 'LINE' ||
      decision.type === 'PRESS' ||
      decision.type === 'WIDTH'
    ) {
      controls.setLever(decision.type, decision.value)
    }
  }
  return true
}
