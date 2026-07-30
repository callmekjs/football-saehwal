import { describe, it, expect } from 'vitest'
import { DIFFICULTY, TOTAL_TICKS } from './constants'
import { applyDifficulty, resolveCoefficients } from './tactics'
import { createState, simulate, simulateHalves, carryToNextHalf, tick } from './engine'
import { createRng } from './rng'
import { PROBLEMS } from './problems'
import { DIFFICULTIES, OUR_RANK, difficultyInfo } from '../analysis/difficulty'
import { buildBriefing } from '../analysis/briefing'
import { compareDecisions } from '../analysis/compare'
import type { Difficulty, Level, Tactics } from './types'

const t = (line: Level, press: Level, width: Level): Tactics => ({ line, press, width })
const base = () => resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
const LEVELS: Difficulty[] = ['EASY', 'NORMAL', 'HARD']
const P = PROBLEMS[0]

describe('난이도 계수 — applyDifficulty', () => {
  it('보통은 계수 객체를 그대로 돌려준다', () => {
    /**
     * ★ 이 항등이 깨지면 다섯 국면의 합격 기준선을 처음부터 다시 재야 한다.
     *
     * `toEqual` 이 아니라 **같은 객체인지**(`toBe`)를 본다. 1을 곱하는
     * 새 경로조차 만들지 않아야 기존 시드가 비트 단위로 살아남는다.
     */
    const c = base()
    expect(applyDifficulty(c, 'NORMAL')).toBe(c)
  })

  it('어려움은 상대를 세게, 우리를 약하게 만든다', () => {
    const c = base()
    const hard = applyDifficulty(c, 'HARD')

    // 더 자주 오고 더 잘 넣는다
    expect(hard.behind).toBeGreaterThan(c.behind)
    expect(hard.oppOpen).toBeGreaterThan(c.oppOpen)
    expect(hard.oppShotXg).toBeGreaterThan(c.oppShotXg)
    // 우리 공격은 덜 만들어지고 덜 들어간다
    expect(hard.widthK).toBeLessThan(c.widthK)
    expect(hard.entryXg).toBeLessThan(c.entryXg)
  })

  it('쉬움은 어려움과 정확히 반대 방향이다', () => {
    const c = base()
    const easy = applyDifficulty(c, 'EASY')

    expect(easy.behind).toBeLessThan(c.behind)
    expect(easy.oppOpen).toBeLessThan(c.oppOpen)
    expect(easy.oppShotXg).toBeLessThan(c.oppShotXg)
    expect(easy.widthK).toBeGreaterThan(c.widthK)
    expect(easy.entryXg).toBeGreaterThan(c.entryXg)
  })

  it('세트피스 빈도는 난이도가 건드리지 않는다', () => {
    /**
     * 세트피스를 얼마나 내주는가는 **우리가 라인을 내린 대가**다
     * (`LINE[0].setPiece` = 4.2). 거기에 난이도를 다시 곱하면 이 시뮬레이션의
     * 핵심 축인 라인이 난이도에 먹힌다. 상대가 센 것은 같은 세트피스를
     * **더 잘 넣는 것**으로만 표현한다.
     */
    const c = base()
    for (const level of LEVELS) {
      expect(applyDifficulty(c, level).setPiece).toBe(c.setPiece)
      expect(applyDifficulty(c, level).drain).toBe(c.drain)
      expect(applyDifficulty(c, level).foul).toBe(c.foul)
    }
  })

  it('되돌리는 스위치 — scale 이 0이면 세 난이도가 같아진다', () => {
    /**
     * 밸런스가 흔들리면 `DIFFICULTY.scale` 을 0으로 내린다. 화면의 랭킹
     * 표시와 주장의 설명은 남고 확률만 원래대로 돌아와야 한다.
     * `AWAY_FATIGUE.effect` 와 같은 방식이다.
     *
     * 함정이 하나 있다. 쉬움의 단계는 −1이라 `-1 * 0` 이 **−0** 이 된다.
     * `applyDifficulty` 의 문지기가 `=== 0` 이라 −0도 걸러지지만, 그걸
     * `Object.is` 로 검사하면 −0과 +0이 다른 값으로 잡힌다. 되돌림이
     * 실제로 작동하는 근거는 **`-0 === 0` 이 참**이라는 것이므로 그것을
     * 직접 고정한다.
     */
    for (const level of LEVELS) {
      const stepped = DIFFICULTY.levels[level].step * 0
      expect(stepped === 0).toBe(true)
    }
  })

  it('상대 랭킹은 쉬움일수록 낮고 어려움일수록 높다', () => {
    // 순위 숫자가 작을수록 강팀이다
    expect(DIFFICULTY.levels.EASY.rank).toBeGreaterThan(DIFFICULTY.ourRank)
    expect(DIFFICULTY.levels.HARD.rank).toBeLessThan(DIFFICULTY.ourRank)
    expect(DIFFICULTY.levels.NORMAL.rank).toBeLessThan(DIFFICULTY.levels.EASY.rank)
    expect(DIFFICULTY.levels.NORMAL.rank).toBeGreaterThan(DIFFICULTY.levels.HARD.rank)
  })

  it('한 단계는 상대 쪽을 우리 쪽보다 크게 움직인다', () => {
    // 난이도의 주된 뜻은 "상대가 세다"이고, 우리 쪽 손해는 그 부수 효과다
    expect(DIFFICULTY.step.oppVolume).toBeGreaterThan(DIFFICULTY.step.ourVolume)
    expect(DIFFICULTY.step.oppFinish).toBeGreaterThan(DIFFICULTY.step.ourFinish)
  })
})

