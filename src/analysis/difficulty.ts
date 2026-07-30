import { DIFFICULTY } from '../sim/constants'
import type { Difficulty } from '../sim/types'

/**
 * 상대 난이도를 사람 말로.
 *
 * 사용자가 정했다 — *"상대 난이도도 설정하자. 우리보다 피파 랭킹이 낮다 =
 * 쉬움 / 비슷하다 = 보통 / 높다 = 어려움"*.
 *
 * **표를 두 곳에 두지 않는다.** 국면 선택 화면 · 경기 중 상대 패널 ·
 * 주장 브리핑 · 감독 보고서가 같은 표를 봐야 한다. 나뉘어 있으면 한쪽만
 * 고쳐져서 화면은 "어려움"인데 주장은 "비슷한 상대"라고 말하게 된다.
 * `presets.ts` 와 같은 이유다.
 *
 * **순위는 전부 창작한 숫자다.** 실존 팀·국가·구단의 이름도 실제 순위도
 * 쓰지 않는다. 숫자의 단일 원본은 `constants.ts` 의 `DIFFICULTY` 이고
 * 여기서는 그것을 읽어 문장으로 만들기만 한다.
 */
export interface DifficultyInfo {
  id: Difficulty
  /** 버튼에 뜨는 이름 */
  name: string
  /** 상대의 가상 랭킹 */
  rank: number
  /** 우리와 견준 한 줄. 순위 숫자가 작을수록 강팀이다 */
  hint: string
}

export const DIFFICULTIES: DifficultyInfo[] = [
  {
    id: 'EASY',
    name: '쉬움',
    rank: DIFFICULTY.levels.EASY.rank,
    hint: '우리보다 순위가 낮습니다',
  },
  {
    id: 'NORMAL',
    name: '보통',
    rank: DIFFICULTY.levels.NORMAL.rank,
    hint: '우리와 비슷합니다',
  },
  {
    id: 'HARD',
    name: '어려움',
    rank: DIFFICULTY.levels.HARD.rank,
    hint: '우리보다 순위가 높습니다',
  },
]

export const OUR_RANK = DIFFICULTY.ourRank

export function difficultyInfo(id: Difficulty): DifficultyInfo {
  const found = DIFFICULTIES.find((d) => d.id === id)
  if (!found) throw new Error(`없는 난이도: ${id}`)
  return found
}
