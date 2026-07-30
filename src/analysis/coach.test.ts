import { describe, expect, it } from 'vitest'
import raw from '../data/problems.json' with { type: 'json' }
import { toProblem } from '../sim/problems'
import { createState } from '../sim/engine'
import type { Decision, MatchState, Problem } from '../sim/types'
import { buildCoachReport, type CoachMetrics, type OutcomeProfile } from './coach'

function problemAt(index = 1): Problem {
  return toProblem(raw[index])
}

const profile = (overrides: Partial<OutcomeProfile> = {}): OutcomeProfile => ({
  goalsFor: 0.4,
  goalsAgainst: 0.8,
  homeAttempt: 15,
  awayAttempt: 7,
  homeShot: 5,
  awayShot: 3,
  setPiece: 5,
  behind: 1,
  sendOff: 0.1,
  injury: 0.05,
  ...overrides,
})

const metrics: CoachMetrics = {
  noopRate: 0.47,
  userRate: 0.62,
  recommendationRate: 0.71,
  userDelta: 0.15,
  profiles: {
    noop: profile(),
    user: profile({ goalsAgainst: 0.55, setPiece: 2.8 }),
    recommendation: profile({ goalsAgainst: 0.48, setPiece: 2.2 }),
  },
}

function finalWith(overrides: Partial<MatchState>): MatchState {
  return { ...createState(problemAt()), tick: 750, ...overrides }
}

