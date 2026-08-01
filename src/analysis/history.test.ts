import { describe, expect, it } from 'vitest'
import {
  deltaTrend,
  lastLesson,
  leverHabits,
  setupGaps,
  setupText,
  toRecordCompare,
  type Goal,
  type HistoryEntry,
  type RecordCompare,
  type RecordProfile,
  type RecordSetup,
} from './history'

const EMPTY: RecordProfile = {
  goalsFor: 0,
  goalsAgainst: 0,
  homeShot: 0,
  awayShot: 0,
  setPiece: 0,
  behind: 0,
}

function profile(overrides: Partial<RecordProfile> = {}): RecordProfile {
  return { ...EMPTY, ...overrides }
}

function setup(overrides: Partial<RecordSetup> = {}): RecordSetup {
  return { formation: '4-4-2', line: 1, press: 1, width: 1, ...overrides }
}

function compare(overrides: Partial<RecordCompare> = {}): RecordCompare {
  return {
    rates: { noop: 0.3, user: 0.4, recommendation: 0.6 },
    noop: profile({ goalsAgainst: 1.4, awayShot: 5, setPiece: 8, behind: 4 }),
    user: profile({ goalsAgainst: 1.1, awayShot: 4, setPiece: 7, behind: 3 }),
    recommendation: profile({ goalsAgainst: 0.7, awayShot: 2.5, setPiece: 4, behind: 2 }),
    ...overrides,
  }
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    at: 1_000_000,
    problemId: 'p02',
    problemTitle: '잠긴 문',
    opponentName: '미국',
    passed: true,
    decisions: 4,
    delta: 0.1,
    ...overrides,
  }
}

const survive = (): Goal => 'SURVIVE'
const equalize = (): Goal => 'EQUALIZE'

describe('150판 비교를 기록에 담을 만큼만 추린다', () => {
  it('세 갈래가 다 있어야 담는다', () => {
    const rows = [
      { key: 'noop' as const, rate: 0.2, profile: profile({ goalsAgainst: 2 }) },
      { key: 'user' as const, rate: 0.5, profile: profile({ goalsAgainst: 1 }) },
      {
        key: 'recommendation' as const,
        rate: 0.7,
        profile: profile({ goalsAgainst: 0.5 }),
      },
    ]
    const packed = toRecordCompare(rows)
    expect(packed?.rates).toEqual({ noop: 0.2, user: 0.5, recommendation: 0.7 })
    expect(packed?.user.goalsAgainst).toBe(1)

    // 한 갈래라도 없으면 반쪽짜리 비교를 만들지 않는다
    expect(toRecordCompare(rows.slice(0, 2))).toBeNull()
    expect(toRecordCompare([])).toBeNull()
  })

  it('화면이 읽는 여섯 칸만 남긴다. 기록은 쉰 줄까지 쌓인다', () => {
    const packed = toRecordCompare([
      { key: 'noop', rate: 0.2, profile: profile() },
      { key: 'user', rate: 0.5, profile: profile() },
      { key: 'recommendation', rate: 0.7, profile: profile() },
    ])
    expect(Object.keys(packed!.user).sort()).toEqual(
      ['awayShot', 'behind', 'goalsAgainst', 'goalsFor', 'homeShot', 'setPiece'].sort(),
    )
  })

  it('실제로 비교한 판 수를 함께 남긴다', () => {
    const packed = toRecordCompare([
      { key: 'noop', rate: 0.2, runs: 150, profile: profile() },
      { key: 'user', rate: 0.5, runs: 150, profile: profile() },
      { key: 'recommendation', rate: 0.7, runs: 150, profile: profile() },
    ])
    expect(packed?.runs).toBe(150)
  })
})

