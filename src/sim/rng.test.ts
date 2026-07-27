import { describe, it, expect } from 'vitest'
import { createRng, createStreams } from './rng'

describe('createRng', () => {
  it('같은 시드는 같은 수열을 낸다', () => {
    const a = createRng(40712)
    const b = createRng(40712)
    const seqA = Array.from({ length: 100 }, () => a.next())
    const seqB = Array.from({ length: 100 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('다른 시드는 다른 수열을 낸다', () => {
    const a = createRng(40712)
    const b = createRng(40713)
    expect(a.next()).not.toEqual(b.next())
  })

  it('0 이상 1 미만을 낸다', () => {
    const r = createRng(1)
    for (let i = 0; i < 1000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('충분히 고르게 분포한다', () => {
    const r = createRng(7)
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < 100_000; i++) buckets[Math.floor(r.next() * 10)]++
    for (const b of buckets) expect(b).toBeGreaterThan(9_000)
  })
})

describe('createStreams', () => {
  it('경기용과 연출용이 서로 다른 수열을 낸다', () => {
    const { match, visual } = createStreams(40712)
    expect(match.next()).not.toEqual(visual.next())
  })

  it('연출용을 아무리 소비해도 경기용이 변하지 않는다', () => {
    const s1 = createStreams(40712)
    const s2 = createStreams(40712)
    for (let i = 0; i < 500; i++) s2.visual.next()
    expect(s1.match.next()).toEqual(s2.match.next())
  })
})