describe('난이도와 재현성', () => {
  it('난이도를 안 넘기면 보통이다', () => {
    expect(createState(P).difficulty).toBe('NORMAL')
    expect(simulate(P, []).final.difficulty).toBe('NORMAL')
  })

  it('보통은 난이도 칸이 생기기 전과 같은 경기다', () => {
    // 명시적으로 보통을 넘겨도 기본값과 한 골도 다르지 않아야 한다
    for (let s = 0; s < 40; s++) {
      const p = { ...P, seed: P.seed + s }
      expect(simulate(p, [], 'NORMAL').final.score).toEqual(simulate(p, []).final.score)
    }
  })

  it('난이도는 난수를 하나도 더 쓰지 않는다', () => {
    /**
     * ★ `drawTick()` 의 18슬롯은 순서까지 고정이다. 난이도가 슬롯을 하나라도
     * 더 뽑으면 저장된 모든 시드의 결과가 달라진다.
     *
     * 세 난이도로 750틱을 돌린 뒤 난수 발생기가 **정확히 같은 값**을 다음에
     * 내놓는지 본다. 소비 개수가 다르면 여기서 갈린다.
     */
    const nextAfterFullMatch = (difficulty: Difficulty) => {
      const rng = createRng(P.seed)
      let state = createState(P, difficulty)
      for (let i = 0; i < TOTAL_TICKS; i++) state = tick(state, rng)
      return rng.next()
    }
    const normal = nextAfterFullMatch('NORMAL')
    expect(nextAfterFullMatch('EASY')).toBe(normal)
    expect(nextAfterFullMatch('HARD')).toBe(normal)
  })

  it('같은 난이도와 같은 시드는 언제나 같은 결과를 낸다', () => {
    for (const level of LEVELS) {
      expect(simulate(P, [], level).final.score).toEqual(simulate(P, [], level).final.score)
    }
  })

  it('난이도는 후반으로 그대로 넘어간다', () => {
    for (const level of LEVELS) {
      const halftime = simulate(P, [], level).final
      expect(carryToNextHalf(halftime).difficulty).toBe(level)
      expect(simulateHalves(P, [], [], level).final.difficulty).toBe(level)
    }
  })
})