describe('가장 최근 판이 남긴 것', () => {
  it('비교가 끝난 판이 하나도 없으면 지어내지 않는다', () => {
    expect(lastLesson([], survive)).toBeNull()
    // 옛 기록에는 비교 칸이 통째로 없다
    expect(lastLesson([entry(), entry({ at: 2_000_000 })], survive)).toBeNull()
  })

  it('비교가 끝나기 전에 떠난 판은 건너뛰고 완성된 최근 판을 쓴다', () => {
    const lesson = lastLesson(
      [
        entry({ at: 3_000_000, problemTitle: '아직 분석 안 끝남' }),
        entry({ at: 2_000_000, problemTitle: '완성된 판', compare: compare() }),
        entry({ at: 1_000_000, problemTitle: '더 오래된 판', compare: compare() }),
      ],
      survive,
    )
    expect(lesson?.problemTitle).toBe('완성된 판')
    expect(lesson?.at).toBe(2_000_000)
  })

  it('지키는 국면과 쫓는 국면은 보는 칸이 다르다', () => {
    const keep = lastLesson([entry({ compare: compare() })], survive)
    expect(keep?.rows.map((row) => row.key)).toEqual([
      'goalsFor',
      'homeShot',
      'goalsAgainst',
      'awayShot',
      'setPiece',
      'behind',
    ])
    // 쫓는 판에서 "상대 슈팅이 줄었다"는 위로가 되지 않는다
    const chase = lastLesson([entry({ compare: compare() })], equalize)
    expect(chase?.rows.map((row) => row.key)).toEqual([
      'goalsFor',
      'homeShot',
      'goalsAgainst',
      'behind',
    ])
    // 다만 쫓는 판에도 반대쪽 한 줄은 남는다. 따라잡고 더 내주면 소용없다
    expect(chase?.rows.some((row) => row.key === 'goalsAgainst')).toBe(true)
  })

  it('세 갈래 값을 그대로 옮기고 방향을 붙인다', () => {
    const lesson = lastLesson([entry({ compare: compare() })], survive)!
    const conceded = lesson.rows.find((row) => row.key === 'goalsAgainst')!
    expect(conceded.noop).toBeCloseTo(1.4)
    expect(conceded.user).toBeCloseTo(1.1)
    expect(conceded.recommendation).toBeCloseTo(0.7)
    expect(conceded.lowerIsBetter).toBe(true)

    const scored = lastLesson([entry({ compare: compare() })], equalize)!.rows[0]
    expect(scored.lowerIsBetter).toBe(false)
  })

  it('권장안이 더 높으면 남은 몫을 %p 로 말한다', () => {
    const lesson = lastLesson([entry({ compare: compare() })], survive)!
    expect(lesson.headroom).toBeCloseTo(0.2)
    expect(lesson.headline).toContain('20.0%p')
    expect(lesson.paragraphs.join(' ')).toContain('60.0%')
  })

  it('권장 성공률은 더 높지만 수비 평균은 내 판단이 좋으면 거래와 설명 한계를 밝힌다', () => {
    const lesson = lastLesson(
      [
        entry({
          compare: {
            runs: 150,
            rates: { noop: 0.4, user: 98 / 150, recommendation: 99 / 150 },
            noop: profile(),
            user: profile({
              goalsFor: 0.72,
              homeShot: 3.8,
              goalsAgainst: 0.93,
              awayShot: 4.3,
              setPiece: 4.6,
              behind: 1.7,
            }),
            recommendation: profile({
              goalsFor: 0.81,
              homeShot: 4.5,
              goalsAgainst: 1.17,
              awayShot: 6.7,
              setPiece: 4.4,
              behind: 2.1,
            }),
          },
        }),
      ],
      survive,
    )!
    const explanation = lesson.paragraphs.join(' ')

    expect(lesson.rows.map((row) => row.key)).toEqual([
      'goalsFor',
      'homeShot',
      'goalsAgainst',
      'awayShot',
      'setPiece',
      'behind',
    ])
    expect(explanation).toContain('공격 쪽')
    expect(explanation).toContain('세트피스 위험(내 판단 4.6 · 권장 4.4)도 권장안이 나았습니다')
    expect(explanation).toContain('평균에서는 공격 여유와 수비 위험이 맞바뀌어 있습니다')
    expect(explanation).toContain('65.3% 대 66.0%')
    expect(explanation).toContain('1판 더 목표를 이뤘다는 뜻')
    expect(explanation).toContain('평균만으로 성공률 차이의 원인을 하나로 단정')
    expect(explanation).toContain('권장안이 전반적으로 더 낫다고 말할 수는 없습니다')
  })

  it('표시된 평균에 권장 우위가 없으면 성공률 차이를 설명할 수 없다고 말한다', () => {
    const user = profile({
      goalsFor: 0.9,
      homeShot: 5.2,
      goalsAgainst: 0.93,
      awayShot: 4.3,
      setPiece: 4.2,
      behind: 1.7,
    })
    const recommendation = profile({
      goalsFor: 0.8,
      homeShot: 4.8,
      goalsAgainst: 1.17,
      awayShot: 6.7,
      setPiece: 4.4,
      behind: 2.1,
    })
    const lesson = lastLesson(
      [
        entry({
          compare: {
            runs: 150,
            rates: { noop: 0.4, user: 98 / 150, recommendation: 99 / 150 },
            noop: profile(),
            user,
            recommendation,
          },
        }),
      ],
      survive,
    )!
    expect(lesson.paragraphs.join(' ')).toContain(
      '공개된 공격·수비 평균에서는 권장안이 앞선 항목을 확인할 수 없습니다',
    )
  })

  it('원값이 달라도 화면에 9.0 대 9.0으로 보이면 권장 우위로 세지 않는다', () => {
    const lesson = lastLesson(
      [
        entry({
          compare: {
            runs: 150,
            rates: { noop: 0.4, user: 98 / 150, recommendation: 99 / 150 },
            noop: profile(),
            user: profile({ setPiece: 9.04 }),
            recommendation: profile({ setPiece: 8.96 }),
          },
        }),
      ],
      survive,
    )!
    const setPiece = lesson.rows.find((row) => row.key === 'setPiece')!
    const explanation = lesson.paragraphs.join(' ')

    expect(setPiece.user).not.toBe(setPiece.recommendation)
    expect(setPiece.note).toContain('거의 같았습니다(9.0 대 9.0)')
    expect(explanation).toContain(
      '공개된 공격·수비 평균에서는 권장안이 앞선 항목을 확인할 수 없습니다',
    )
    expect(explanation).not.toContain('세트피스 위험(내 판단 9.0 · 권장 9.0)도 권장안이 나았습니다')
  })

  /**
   * 숫자는 매 경기 바뀌므로 조사를 고정하면 거의 매번 틀린 조사가 뜬다.
   * 사람은 그것을 문법 오류로 읽고 "기계가 쓴 글"로 판단한다.
   */
  it('숫자 뒤 조사를 읽는 소리에 맞춰 고른다', () => {
    const sentence = (recommendation: number) =>
      lastLesson(
        [
          entry({
            compare: {
              rates: { noop: 0.1, user: 0.2, recommendation: 0.6 },
              noop: profile({ goalsFor: 0.1 }),
              user: profile({ goalsFor: 0.5 }),
              recommendation: profile({ goalsFor: recommendation }),
            },
          }),
        ],
        equalize,
      )!.paragraphs[2]

    // 0 은 '영'이라 받침 ㅇ → 으로
    expect(sentence(1.0)).toContain('1.00으로')
    // 8 은 '팔'이라 받침 ㄹ → 로
    expect(sentence(3.68)).toContain('3.68로')
    expect(sentence(3.68)).not.toContain('3.68으로')
    // 3 은 '삼'이라 받침 ㅁ → 으로
    expect(sentence(2.23)).toContain('2.23으로')
  })

  it('내가 권장안보다 나았으면 그 판을 그대로 쓰라고 한다', () => {
    const lesson = lastLesson(
      [
        entry({
          compare: compare({ rates: { noop: 0.2, user: 0.7, recommendation: 0.5 } }),
        }),
      ],
      survive,
    )!
    expect(lesson.headroom).toBeCloseTo(-0.2)
    expect(lesson.headline).toContain('권장 전술보다 좋았습니다')
    expect(lesson.paragraphs.join(' ')).toContain('그대로 쓰세요')
  })

  it('권장안과 거의 같으면 더 짤 것이 없다고 말한다', () => {
    const lesson = lastLesson(
      [
        entry({
          compare: compare({ rates: { noop: 0.2, user: 0.5, recommendation: 0.51 } }),
        }),
      ],
      survive,
    )!
    expect(lesson.headline).toContain('거의 같은 수준')
    expect(lesson.paragraphs.join(' ')).toContain('사실상 같았습니다')
    expect(lesson.paragraphs.join(' ')).not.toContain('더 짜낼 몫')
  })

  it('지난 기록은 독자를 당신이라고 부르거나 결과 분포가 움직인다고 말하지 않는다', () => {
    const lesson = lastLesson([entry({ compare: compare() })], survive)!
    const prose = lesson.paragraphs.join(' ')

    expect(prose).toContain('내 판단은')
    expect(prose).not.toContain('당신')
    expect(prose).not.toContain('결과 분포는 움직이지 않았습니다')
  })

  it('설정이 갈린 항목을 다음 판의 출발점으로 적는다', () => {
    const lesson = lastLesson(
      [
        entry({
          compare: compare(),
          setup: setup({ formation: '4-4-2', line: 0, press: 0, width: 0 }),
          recommended: setup({ formation: '4-3-3', line: 1, press: 1, width: 2 }),
        }),
      ],
      survive,
    )!
    expect(lesson.gaps.map((gap) => gap.label)).toEqual(['대형', '라인', '압박', '폭'])
    expect(lesson.gaps[1]).toEqual({ label: '라인', mine: '낮음', recommended: '보통' })
    const setupParagraph = lesson.paragraphs[lesson.paragraphs.length - 1]
    expect(setupParagraph).toContain('종료 시점 실제 설정: 4-4-2 · 라인 낮음 · 압박 약 · 폭 좁게')
    expect(setupParagraph).toContain('권장 설정: 4-3-3 · 라인 보통 · 압박 중 · 폭 넓게')
    expect(setupParagraph).toContain('라인 낮음 → 보통')
  })

  it('설정이 같으면 무엇이 아니라 언제의 문제라고 말한다', () => {
    const same = setup({ formation: '4-3-3', line: 1, press: 1, width: 2 })
    const lesson = lastLesson(
      [entry({ compare: compare(), setup: same, recommended: { ...same } })],
      survive,
    )!
    expect(lesson.gaps).toHaveLength(0)
    expect(lesson.paragraphs[lesson.paragraphs.length - 1]).toContain('언제 맞췄느냐')
  })

  it('설정 기록이 없는 옛 판도 그래프는 그린다', () => {
    const lesson = lastLesson([entry({ compare: compare() })], survive)!
    expect(lesson.mine).toBeNull()
    expect(lesson.recommended).toBeNull()
    expect(lesson.gaps).toHaveLength(0)
    expect(lesson.rows).toHaveLength(6)
  })

  it('같은 기록에는 같은 문장이 나온다', () => {
    const records = [
      entry({ compare: compare(), setup: setup(), recommended: setup({ line: 0 }) }),
    ]
    expect(lastLesson(records, survive)).toEqual(lastLesson(records, survive))
  })

  it('국면을 모르면 지키는 판으로 보고 죽지 않는다', () => {
    const lesson = lastLesson([entry({ compare: compare() })], () => undefined)
    expect(lesson?.goal).toBe('SURVIVE')
  })
})

