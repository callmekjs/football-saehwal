/**
 * 조사를 앞말에 맞춰 고른다.
 *
 * 사용자가 지적했다 — *"지금 한글이 매우 어색해 마치 번역기 돌린 것
 * 같은데."* 원인 중 하나가 이것이었다. 화면 문구에 조사가 **고정**돼
 * 있어서, 앞에 오는 숫자가 매 경기 바뀌면 거의 매번 틀린 조사가 뜬다.
 *
 * ```
 * "전반을 1 대 1으로 마쳤습니다"   ← 1은 '일'이라 '로'가 맞다
 * "저쪽은 3-4-3로 나왔습니다"      ← 3은 '삼'이라 '으로'가 맞다
 * ```
 *
 * 사람은 이걸 문법 오류로 읽고, 그것이 "기계가 쓴 글" 느낌을 만든다.
 * 문장을 아무리 다듬어도 조사가 틀리면 소용이 없다.
 *
 * **순수 함수다.** 시계도 난수도 브라우저도 모른다.
 */

/** 앞말의 끝소리 */
interface Ending {
  /** 받침이 있는가 */
  batchim: boolean
  /** 그 받침이 ㄹ 인가. `으로/로` 만 이걸 따로 본다 */
  rieul: boolean
}

/**
 * 숫자를 읽었을 때의 끝소리.
 *
 * 화면에는 `1` 이라고 적히지만 사람은 '일'이라고 읽는다. 조사는 **읽는
 * 소리**를 따라가므로 글자가 아니라 발음으로 판단해야 한다.
 *
 * | 숫자 | 읽기 | 받침 |
 * |---|---|---|
 * | 0 | 영 | ㅇ |
 * | 1 | 일 | **ㄹ** |
 * | 2 | 이 | 없음 |
 * | 3 | 삼 | ㅁ |
 * | 4 | 사 | 없음 |
 * | 5 | 오 | 없음 |
 * | 6 | 육 | ㄱ |
 * | 7 | 칠 | **ㄹ** |
 * | 8 | 팔 | **ㄹ** |
 * | 9 | 구 | 없음 |
 *
 * 끝자리가 0인 두 자리 이상(10·20·100…)은 십·백·천으로 읽혀 언제나
 * 받침이 있고 ㄹ 이 아니다. 0 한 글자('영')와 같은 칸을 쓰면 된다.
 */
const DIGIT: Record<string, Ending> = {
  '0': { batchim: true, rieul: false },
  '1': { batchim: true, rieul: true },
  '2': { batchim: false, rieul: false },
  '3': { batchim: true, rieul: false },
  '4': { batchim: false, rieul: false },
  '5': { batchim: false, rieul: false },
  '6': { batchim: true, rieul: false },
  '7': { batchim: true, rieul: true },
  '8': { batchim: true, rieul: true },
  '9': { batchim: false, rieul: false },
}

/** 한글 음절 영역 */
const HANGUL_FIRST = 0xac00
const HANGUL_LAST = 0xd7a3
/** 종성 스물여덟 개 중 ㄹ 의 자리 */
const JONG_RIEUL = 8

/**
 * 앞말의 끝소리를 읽는다.
 *
 * 뒤쪽 괄호·따옴표·공백은 건너뛴다. `"(4-4-2)"` 처럼 닫는 괄호가 붙어도
 * 실제로 발음되는 마지막 글자를 봐야 한다.
 *
 * 한글도 숫자도 아니면(영문·기호) **받침이 없는 것으로 본다.** 틀릴 수
 * 있지만, 이 화면에 그런 말이 오지 않으므로 조용히 넘어가는 편이 낫다.
 */
export function endingOf(word: string): Ending {
  const trimmed = word.replace(/[)\]}'"\s.·]+$/u, '')
  const ch = trimmed.at(-1)
  if (!ch) return { batchim: false, rieul: false }

  if (ch >= '0' && ch <= '9') return DIGIT[ch]

  const code = ch.charCodeAt(0)
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) {
    const jong = (code - HANGUL_FIRST) % 28
    return { batchim: jong !== 0, rieul: jong === JONG_RIEUL }
  }

  return { batchim: false, rieul: false }
}

/** 고를 수 있는 조사 짝 */
export type JosaPair = '은는' | '이가' | '을를' | '와과' | '로으로' | '이라라'

/**
 * 앞말에 맞는 조사 한 개.
 *
 * `로/으로` 만 규칙이 다르다 — **ㄹ 받침은 `로` 를 쓴다.** '일로'이지
 * '일으로'가 아니다. 이 예외를 빠뜨리는 것이 가장 흔한 실수다.
 */
export function josa(word: string, pair: JosaPair): string {
  const { batchim, rieul } = endingOf(word)
  switch (pair) {
    case '은는':
      return batchim ? '은' : '는'
    case '이가':
      return batchim ? '이' : '가'
    case '을를':
      return batchim ? '을' : '를'
    case '와과':
      return batchim ? '과' : '와'
    case '이라라':
      return batchim ? '이라' : '라'
    case '로으로':
      return batchim && !rieul ? '으로' : '로'
  }
}

/** 앞말에 조사를 붙인 한 덩어리. `withJosa(3, '로으로')` → `'3으로'` */
export function withJosa(word: string | number, pair: JosaPair): string {
  const text = String(word)
  return text + josa(text, pair)
}