describe('Coach 경기 분석', () => {
  it('같은 경기와 판단에는 같은 상세 분석을 만든다', () => {
    const problem = problemAt()
    const final = finalWith({
      score: [1, 1],
      stats: {
        homeAttempt: 14,
        awayAttempt: 7,
        homeShot: 4,
        awayShot: 3,
        setPiece: 6,
        behind: 1,
      },
      log: [{ tick: 620, kind: 'CONCEDE', detail: 'SET_PIECE' }],
    })
    expect(buildCoachReport(problem, final, [], metrics, 77)).toEqual(
      buildCoachReport(problem, final, [], metrics, 77),
    )
  })

  it('반복된 골 경로와 당시 전술을 근거로 높은 확신도의 원인을 낸다', () => {
    const problem = problemAt()
    const final = finalWith({
      score: [1, 1],
      stats: {
        homeAttempt: 12,
        awayAttempt: 6,
        homeShot: 3,
        awayShot: 2,
        setPiece: 9,
        behind: 0,
      },
      log: [{ tick: 500, kind: 'CONCEDE', detail: 'SET_PIECE' }],
    })
    const report = buildCoachReport(problem, final, [], metrics, 77)
    expect(report.goalsAgainst[0].title).toContain('세트피스')
    expect(report.goalsAgainst[0].confidence).toBe('높음')
    expect(report.goalsAgainst[0].time).toMatch(/^\d+:\d{2}$/)
    expect(report.goalsAgainst[0].evidence).toContain('경기 전체 세트피스 위험 9')
    expect(report.turningPoint.evidence).toContain('경기 전체 세트피스 위험 9')
  })

  it('근거가 늘고 반복될수록 확신도가 낮음에서 보통, 높음으로 올라간다', () => {
    const problem = problemAt()
    const unknown = finalWith({
      score: [1, 1],
      log: [{ tick: 500, kind: 'CONCEDE' }],
    })
    const observedOnce = finalWith({
      score: [1, 1],
      stats: {
        homeAttempt: 0,
        awayAttempt: 1,
        homeShot: 0,
        awayShot: 1,
        setPiece: 0,
        behind: 0,
      },
      log: [{ tick: 500, kind: 'PENALTY', detail: 'PENALTY_SCORED' }],
    })
    const repeated = finalWith({
      score: [1, 1],
      stats: {
        homeAttempt: 0,
        awayAttempt: 4,
        homeShot: 0,
        awayShot: 3,
        setPiece: 5,
        behind: 0,
      },
      log: [{ tick: 500, kind: 'CONCEDE', detail: 'SET_PIECE' }],
    })
    const confidenceRank = { 낮음: 0, 보통: 1, 높음: 2 }
    const low = buildCoachReport(problem, unknown, [], metrics, 77).goalsAgainst[0]
    const medium = buildCoachReport(problem, observedOnce, [], metrics, 77).goalsAgainst[0]
    const high = buildCoachReport(problem, repeated, [], metrics, 77).goalsAgainst[0]

    expect(confidenceRank[low.confidence]).toBeLessThan(confidenceRank[medium.confidence])
    expect(confidenceRank[medium.confidence]).toBeLessThan(confidenceRank[high.confidence])
    // 근거가 없을 때는 원인을 하나로 못박지 않고 말끝을 흐린다.
    // 문구 자체가 아니라 '단정하지 않는다'는 성질을 지킨다
    expect(low.explanation).toMatch(/(?:없습니다|어렵습니다)\.$/)
  })

  it('내부 세트피스 위험값에는 실제 횟수처럼 회를 붙이지 않는다', () => {
    const final = finalWith({
      score: [1, 1],
      stats: {
        homeAttempt: 12,
        awayAttempt: 6,
        homeShot: 3,
        awayShot: 2,
        setPiece: 9,
        behind: 1,
      },
      log: [{ tick: 500, kind: 'CONCEDE', detail: 'SET_PIECE' }],
    })
    const report = buildCoachReport(problemAt(), final, [], metrics, 77)

    expect(JSON.stringify(report)).not.toMatch(/세트피스 (?:허용 |위험 )?\d+(?:\.\d+)?회/)
    expect(report.summary[2]).toContain('세트피스 위험 9')
  })

  it('같은 틱의 복수 실점과 성공한 페널티를 각각 한 골로 분석한다', () => {
    const problem = problemAt()
    const final = finalWith({
      score: [1, 3],
      log: [
        { tick: 400, kind: 'CONCEDE', detail: 'BEHIND+OPEN_PLAY' },
        { tick: 600, kind: 'PENALTY', detail: 'PENALTY_SCORED' },
      ],
    })
    const report = buildCoachReport(problem, final, [], metrics, 77)
    expect(report.goalsAgainst).toHaveLength(3)
    expect(report.goalsAgainst.map((finding) => finding.title)).toEqual([
      '수비 뒷공간 침투',
      '상대 공격',
      '페널티킥',
    ])
  })

  it('슈팅이 하나도 없어도 0으로 나누지 않고 진입 문제로 설명한다', () => {
    const problem = problemAt(0)
    const final = {
      ...createState(problem),
      tick: 750,
      stats: {
        homeAttempt: 0,
        awayAttempt: 0,
        homeShot: 0,
        awayShot: 0,
        setPiece: 0,
        behind: 0,
      },
    }
    const report = buildCoachReport(problem, final, [], metrics, 78)
    expect(report.goalsFor[0].title).toMatch(/슛|슈팅/)
    expect(report.goalsFor[0].evidence.join(' ')).toContain('0.0%')
    expect(JSON.stringify(report)).not.toContain('NaN')
  })

  it('모든 전문 판단에는 실제 근거가 하나 이상 붙는다', () => {
    const report = buildCoachReport(problemAt(), finalWith({}), [], metrics, 77)
    const findings = [
      report.turningPoint,
      ...report.goalsFor,
      ...report.goalsAgainst,
      ...report.decisionReview,
    ]
    expect(findings.every((finding) => finding.evidence.length > 0)).toBe(true)
  })

  it('직접 배치도 선수 개입으로 기록하고 당시 전술 근거에 남긴다', () => {
    const decisions: Decision[] = [
      { tick: 20, type: 'POSITION', target: 'MF06', position: { x: 80, y: 12 } },
    ]
    const report = buildCoachReport(problemAt(), finalWith({}), decisions, metrics, 77)
    const personnel = report.decisionReview.find(
      (finding) => finding.id === 'decision-personnel',
    )

    expect(personnel?.title).toContain('직접 배치')
    expect(personnel?.title).toContain('1회')
  })

  it('감독 보고서는 차분한 존댓말로 근거를 설명한다', () => {
    const final = finalWith({
      score: [1, 1],
      stats: {
        homeAttempt: 12,
        awayAttempt: 6,
        homeShot: 3,
        awayShot: 2,
        setPiece: 9,
        behind: 1,
      },
      log: [{ tick: 500, kind: 'CONCEDE', detail: 'SET_PIECE' }],
    })
    const report = buildCoachReport(problemAt(), final, [], metrics, 77)
    const prose = [
      report.headline,
      report.turningPoint.explanation,
      ...report.goalsFor.map((finding) => finding.explanation),
      ...report.goalsAgainst.map((finding) => finding.explanation),
      ...report.decisionReview.map((finding) => finding.explanation),
    ].join(' ')

    expect(prose).not.toMatch(/전반적으로|되어집니다|보여집니다|득점 생산|작동했습니다/)
    expect(report.decisionReview.find((finding) => finding.id === 'decision-channels')?.label)
      .toBe('150판 비교')
  })
})

