import { describe, expect, it } from 'vitest'
import type { CoachFinding } from '../analysis/coach'
import type { Decision } from '../sim/types'
import { buildOneMove } from './oneMove'

function finding(
  id: string,
  title: string,
  {
    time,
    evidence = [],
  }: {
    time?: string
    evidence?: string[]
  } = {},
): CoachFinding {
  return {
    id,
    label: '검사',
    time,
    title,
    explanation: '검사용 설명',
    evidence,
    confidence: '보통',
  }
}

describe('이 경기의 한 수', () => {
  it('결정이 없으면 존재하지 않은 한 수를 만들지 않는다', () => {
    const summary = buildOneMove(
      [
        finding('decision-impact', '방치와 통계적으로 큰 차이가 없었다'),
        finding('decision-none', '경기 중 전술 개입이 없었다'),
      ],
      0,
      { decisions: [], kickoff: 70 },
    )

    expect(summary.kind).toBe('none')
    expect(summary.label).toBe('개입 없음')
    expect(summary.time).toBeNull()
    expect(summary.decision).toBe('개입 없음')
    expect(summary.deltaText).toBe('0.0%p')
    expect(summary.note).toContain('존재하지 않은 한 수를 만들지 않았습니다')
  })

  it('기본 후반 경기에서도 실제 결정 내용과 시각을 보여준다', () => {
    const summary = buildOneMove(
      [
        finding('decision-timing', '80:00에 첫 개입, 총 1회 결정', {
          time: '80:00',
          evidence: ['첫 결정 80:00 · 마지막 결정 80:00'],
        }),
      ],
      0.14,
      {
        decisions: [{ tick: 341, type: 'WIDTH', value: 0 }],
        kickoff: 70,
      },
    )

    expect(summary.kind).toBe('single')
    expect(summary.label).toBe('관찰된 결정')
    expect(summary.time).toBe('80:00')
    expect(summary.decision).toBe('폭 → 좁게')
    expect(summary.impactLabel).toContain('방치 대비')
    expect(summary.deltaText).toBe('+14.0%p')
  })

  it('두 반의 여러 결정이면 가장 이른 실제 결정을 대표로 보여준다', () => {
    const summary = buildOneMove(
      [
        finding('decision-timing', '전반 25:00에 첫 개입, 총 4회 결정', {
          time: '전반 25:00',
        }),
        finding('decision-halves', '전반 3회 · 후반 1회', {
          evidence: [
            '전반 · 25:00 포메이션 → 5-4-1',
            '전반 · 30:00 라인 → 보통',
          ],
        }),
        finding(
          'decision-recommendation',
          '후반 70:00에 검증된 권장 설정을 모두 맞췄다',
          { time: '후반 70:00' },
        ),
      ],
      0.14,
      {
        firstHalf: [
          { tick: 0, type: 'FORMATION', value: '5-4-1' },
          { tick: 170, type: 'LINE', value: 1 },
        ],
        decisions: [
          { tick: 0, type: 'PRESS', value: 1 },
          { tick: 120, type: 'WIDTH', value: 2 },
        ],
        kickoff: 70,
      },
    )

    expect(summary.kind).toBe('representative')
    expect(summary.label).toBe('대표 관찰 결정')
    expect(summary.time).toBe('전반 25:00')
    expect(summary.decision).toBe('포메이션 → 5-4-1')
    expect(summary.impactLabel).toBe('전체 판단 묶음 · 방치 대비')
    expect(summary.note).toContain('이 한 수 하나의 효과가 아니라')
    expect(summary.note).toContain('모든 판단을 함께 재현한 결과')
  })

  it('화면에 내보내는 문구에서 사람을 특정 호칭으로 부르지 않는다', () => {
    const summaries = [
      buildOneMove(
        [finding('decision-none', '개입 없음')],
        0,
        { decisions: [], kickoff: 70 },
      ),
      buildOneMove(
        [
          finding('decision-timing', '80:00에 첫 개입, 총 1회 결정', {
            time: '80:00',
          }),
        ],
        -0.08,
        {
          decisions: [{ tick: 0, type: 'LINE', value: 1 }],
          kickoff: 70,
        },
      ),
    ]
    const copy = JSON.stringify(summaries)

    expect(copy).not.toContain('당신')
    expect(copy).not.toContain('사용자')
    expect(copy).not.toContain('유저')
  })

  const decisionCopy: Array<[string, Decision, string]> = [
    ['포메이션', { tick: 0, type: 'FORMATION', value: '5-4-1' }, '포메이션 → 5-4-1'],
    ['라인', { tick: 0, type: 'LINE', value: 1 }, '라인 → 보통'],
    ['압박', { tick: 0, type: 'PRESS', value: 2 }, '압박 → 강'],
    ['폭', { tick: 0, type: 'WIDTH', value: 0 }, '폭 → 좁게'],
    ['교체', { tick: 0, type: 'SUB', out: 'DF04', in: 'DF15' }, '교체 4번 → 15번'],
    [
      '개별 지시',
      { tick: 0, type: 'ORDER', target: 'MF07', order: 'PUSH_UP' },
      '7번 → 올라가라',
    ],
    [
      '직접 배치',
      { tick: 0, type: 'POSITION', target: 'MF07', position: { x: 72, y: 54 } },
      '7번 → 직접 배치',
    ],
    [
      '기본 자리',
      { tick: 0, type: 'POSITION', target: 'MF07', position: null },
      '7번 → 기본 자리',
    ],
  ]

  it.each(decisionCopy)(
    '%s 결정을 실제 내용으로 형식화한다',
    (_label, decision, expected) => {
      const summary = buildOneMove(
        [
          finding('decision-timing', '70:00에 첫 개입, 총 1회 결정', {
            time: '70:00',
          }),
        ],
        0.02,
        { decisions: [decision], kickoff: 70 },
      )

      expect(summary.decision).toBe(expected)
    },
  )
})