describe('난이도가 실제 경기 결과를 움직인다', () => {
  /** 같은 시드 묶음으로 세 난이도를 돌려 평균 득실을 잰다 */
  const measure = (difficulty: Difficulty, seeds = 220) => {
    let scored = 0
    let conceded = 0
    let passed = 0
    for (let s = 0; s < seeds; s++) {
      const p = { ...P, seed: P.seed + s }
      const r = simulate(p, [], difficulty)
      scored += r.final.score[0] - p.score[0]
      conceded += r.final.score[1] - p.score[1]
      if (r.passed) passed += 1
    }
    return { scored: scored / seeds, conceded: conceded / seeds, rate: passed / seeds }
  }

  it('어려울수록 더 많이 먹고 덜 넣는다', () => {
    const easy = measure('EASY')
    const normal = measure('NORMAL')
    const hard = measure('HARD')

    expect(easy.conceded).toBeLessThan(normal.conceded)
    expect(normal.conceded).toBeLessThan(hard.conceded)

    expect(easy.scored).toBeGreaterThan(normal.scored)
    expect(normal.scored).toBeGreaterThan(hard.scored)
  })

  it('어려울수록 통과율이 낮다', () => {
    // 세 난이도가 실제로 다른 판이어야 한다. 표시만 바뀌면 설정이 아니라 장식이다
    const easy = measure('EASY')
    const hard = measure('HARD')
    expect(easy.rate).toBeGreaterThan(hard.rate)
  })

  it('쉬움이라도 아무것도 안 하면 대체로 통과하지는 않는다', () => {
    /**
     * **쉬움에는 바닥이 있다.** 무개입 통과율이 60%를 넘으면 감독이 판단할
     * 것이 사라져 "경기 뒤에 전술을 배운다"가 무의미해진다. 어려움에는
     * 이런 상한이 없다 — 어려운 판을 원해서 고른 것이다.
     *
     * 실측으로 쉬움 단계를 −1로 두면 두 국면이 이 선을 넘었다. −0.7로
     * 낮춘 근거가 이 검사다.
     */
    for (const problem of PROBLEMS) {
      let passed = 0
      const seeds = 200
      for (let s = 0; s < seeds; s++) {
        if (simulate({ ...problem, seed: problem.seed + s }, [], 'EASY').passed) passed += 1
      }
      expect(passed / seeds).toBeLessThan(0.65)
    }
  })
})

describe('난이도가 화면과 분석에 그대로 전달된다', () => {
  it('랭킹 표는 확률 상수와 같은 값을 읽는다', () => {
    // 표가 둘이면 화면은 "어려움"인데 주장은 다른 순위를 말하게 된다
    expect(OUR_RANK).toBe(DIFFICULTY.ourRank)
    for (const info of DIFFICULTIES) {
      expect(info.rank).toBe(DIFFICULTY.levels[info.id].rank)
      expect(difficultyInfo(info.id)).toBe(info)
    }
  })

  it('주장은 비슷한 상대일 때 순위를 말하지 않는다', () => {
    // 할 말이 없으면 안 한다. 이 브리핑의 규칙이다
    const problem = PROBLEMS[0]
    const lineIds = (difficulty: Difficulty) => {
      const b = buildBriefing(problem, createState(problem, difficulty))
      return [...b.core, ...b.more].map((l) => l.id)
    }
    expect(lineIds('NORMAL')).not.toContain('rank')
    expect(lineIds('EASY')).toContain('rank')
    expect(lineIds('HARD')).toContain('rank')
  })

  it('주장이 말하는 순위는 실제 설정과 같다', () => {
    const problem = PROBLEMS[0]
    for (const difficulty of ['EASY', 'HARD'] as Difficulty[]) {
      const b = buildBriefing(problem, createState(problem, difficulty))
      const text = [...b.core, ...b.more].find((l) => l.id === 'rank')!.text
      expect(text).toContain(`${difficultyInfo(difficulty).rank}위`)
      expect(text).toContain(`${OUR_RANK}위`)
    }
  })

  it('150판 비교는 사용자가 만난 난이도로 돌아간다', () => {
    /**
     * **이걸 안 맞추면 판단 평가가 통째로 틀린다.** 어려움으로 뛰어놓고
     * 무개입 기준선만 보통에서 재면, 상대가 세서 생긴 차이가 감독의 판단
     * 탓으로 찍혀 "무개입보다 못했다"는 거짓 결론이 나온다.
     */
    const problem = PROBLEMS[0]
    const runs = 40
    const rateOf = (difficulty: Difficulty) =>
      compareDecisions(problem, [], runs, 70, null, difficulty).rows.find((r) => r.key === 'noop')!
        .rate

    expect(rateOf('EASY')).toBeGreaterThan(rateOf('HARD'))
    // 기본값은 보통이다
    expect(compareDecisions(problem, [], runs).rows[0].rate).toBe(rateOf('NORMAL'))
  })
})