/**
 * 전반부터 뛴 경기.
 *
 * 사용자가 전반을 고르면 경기는 1,500틱이고 전반 결정이 후반까지 살아
 * 있다. 그런데 후반 상태는 `carryToNextHalf` 가 기록과 집계를 비운 뒤라
 * 전반의 골·슈팅·결정이 하나도 남아 있지 않다. 전반 기록을 따로 넘기지
 * 않으면 보고서가 그 45분을 통째로 못 본다.
 */
describe('Coach 두 반 분석', () => {
  const firstDecisions: Decision[] = [
    { tick: 30, type: 'FORMATION', value: '5-4-1' },
    { tick: 300, type: 'SUB', out: 'DF04', in: 'DF15' },
  ]
  const secondDecisions: Decision[] = [{ tick: 200, type: 'LINE', value: 1 }]

  /** 전반 종료 상태. 1-0 국면에서 한 골을 더 넣고 한 골을 내줬다 */
  const halftime = () =>
    finalWith({
      score: [2, 1],
      stats: {
        homeAttempt: 10,
        awayAttempt: 5,
        homeShot: 3,
        awayShot: 2,
        setPiece: 4,
        behind: 1,
      },
      log: [
        { tick: 30, kind: 'GOAL', detail: 'BUILD_UP' },
        { tick: 500, kind: 'CONCEDE', detail: 'SET_PIECE' },
      ],
    })

  /** 후반 종료 상태. 점수는 이어지고 기록·집계만 후반의 것이다 */
  const secondHalf = () =>
    finalWith({
      score: [2, 2],
      stats: {
        homeAttempt: 8,
        awayAttempt: 6,
        homeShot: 2,
        awayShot: 3,
        setPiece: 5,
        behind: 2,
      },
      log: [{ tick: 30, kind: 'CONCEDE', detail: 'SET_PIECE' }],
    })

  it('같은 틱 번호라도 전반과 후반을 다른 시각으로 적는다', () => {
    const report = buildCoachReport(problemAt(), secondHalf(), [], metrics, 70, {
      decisions: [],
      final: halftime(),
    })
    expect(report.goalsFor.map((finding) => finding.time)).toEqual(['전반 25:53'])
    expect(report.goalsAgainst.map((finding) => finding.time)).toEqual([
      '전반 39:40',
      '후반 70:53',
    ])
  })

  it('전반에 내린 결정을 반별로 나눠 말한다', () => {
    const report = buildCoachReport(
      problemAt(),
      secondHalf(),
      secondDecisions,
      metrics,
      70,
      { decisions: firstDecisions, final: halftime() },
    )
    const halves = report.decisionReview.find((finding) => finding.id === 'decision-halves')

    expect(halves?.title).toBe('전반 2회 · 후반 1회')
    expect(halves?.evidence.some((line) => line.startsWith('전반 · '))).toBe(true)
    expect(halves?.evidence.some((line) => line.startsWith('후반 · '))).toBe(true)
    expect(halves?.evidence.join(' ')).toContain('5-4-1')
    expect(halves?.evidence.join(' ')).toContain('교체')
  })

  it('전반 결정도 총 결정 수와 선수 개입에 함께 센다', () => {
    const report = buildCoachReport(
      problemAt(),
      secondHalf(),
      secondDecisions,
      metrics,
      70,
      { decisions: firstDecisions, final: halftime() },
    )
    const timing = report.decisionReview.find((finding) => finding.id === 'decision-timing')
    const personnel = report.decisionReview.find(
      (finding) => finding.id === 'decision-personnel',
    )

    expect(timing?.title).toContain('총 3회')
    expect(timing?.time).toBe('전반 25:53')
    expect(personnel?.title).toContain('1회')
    expect(personnel?.evidence.some((line) => line.includes('전반 1회'))).toBe(true)
  })

  it('후반 장면의 당시 설정에 전반에 바꾼 포메이션이 남는다', () => {
    const report = buildCoachReport(
      problemAt(),
      secondHalf(),
      secondDecisions,
      metrics,
      70,
      { decisions: firstDecisions, final: halftime() },
    )
    const secondGoal = report.goalsAgainst.find((finding) => finding.time === '후반 70:53')

    expect(secondGoal?.evidence.join(' ')).toContain('5-4-1')
    expect(secondGoal?.evidence.join(' ')).not.toContain('4-4-2')
  })

  it('전반의 골과 집계를 합쳐서 요약한다', () => {
    const report = buildCoachReport(problemAt(), secondHalf(), [], metrics, 70, {
      decisions: [],
      final: halftime(),
    })

    // 공격 10+8 · 슈팅 3+2 · 득점 1골(전반 1 · 후반 0)
    expect(report.summary[0]).toBe('우리 공격 18회 → 슈팅 5회 → 득점 1골 (전반 1 · 후반 0)')
    expect(report.summary[1]).toBe('상대 공격 11회 → 슈팅 5회 → 실점 2골 (전반 1 · 후반 1)')
    expect(report.summary[2]).toBe('세트피스 위험 9 · 배후 침투 3회')
  })

  it('전환점은 두 반을 통틀어 가장 늦은 장면이다', () => {
    const report = buildCoachReport(problemAt(), secondHalf(), [], metrics, 70, {
      decisions: [],
      final: halftime(),
    })
    expect(report.turningPoint.title.startsWith('후반 70:53')).toBe(true)
  })

  it('전반 기록이 없으면 반 이름표도 반별 카드도 붙이지 않는다', () => {
    const report = buildCoachReport(problemAt(), secondHalf(), secondDecisions, metrics, 70)

    expect(report.goalsAgainst[0].time).toBe('70:53')
    expect(report.decisionReview.some((finding) => finding.id === 'decision-halves')).toBe(
      false,
    )
    expect(JSON.stringify(report)).not.toContain('전반')
  })

  it('같은 두 반 기록에는 같은 분석을 만든다', () => {
    const build = () =>
      buildCoachReport(problemAt(), secondHalf(), secondDecisions, metrics, 70, {
        decisions: firstDecisions,
        final: halftime(),
      })
    expect(build()).toEqual(build())
  })

  it('두 반 모두 개입이 없으면 그렇게 말한다', () => {
    const report = buildCoachReport(problemAt(), secondHalf(), [], metrics, 70, {
      decisions: [],
      final: halftime(),
    })
    const none = report.decisionReview.find((finding) => finding.id === 'decision-none')
    expect(none?.title).toContain('전반과 후반 모두')
  })
})
