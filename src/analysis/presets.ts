import type { Level, Tactics } from '../sim/types'

/**
 * 이름 붙은 전술 — 레버 세 개를 한 번에 세운다.
 *
 * 레버를 따로 만지면 스물일곱 조합이 나오는데, 실측으로 그중 열한에서
 * 열다섯 개가 1위와 구분되지 않는다. 선택지는 많은데 뜻이 있는 것은 몇
 * 개뿐이라는 말이다. 게다가 75초짜리 경기에서 세 번 탭할 여유가 없다.
 *
 * 실제 축구가 전술을 부르는 방식이 이미 그렇다 — "역습으로 간다"고 하지
 * "라인 낮음 압박 약 폭 보통으로 간다"고 하지 않는다. 이름이 붙으면
 * 무엇을 하려는지가 화면에서 읽히고, 한 번의 탭으로 도달한다.
 *
 * 레버를 없애지는 않았다. 프리셋으로 뼈대를 세우고 레버로 다듬는 것이
 * 감독이 실제로 하는 일이다.
 *
 * **표를 두 곳에 두지 않는다.** 전술 버튼(`MatchScreen`)과 주장 브리핑
 * (`briefing.ts`)이 같은 표를 봐야 한다. 나뉘어 있으면 한쪽만 고쳐져서
 * 화면은 "역습"이라고 띄우는데 주장은 "직접 맞춤"이라고 말하게 된다.
 */
export interface TacticPreset {
  name: string
  hint: string
  /** [라인, 압박, 폭] */
  v: [Level, Level, Level]
}

export const PRESETS: TacticPreset[] = [
  { name: '균형', hint: '공수 어느 한쪽에도 치우치지 않는다', v: [1, 1, 1] },
  { name: '역습', hint: '뒤로 물러서 공을 내준 뒤 빠르게 역습한다', v: [0, 0, 1] },
  { name: '측면 공략', hint: '좌우로 넓게 벌려 바깥에 길을 낸다', v: [1, 1, 2] },
  { name: '전방 압박', hint: '라인을 올려 상대 진영에서 공을 뺏는다', v: [2, 2, 1] },
  { name: '밀집 수비', hint: '중앙을 촘촘히 막지만 측면을 내준다', v: [1, 2, 0] },
]

/**
 * 지금 레버가 어느 이름에 해당하는가. 어디에도 안 맞으면 `null` 이다.
 *
 * 모든 국면의 시작 지점이 `null` 이다 — 앞 감독이 걸어둔 지시가 정상적인
 * 전술이 아니라는 뜻이고, 그것이 국면의 전제다.
 */
export function presetOf(t: Tactics): TacticPreset | null {
  return (
    PRESETS.find((p) => p.v[0] === t.line && p.v[1] === t.press && p.v[2] === t.width) ?? null
  )
}

/** 레버 단계를 사람 말로. 화면과 브리핑이 같은 낱말을 써야 한다 */
export const LEVEL_WORD: Record<'line' | 'press' | 'width', Record<Level, string>> = {
  line: { 0: '낮음', 1: '보통', 2: '높음' },
  press: { 0: '약', 1: '중', 2: '강' },
  width: { 0: '좁게', 1: '보통', 2: '넓게' },
}
