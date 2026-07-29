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

  it('골 경로와 당시 전술을 근거로 높은 확신도의 원인을 낸다', () => {
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
    expect(report.goalsAgainst[0].evidence.some((item) => item.includes('9회'))).toBe(true)
  })

  it('경로가 없는 실점은 추측하지 않고 낮은 확신도로 남긴다', () => {
    const problem = problemAt()
    const final = finalWith({
      score: [1, 1],
      log: [{ tick: 500, kind: 'CONCEDE' }],
    })
    const report = buildCoachReport(problem, final, [], metrics, 77)
    expect(report.goalsAgainst[0].confidence).toBe('낮음')
    expect(report.goalsAgainst[0].explanation).toContain('확정할 수 없습니다')
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
      '상대 오픈플레이',
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
    expect(report.goalsFor[0].title).toContain('슈팅')
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
})
