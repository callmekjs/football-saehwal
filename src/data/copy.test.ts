import { describe, expect, it } from 'vitest'
import commentary from './commentary.json' with { type: 'json' }
import problems from './problems.json' with { type: 'json' }
import { PRESETS } from '../analysis/presets'
import { FORMATIONS } from '../sim/formations'
import { buildBriefing } from '../analysis/briefing'
import { buildHalftime } from '../analysis/halftime'
import { createState } from '../sim/engine'
import { toProblem } from '../sim/problems'

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

  /**
   * 주장이 실제로 하는 말을 국면마다 다 만들어 보고 검사한다.
   *
   * 문장 하나를 그대로 박아두면 다듬을 때마다 깨진다. 대신 **다시 들어오면
   * 안 되는 표현**만 막는다.
   */
  describe('주장이 실제로 내뱉는 말', () => {
    const speeches = problems.map(toProblem).flatMap((problem) => {
      const state = createState(problem)
      const briefing = buildBriefing(problem, state)
      const halftime = buildHalftime(problem, state)
      return [
        ...briefing.core.map((line) => line.text),
        ...briefing.more.map((line) => line.text),
        halftime.headline,
        ...halftime.lines.map((line) => line.text),
      ]
    })

    it('점수를 말할 때 뒤집다로 읽히는 말을 쓰지 않는다', () => {
      // '0 대 1로 뒤집니다' 는 지고 있다는 뜻인데 뒤집는다로 읽힌다
      for (const text of speeches) expect(text).not.toContain('뒤집니다')
    })

    /**
     * `압박 중` 자체는 막지 않는다. 그건 약·중·강의 눈금 이름이다.
     * 막는 것은 `압박 중입니다` 처럼 명사에 `중이다` 를 붙인 번역투다.
     */
    it('사람이 하는 행동을 한자어 명사에 중이다를 붙여 말하지 않는다', () => {
      for (const text of speeches) {
        expect(text).not.toMatch(/(?:압박|교체|이동|회복) 중(?:입니다|이다|이었|인 )/)
      }
    })

    it('경고는 장으로 세고 있다로 얼버무리지 않는다', () => {
      for (const text of speeches) expect(text).not.toMatch(/경고가 있습니다|경고가 있는데/)
    })

    it('영어식 쉼표와 정형 문장을 주장 말투로 되돌리지 않는다', () => {
      for (const text of speeches) {
        expect(text).not.toMatch(/오늘 상대는 .+, \d+위/)
        expect(text).not.toContain('현재 경기 중인 선수의 최고치는')
        expect(text).not.toMatch(/앞 감독은 .+ 그대로 두고 나갔습니다/)
      }
    })
  })
})