describe('설정을 사람 말로', () => {
  it('네 칸을 모두 적는다', () => {
    expect(setupText(setup({ formation: '5-4-1', line: 0, press: 2, width: 2 }))).toBe(
      '5-4-1 · 라인 낮음 · 압박 강 · 폭 넓게',
    )
  })

  it('같은 설정에는 갈린 항목이 없다', () => {
    expect(setupGaps(setup(), setup())).toHaveLength(0)
  })
})

describe('전술 버릇', () => {
  const habitEntry = (mine: Partial<RecordSetup>, want: Partial<RecordSetup>, at: number) =>
    entry({ at, setup: setup(mine), recommended: setup(want) })

  it('설정이 남은 판이 모자라면 버릇이라고 부르지 않는다', () => {
    expect(leverHabits([])).toHaveLength(0)
    // 한 판은 버릇이 아니라 그날의 선택이다
    expect(leverHabits([habitEntry({ line: 0 }, { line: 1 }, 1)])).toHaveLength(0)
    // 설정이 없는 옛 기록은 아무리 많아도 세지 않는다
    expect(leverHabits([entry(), entry({ at: 2 }), entry({ at: 3 })])).toHaveLength(0)
  })

  it('네 레버를 모두 센다', () => {
    const habits = leverHabits([
      habitEntry({ line: 0 }, { line: 1 }, 1),
      habitEntry({ line: 0 }, { line: 1 }, 2),
    ])
    expect(habits.map((habit) => habit.key)).toEqual(['formation', 'line', 'press', 'width'])
  })

  it('권장보다 낮게 둔 판이 몰리면 그 대가를 알려준다', () => {
    const habits = leverHabits([
      habitEntry({ line: 0 }, { line: 1 }, 1),
      habitEntry({ line: 0 }, { line: 2 }, 2),
      habitEntry({ line: 1 }, { line: 1 }, 3),
    ])
    const line = habits.find((habit) => habit.key === 'line')!
    expect(line.lower).toBe(2)
    expect(line.matched).toBe(1)
    expect(line.higher).toBe(0)
    expect(line.lean).toBe('LOWER')
    // 라인 낮음의 세트피스 대가는 이 저장소가 실측으로 확립한 축이다
    expect(line.note).toContain('세트피스')
  })

  it('권장보다 높게 둔 판이 몰리면 반대쪽 대가를 알려준다', () => {
    const habits = leverHabits([
      habitEntry({ line: 2 }, { line: 1 }, 1),
      habitEntry({ line: 2 }, { line: 1 }, 2),
    ])
    const line = habits.find((habit) => habit.key === 'line')!
    expect(line.lean).toBe('HIGHER')
    expect(line.note).toContain('뒷공간')
  })

  it('폭을 넓게만 두면 중앙이 열린다는 것을 말한다', () => {
    const habits = leverHabits([
      habitEntry({ width: 2 }, { width: 0 }, 1),
      habitEntry({ width: 2 }, { width: 1 }, 2),
    ])
    const width = habits.find((habit) => habit.key === 'width')!
    expect(width.lean).toBe('HIGHER')
    expect(width.note).toContain('중앙이 열립니다')
  })

  it('맞춘 판이 절반을 넘으면 잘 맞췄다고 한다', () => {
    const habits = leverHabits([
      habitEntry({ press: 1 }, { press: 1 }, 1),
      habitEntry({ press: 1 }, { press: 1 }, 2),
      habitEntry({ press: 0 }, { press: 1 }, 3),
    ])
    const press = habits.find((habit) => habit.key === 'press')!
    expect(press.lean).toBe('MATCHED')
    expect(press.matched).toBe(2)
  })

  it('대형은 방향이 없으므로 맞음과 다름만 센다', () => {
    const habits = leverHabits([
      habitEntry({ formation: '4-4-2' }, { formation: '4-3-3' }, 1),
      habitEntry({ formation: '4-3-3' }, { formation: '4-3-3' }, 2),
    ])
    const formation = habits.find((habit) => habit.key === 'formation')!
    expect(formation.lower).toBe(0)
    expect(formation.matched).toBe(1)
    expect(formation.higher).toBe(1)
    expect(formation.total).toBe(2)
  })

  it('같은 기록에는 같은 결과가 나온다', () => {
    const records = [
      habitEntry({ line: 0 }, { line: 1 }, 1),
      habitEntry({ width: 2 }, { width: 1 }, 2),
    ]
    expect(leverHabits(records)).toEqual(leverHabits(records))
  })
})

