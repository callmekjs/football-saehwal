import { describe, expect, it } from 'vitest'
import { leverToast, presetToast, subToast } from './toast'
import { LEVEL_WORD, PRESETS } from '../analysis/presets'
import type { Level } from '../sim/types'

describe('무엇을 눌렀는지 알려주는 한 줄', () => {
  it('레버는 무엇을 어디로 옮겼는지 둘 다 말한다', () => {
    // "압박" 만 뜨면 올렸는지 내렸는지 모른다. 되돌릴 수 없으므로 값이 필요하다
    expect(leverToast('PRESS', 2)).toBe('압박 → 강')
    expect(leverToast('LINE', 0)).toBe('수비라인 → 낮음')
    expect(leverToast('WIDTH', 1)).toBe('수비 폭 → 보통')
  })

  it('레버 세 축 아홉 값이 전부 서로 다른 문장을 낸다', () => {
    /**
     * 두 조작이 같은 문장을 내면 토스트가 확인 기능을 못 한다 — 무엇을
     * 눌렀는지 알려주려고 띄우는 것이기 때문이다.
     */
    const seen = new Set<string>()
    for (const type of ['LINE', 'PRESS', 'WIDTH'] as const) {
      for (const v of [0, 1, 2] as Level[]) seen.add(leverToast(type, v))
    }
    expect(seen.size).toBe(9)
  })

  it('레버 문장은 화면 라벨과 같은 낱말을 쓴다', () => {
    // 버튼에는 "강" 이라고 써놓고 토스트에 "높음" 이 뜨면 다른 걸 누른 줄 안다
    expect(leverToast('PRESS', 2)).toContain(LEVEL_WORD.press[2])
    expect(leverToast('LINE', 2)).toContain(LEVEL_WORD.line[2])
    expect(leverToast('WIDTH', 0)).toContain(LEVEL_WORD.width[0])
  })

  it('프리셋은 실제 전술 이름으로 뜬다', () => {
    for (const preset of PRESETS) {
      expect(presetToast(preset.name)).toBe(`${preset.name} 적용`)
    }
  })

  it('교체는 나간 선수와 들어온 선수를 함께 말한다', () => {
    // 카드는 유한하고 회수 불가라 누가 바뀌었는지가 가장 중요하다
    expect(subToast(7, 15)).toBe('7번 → 15번 교체')
  })
})
