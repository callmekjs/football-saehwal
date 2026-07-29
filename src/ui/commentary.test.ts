import { describe, expect, it } from 'vitest'
import lines from '../data/commentary.json'
import type { MatchEventLog } from '../sim/types'
import { commentaryFor, commentaryKeyOf } from './commentary'

describe('경기 코멘터리', () => {
  it('서로 다른 상황 문장 46줄을 가진다', () => {
    expect(Object.values(lines).flat()).toHaveLength(46)
    expect(Object.values(lines).flat().every((line) => line.trim().length > 0)).toBe(true)
  })

  it('득점 경로가 있으면 그 경로에 맞는 문장 묶음을 고른다', () => {
    expect(commentaryKeyOf({ tick: 10, kind: 'CONCEDE', detail: 'BEHIND' })).toBe(
      'CONCEDE.BEHIND',
    )
    expect(commentaryKeyOf({ tick: 20, kind: 'CONCEDE', detail: 'OPEN_PLAY' })).toBe(
      'CONCEDE.OPEN_PLAY',
    )
    expect(commentaryKeyOf({ tick: 30, kind: 'CONCEDE', detail: 'SET_PIECE' })).toBe(
      'CONCEDE.SET_PIECE',
    )
  })

  it('기록 하나는 다시 읽어도 같은 문장이 나온다', () => {
    const event: MatchEventLog = { tick: 318, kind: 'CARD', target: 'MF06' }
    expect(commentaryFor(event)).toBe(commentaryFor(event))
  })

  it('같은 사건도 틱이 다르면 여러 문장을 쓴다', () => {
    const seen = new Set(
      Array.from({ length: 30 }, (_, tick) =>
        commentaryFor({ tick, kind: 'CARD', target: 'MF06' }),
      ),
    )
    expect(seen.size).toBeGreaterThan(1)
  })

  it('선수 이름 대신 등번호만 넣는다', () => {
    expect(commentaryFor({ tick: 100, kind: 'CARD', target: 'MF06' })).toContain('6번')
    const sub = commentaryFor({ tick: 200, kind: 'SUB', target: 'MF17', detail: 'MF06' })
    expect(sub).toContain('17번')
    expect(sub).toContain('6번')
  })

  it('여러 실점 경로가 한 로그에 묶이면 모르는 장면을 꾸며내지 않는다', () => {
    const event: MatchEventLog = {
      tick: 400,
      kind: 'CONCEDE',
      detail: 'BEHIND+OPEN_PLAY',
    }
    expect(commentaryKeyOf(event)).toBe('CONCEDE')
    expect(commentaryFor(event)).toBe('실점. 상대의 마무리를 막지 못했다.')
  })
})