describe('판단의 흐름', () => {
  const trendEntry = (at: number, delta: number | null, passed = true) =>
    entry({ at, delta, passed })

  it('그릴 점이 모자라면 그리지 않는다', () => {
    expect(deltaTrend([])).toBeNull()
    expect(deltaTrend([trendEntry(1, 0.1)])).toBeNull()
    // 분석이 안 끝난 판은 점이 될 수 없다
    expect(deltaTrend([trendEntry(1, null), trendEntry(2, null)])).toBeNull()
  })

  it('오래된 판에서 최근 판 순으로 세운다', () => {
    const trend = deltaTrend([
      trendEntry(3_000, 0.3),
      trendEntry(1_000, 0.1),
      trendEntry(2_000, 0.2),
    ])!
    expect(trend.points.map((point) => point.at)).toEqual([1_000, 2_000, 3_000])
    expect(trend.mean).toBeCloseTo(0.2)
  })

  it('열두 판까지만 세우고 오래된 것부터 버린다', () => {
    const many = Array.from({ length: 20 }, (_, index) => trendEntry(index + 1, 0.01 * index))
    const trend = deltaTrend(many)!
    expect(trend.points).toHaveLength(12)
    expect(trend.points[0].at).toBe(9)
    expect(trend.points[11].at).toBe(20)
  })

  it('점이 넷 미만이면 앞뒤 절반을 가르지 않는다', () => {
    const trend = deltaTrend([trendEntry(1, 0.1), trendEntry(2, 0.2)])!
    expect(trend.shift).toBeNull()
    expect(trend.note).toContain('네 판이 쌓이면')
  })

  it('뒤쪽 절반이 좋아지면 방향을 잡아가고 있다고 한다', () => {
    const trend = deltaTrend([
      trendEntry(1, -0.1),
      trendEntry(2, -0.1),
      trendEntry(3, 0.1),
      trendEntry(4, 0.1),
    ])!
    expect(trend.shift).toBeCloseTo(0.2)
    expect(trend.note).toContain('좋아졌습니다')
    // 나빠진 폭도 좋아진 폭도 부호 없이 읽는다
    expect(trend.note).not.toContain('-20.0%p 좋아')
  })

  it('뒤쪽 절반이 나빠지면 되짚어 보라고 한다', () => {
    const trend = deltaTrend([
      trendEntry(1, 0.1),
      trendEntry(2, 0.1),
      trendEntry(3, -0.1),
      trendEntry(4, -0.1),
    ])!
    expect(trend.shift).toBeCloseTo(-0.2)
    expect(trend.note).toContain('나빠졌습니다')
    expect(trend.note).toContain('20.0%p')
  })

  it('평균이 방치와 비슷하면 그렇게 말한다', () => {
    const trend = deltaTrend([trendEntry(1, 0.01), trendEntry(2, -0.01)])!
    expect(trend.note).toContain('크게 다르지 않습니다')
  })

  it('판단과 결과를 따로 남긴다. 좋은 판단도 결과가 나쁠 수 있다', () => {
    const trend = deltaTrend([trendEntry(1, 0.2, false), trendEntry(2, -0.2, true)])!
    expect(trend.points[0].delta).toBeCloseTo(0.2)
    expect(trend.points[0].passed).toBe(false)
    expect(trend.points[1].passed).toBe(true)
  })

  it('같은 기록에는 같은 결과가 나온다', () => {
    const records = [trendEntry(1, 0.1), trendEntry(2, -0.05), trendEntry(3, 0.2)]
    expect(deltaTrend(records)).toEqual(deltaTrend(records))
  })
})
