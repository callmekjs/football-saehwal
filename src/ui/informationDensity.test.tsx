/**
 * @vitest-environment jsdom
 *
 * 라이트 사용자의 기본 기록 화면에는 결론만 남고, 기존 150판 근거는
 * 키보드로 열 수 있는 native details 안에 그대로 있어야 한다.
 */
import { describe, expect, it } from 'vitest'
import type { MatchRecord } from './matchHistory'
import { HistorySection } from './HistorySection'
import { mount } from './domHarness'

const profile = {
  goalsFor: 1.2,
  goalsAgainst: 1.1,
  homeShot: 12.3,
  awayShot: 8.4,
  setPiece: 4.5,
  behind: 2.6,
}

const record: MatchRecord = {
  at: 1_000,
  problemId: 'p02',
  problemTitle: '잠긴 문',
  opponentId: 'USA',
  opponentName: '미국',
  half: 2,
  score: [1, 0],
  passed: true,
  decisions: 4,
  delta: 0.2,
  setup: { formation: '4-2-3-1', line: 1, press: 2, width: 0 },
  recommended: { formation: '4-3-3', line: 1, press: 1, width: 2 },
  compare: {
    runs: 150,
    rates: { noop: 0.3, user: 0.5, recommendation: 0.7 },
    noop: profile,
    user: { ...profile, goalsFor: 1.7, homeShot: 16.1, goalsAgainst: 1.5 },
    recommendation: { ...profile, goalsFor: 2.8, homeShot: 26.8, goalsAgainst: 2.1 },
  },
}

describe('지난 기록의 단계적 공개', () => {
  it('성공률과 실제·권장 설정은 바로 보이고 여섯 평균은 닫힌 상세에 남는다', () => {
    const view = mount(
      <HistorySection
        records={[record]}
        problems={[{ id: 'p02', title: '잠긴 문', goal: '리드 지키기', noActionRate: 0.3 }]}
        now={2_000}
      />,
    )

    const lesson = view.container.querySelector('.lesson-board')!
    expect(lesson.querySelector('.lesson-rate')?.textContent).toContain('성공 가능성')
    expect(lesson.querySelector('.lesson-legend')?.textContent).toContain('4-2-3-1')
    expect(lesson.querySelector('.lesson-legend')?.textContent).toContain('4-3-3')
    expect(lesson.querySelector('.lesson-key-text')?.textContent).toContain('평균')

    const details = lesson.querySelector<HTMLDetailsElement>('.lesson-details')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toContain('여섯 세부 평균')
    expect(details.querySelectorAll('.lesson-row')).toHaveLength(6)
    expect(details.textContent).toContain('평균 득점')
    expect(details.textContent).toContain('배후 침투 허용')

    view.unmount()
  })
})
