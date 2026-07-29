import { describe, expect, it } from 'vitest'
import commentary from './commentary.json' with { type: 'json' }
import problems from './problems.json' with { type: 'json' }
import { PRESETS } from '../analysis/presets'
import { FORMATIONS } from '../sim/formations'

describe('화자별 한국어 문체', () => {
  it('경기 중계에는 구현 용어와 영어식 교체 표현이 나오지 않는다', () => {
    const lines = Object.values(commentary).flat()
    const implementationCopy = /반영됐|부상 이탈|아웃,|자리를 받|점수를 바꿨다/

    for (const line of lines) {
      expect(line).not.toMatch(implementationCopy)
    }
  })

  it('국면 요약은 축구에서 쓰는 앞서다와 뒤지다로 점수를 말한다', () => {
    for (const problem of problems) {
      if (problem.score[0] > problem.score[1]) expect(problem.summary).toContain('앞서')
      if (problem.score[0] < problem.score[1]) expect(problem.summary).toContain('뒤지고')
      expect(problem.summary).not.toMatch(/로 (?:이기고|지고) 있/)
    }
  })

  it('감독의 권장안은 정중한 문장으로 끝난다', () => {
    for (const problem of problems) {
      expect(problem.recommendation.explanation).toMatch(/(?:습니다|세요)\.$/)
    }
  })

  it('포메이션 설명은 명사 표어를 붙이지 않고 한 문장으로 말한다', () => {
    for (const formation of Object.values(FORMATIONS)) {
      expect(formation.hint).not.toMatch(/^(?:균형|중원 장악|뒤를 두껍게|전부 앞으로)\./)
    }
  })

  it('전술 프리셋은 번역투 없이 행동을 설명한다', () => {
    for (const preset of PRESETS) {
      expect(preset.hint).not.toMatch(/전환으로 찌른다|대신 바깥이 열린다/)
    }
  })
})
