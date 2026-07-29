import { describe, it, expect } from 'vitest'
import { endingOf, josa, withJosa } from './josa'

/**
 * 조사가 앞말에 맞아야 한다.
 *
 * 사용자가 지적했다 — "지금 한글이 매우 어색해 마치 번역기 돌린 것
 * 같은데." 화면 문구에 조사가 고정돼 있어서, 앞에 오는 숫자가 매 경기
 * 바뀌면 거의 매번 틀린 조사가 떴다. 사람은 그걸 문법 오류로 읽는다.
 */
describe('조사 고르기', () => {
  it('숫자는 글자가 아니라 읽는 소리를 따른다', () => {
    // 화면에는 1이라고 적히지만 사람은 '일'이라고 읽는다
    expect(withJosa(1, '로으로')).toBe('1로') // 일 → ㄹ 받침
    expect(withJosa(2, '로으로')).toBe('2로') // 이 → 받침 없음
    expect(withJosa(3, '로으로')).toBe('3으로') // 삼 → ㅁ 받침
    expect(withJosa(6, '로으로')).toBe('6으로') // 육 → ㄱ 받침
    expect(withJosa(0, '로으로')).toBe('0으로') // 영 → ㅇ 받침
  })

  it('ㄹ 받침은 로를 쓴다 — 가장 흔한 실수다', () => {
    /**
     * '일로'이지 '일으로'가 아니다. 받침만 보고 갈라놓으면 1·7·8에서
     * 전부 틀린다
     */
    for (const n of [1, 7, 8]) {
      expect(withJosa(n, '로으로'), `${n}`).toBe(`${n}로`)
    }
    expect(withJosa('서울', '로으로')).toBe('서울로')
  })

  it('끝자리가 0이면 십·백·천으로 읽혀 받침이 있다', () => {
    expect(withJosa(10, '로으로')).toBe('10으로') // 십 → ㅂ
    expect(withJosa(20, '로으로')).toBe('20으로') // 이십 → ㅂ
    expect(withJosa(100, '로으로')).toBe('100으로') // 백 → ㄱ
  })

  it('포메이션은 마지막 숫자가 정한다', () => {
    // 이게 틀리면 "저쪽은 3-4-3로 나왔습니다"가 화면에 뜬다
    expect(withJosa('4-4-2', '로으로')).toBe('4-4-2로')
    expect(withJosa('3-4-3', '로으로')).toBe('3-4-3으로')
    expect(withJosa('5-4-1', '로으로')).toBe('5-4-1로')
    expect(withJosa('4-2-3-1', '로으로')).toBe('4-2-3-1로')
    expect(withJosa('4-1-4-1', '로으로')).toBe('4-1-4-1로')
  })

  it('한글은 받침으로 갈린다', () => {
    expect(withJosa('전반', '은는')).toBe('전반은')
    expect(withJosa('후반', '은는')).toBe('후반은')
    expect(withJosa('상대', '은는')).toBe('상대는')
    expect(withJosa('선수', '이가')).toBe('선수가')
    expect(withJosa('감독', '이가')).toBe('감독이')
    expect(withJosa('교체', '을를')).toBe('교체를')
    expect(withJosa('압박', '을를')).toBe('압박을')
    expect(withJosa('전술', '와과')).toBe('전술과')
    expect(withJosa('전략', '와과')).toBe('전략과')
  })

  it('뒤에 붙은 괄호나 따옴표는 건너뛴다', () => {
    // 실제로 발음되는 마지막 글자를 봐야 한다
    expect(josa('(4-4-2)', '로으로')).toBe('로')
    expect(josa('3번.', '이가')).toBe('이')
  })

  it('한글도 숫자도 아니면 받침이 없는 것으로 본다', () => {
    // 이 화면에 그런 말이 오지 않는다. 조용히 넘어가는 편이 낫다
    expect(josa('', '은는')).toBe('는')
    expect(josa('GK', '은는')).toBe('는')
  })

  it('짝마다 두 값 중 하나만 나온다', () => {
    const pairs = [
      ['은는', ['은', '는']],
      ['이가', ['이', '가']],
      ['을를', ['을', '를']],
      ['와과', ['과', '와']],
      ['로으로', ['로', '으로']],
      ['이라라', ['이라', '라']],
    ] as const
    for (const [pair, allowed] of pairs) {
      for (const word of ['1', '3', '전반', '상대', '4-4-2']) {
        expect(allowed as readonly string[], `${word} + ${pair}`).toContain(
          josa(word, pair),
        )
      }
    }
  })

  it('받침 판정 자체를 확인한다', () => {
    expect(endingOf('일')).toEqual({ batchim: true, rieul: true })
    expect(endingOf('이')).toEqual({ batchim: false, rieul: false })
    expect(endingOf('삼')).toEqual({ batchim: true, rieul: false })
  })
})
