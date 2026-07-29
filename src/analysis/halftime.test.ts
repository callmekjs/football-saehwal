import { describe, it, expect } from 'vitest'
import { buildHalftime } from './halftime'
import { createState, tick } from '../sim/engine'
import { createRng } from '../sim/rng'
import { TOTAL_TICKS } from '../sim/constants'
import { getPlayer } from '../sim/squad'
import raw from '../data/problems.json' with { type: 'json' }
import { toProblem } from '../sim/problems'
import type { MatchState, Problem } from '../sim/types'

const PROBLEMS = raw.map(toProblem).sort((a, b) => a.order - b.order)
const FIRST_HALF = PROBLEMS.filter((p) => p.half === 1)

/** 한 국면을 끝까지 돌려 하프타임 상태를 만든다 */
function playOut(problem: Problem): MatchState {
  const rng = createRng(problem.seed)
  let s = createState(problem)
  for (let i = 0; i < TOTAL_TICKS; i++) s = tick(s, rng)
  return s
}

describe('하프타임 주장 정리', () => {
  it('전반 국면이 실제로 있다', () => {
    expect(FIRST_HALF.length).toBeGreaterThan(0)
  })

  it('전반이 끝나면 몇 대 몇으로 마쳤는지 말한다', () => {
    for (const problem of FIRST_HALF) {
      const s = playOut(problem)
      const h = buildHalftime(problem, s)
      expect(h.headline).toContain('전반을')
      expect(h.headline).toContain(`${s.score[0]} 대 ${s.score[1]}`)
    }
  })

  it('말하는 사람은 피치 위 필드 플레이어 중 등번호가 가장 작다', () => {
    // 급수 타임 브리핑과 같은 규칙이어야 둘이 다른 사람이 말하지 않는다
    for (const problem of FIRST_HALF) {
      const s = playOut(problem)
      const h = buildHalftime(problem, s)
      const nums = s.players
        .filter((p) => p.onPitch && !p.out)
        .map((p) => getPlayer(p.id))
        .filter((p) => p.pos !== 'GK')
        .map((p) => p.num)
      expect(h.speaker).toBe(Math.min(...nums))
    }
  })

  it('실제 기록에 있는 숫자만 말한다', () => {
    /**
     * 지어낸 사실이 한 줄이라도 있으면 이 화면 전체를 믿을 수 없게 된다.
     * 슈팅·세트피스·배후는 전부 `state.stats` 에서 나와야 한다
     */
    for (const problem of FIRST_HALF) {
      const s = playOut(problem)
      const h = buildHalftime(problem, s)
      const shots = h.lines.find((l) => l.id === 'shots')
      if (shots) {
        expect(shots.text).toContain(`우리 ${s.stats.homeShot}`)
        expect(shots.text).toContain(`상대 ${s.stats.awayShot}`)
      }
      const sp = h.lines.find((l) => l.id === 'setpiece')
      if (sp) expect(sp.text).toContain(String(s.stats.setPiece))
      const subs = h.lines.find((l) => l.id === 'subs')
      expect(subs).toBeDefined()
      if (s.subsLeft > 0) expect(subs!.text).toContain(String(s.subsLeft))
    }
  })

  it('해당 없는 항목은 아예 말하지 않는다', () => {
    // 세트피스를 한 번도 안 내줬으면 세트피스 이야기가 없어야 한다
    for (const problem of FIRST_HALF) {
      const s = playOut(problem)
      const h = buildHalftime(problem, s)
      if (s.stats.setPiece === 0) {
        expect(h.lines.some((l) => l.id === 'setpiece')).toBe(false)
      }
      if (s.stats.behind === 0) {
        expect(h.lines.some((l) => l.id === 'behind')).toBe(false)
      }
      const anyBooked = s.players.some((p) => p.onPitch && !p.out && p.booked)
      if (!anyBooked) expect(h.lines.some((l) => l.id === 'booked')).toBe(false)
    }
  })

  it('명령형으로 지시하지 않는다', () => {
    /**
     * 주장은 상황을 전할 뿐 답을 주지 않는다. 판단은 감독이 한다.
     * 다음에 뭘 하라는 처방은 경기가 끝난 뒤 감독 보고서가 맡는다
     */
    const 명령 = ['하세요', '하십시오', '바꾸세요', '올리세요', '내리세요', '넣으세요', '빼세요']
    for (const problem of FIRST_HALF) {
      const s = playOut(problem)
      const h = buildHalftime(problem, s)
      for (const l of h.lines) {
        for (const word of 명령) {
          expect(l.text, `${problem.id} / ${l.id}`).not.toContain(word)
        }
      }
    }
  })

  it('같은 시드는 같은 정리를 만든다', () => {
    for (const problem of FIRST_HALF) {
      const a = buildHalftime(problem, playOut(problem))
      const b = buildHalftime(problem, playOut(problem))
      expect(a).toEqual(b)
    }
  })

  it('쫓는 판에서 못 따라잡으면 몇 골 모자란지 말한다', () => {
    const problem = FIRST_HALF.find((p) => p.objective.type === 'EQUALIZE')
    expect(problem).toBeDefined()
    const s = playOut(problem!)
    const h = buildHalftime(problem!, s)
    const goal = h.lines.find((l) => l.id === 'goal')
    expect(goal).toBeDefined()
    if (s.score[0] < s.score[1]) {
      expect(goal!.text).toContain(`${s.score[1] - s.score[0]}골`)
      expect(goal!.tone).toBe('BAD')
    }
  })
})
