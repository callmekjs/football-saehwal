import { describe, expect, it } from 'vitest'
import raw from '../data/problems.json' with { type: 'json' }
import { createState } from '../sim/engine'
import { toProblem } from '../sim/problems'
import { isDuplicate, toRecord, type FinishedMatch } from './recordMatch'

const survive = toProblem(raw.find((p) => p.id === 'p02')!)
const chase = toProblem(raw.find((p) => p.id === 'p01')!)

function finished(overrides: Partial<FinishedMatch> = {}): FinishedMatch {
  return {
    problem: survive,
    final: { ...createState(survive), score: [1, 0] },
    opponent: 'USA',
    half: 2,
    decisions: 3,
    delta: 0.08,
    at: 1_000_000,
    ...overrides,
  }
}

describe('끝난 경기를 기록 한 줄로', () => {
  it('국면이 요구한 것으로 판정한다. 승패가 아니다', () => {
    // 지키는 국면은 앞서야 통과다
    expect(toRecord(finished()).passed).toBe(true)
    expect(
      toRecord(finished({ final: { ...createState(survive), score: [1, 1] } })).passed,
    ).toBe(false)

    // 쫓는 국면은 동점이면 통과다
    const drew = { ...createState(chase), score: [1, 1] as [number, number] }
    expect(toRecord(finished({ problem: chase, final: drew })).passed).toBe(true)
  })

  it('상대 이름을 팀 표에서 읽는다', () => {
    expect(toRecord(finished({ opponent: 'VIE' })).opponentName).toBe('베트남')
  })

  it('분석이 아직이면 차이를 비워 두고 판은 남긴다', () => {
    const record = toRecord(finished({ delta: null }))
    expect(record.delta).toBeNull()
    expect(record.problemTitle).toBe(survive.title)
  })

  it('점수를 복사해 담아 나중에 상태가 바뀌어도 흔들리지 않는다', () => {
    const final = { ...createState(survive), score: [2, 1] as [number, number] }
    const record = toRecord(finished({ final }))
    final.score[0] = 9
    expect(record.score).toEqual([2, 1])
  })

  it('같은 판이 두 번 저장되지 않는다', () => {
    const first = toRecord(finished())
    // 종료 화면이 다시 그려지거나 분석이 끝나 한 번 더 저장을 시도한다
    const again = toRecord(finished({ at: 1_002_000, delta: 0.12 }))
    expect(isDuplicate(again, [first])).toBe(true)
  })

  it('결정 수가 다르면 다른 판이다', () => {
    const first = toRecord(finished())
    expect(isDuplicate(toRecord(finished({ decisions: 5 })), [first])).toBe(false)
  })

  it('한참 뒤에 같은 결과가 나오면 새 판이다', () => {
    const first = toRecord(finished())
    expect(isDuplicate(toRecord(finished({ at: 1_000_000 + 120_000 })), [first])).toBe(
      false,
    )
  })

  /**
   * `04 · 분석·기록` 이 다음 판에 쓸 문장을 만들려면 "+8.2%p" 한 줄로는
   * 모자란다. 종료 시점의 설정과 그 국면의 권장 설정이 함께 남아야
   * "라인 낮음 → 보통부터 맞추세요"를 말할 수 있다.
   */
  it('종료 시점의 우리 설정을 함께 남긴다', () => {
    const final = { ...createState(survive), score: [1, 0] as [number, number] }
    final.tactics = { line: 2, press: 0, width: 2 }
    final.formation = '3-4-3'
    const record = toRecord(finished({ final }))
    expect(record.setup).toEqual({
      formation: '3-4-3',
      line: 2,
      press: 0,
      width: 2,
    })
  })

  it('그 국면의 검증된 권장 설정도 함께 남긴다', () => {
    const record = toRecord(finished())
    expect(record.recommended).toEqual({
      formation: survive.recommendation!.formation,
      line: survive.recommendation!.tactics.line,
      press: survive.recommendation!.tactics.press,
      width: survive.recommendation!.tactics.width,
    })
  })

  it('150판 비교가 아직이면 그 칸을 아예 만들지 않는다', () => {
    // 없는 값을 0으로 채우면 있지도 않은 경기를 그리게 된다
    expect('compare' in toRecord(finished())).toBe(false)
  })

  it('150판 비교가 끝나면 세 갈래를 그대로 담는다', () => {
    const compare = {
      rates: { noop: 0.2, user: 0.4, recommendation: 0.6 },
      noop: { goalsFor: 0, goalsAgainst: 2, homeShot: 1, awayShot: 6, setPiece: 9, behind: 5 },
      user: { goalsFor: 0, goalsAgainst: 1, homeShot: 2, awayShot: 4, setPiece: 6, behind: 3 },
      recommendation: {
        goalsFor: 0,
        goalsAgainst: 0.6,
        homeShot: 3,
        awayShot: 2,
        setPiece: 4,
        behind: 2,
      },
    }
    expect(toRecord(finished({ compare })).compare).toEqual(compare)
  })
})
