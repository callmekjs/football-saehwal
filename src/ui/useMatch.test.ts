import { describe, expect, it } from 'vitest'
import { createState, simulate, tick } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { createRng } from '../sim/rng'
import { TOTAL_TICKS } from '../sim/constants'
import { effectivePos } from '../sim/squad'
import type { Decision, MatchState } from '../sim/types'
import { catchUp, changeFormation, changePosition, openForOrders, targetTick } from './useMatch'

const problem = PROBLEMS.find((entry) => entry.id === 'p02')!

/**
 * 절대 시각과 조작 시점 — QA-31.
 *
 * 탭을 숨겼다 돌아오면 화면이 뒤처진 채로 조작이 열려 있어, 이미 현실에서
 * 지나간 구간에 지시가 소급 적용됐다. 여기서 지키는 것은 하나다 —
 * **지시는 언제나 지금 이후에만 걸린다.**
 */
describe('절대 시각과 조작 시점', () => {
  /** 화면이 뒤처진 상태를 만든다. 숨긴 탭에서 돌아온 직후가 이 모습이다 */
  const runTo = (state: MatchState, rng: ReturnType<typeof createRng>, to: number) => {
    let next = state
    while (next.tick < to) next = tick(next, rng)
    return next
  }
  /** `useMatch.setLever` 가 상태에 하는 일과 같은 모양 */
  const pullLever = (state: MatchState): MatchState => ({
    ...state,
    tactics: { ...state.tactics, line: state.tactics.line === 0 ? 2 : 0 },
  })
  /** 옛 방식이 한 회에 따라잡던 양 */
  const OLD_CAP = 60

  it('목표 틱은 흐른 실제 시간이 정하고 경기 길이를 넘지 않는다', () => {
    expect(targetTick(0)).toBe(0)
    expect(targetTick(-1000)).toBe(0)
    expect(targetTick(Number.NaN)).toBe(0)
    expect(targetTick(20_000)).toBeGreaterThan(targetTick(10_000))
    expect(targetTick(10_000)).toBeGreaterThan(0)
    // 시계가 아무리 오래 밀려 있어도 경기보다 길어지지는 않는다
    expect(targetTick(60 * 60 * 1000)).toBe(TOTAL_TICKS)
  })

  it('따라잡기는 한 번에 끝까지 간다 — 옛 60틱에서 끊기지 않는다', () => {
    const rng = createRng(problem.seed)
    const caught = catchUp(createState(problem), rng, TOTAL_TICKS)
    expect(caught.tick).toBe(TOTAL_TICKS)
    expect(caught.tick).toBeGreaterThan(OLD_CAP)
  })

  it('밀린 화면에 들어온 지시는 이미 지나간 틱에 걸리지 않는다', () => {
    const hiddenMs = 20_000
    const target = targetTick(hiddenMs)
    let stalePastChanged = 0
    let syncedPastChanged = 0

    for (let i = 0; i < 30; i += 1) {
      const p = { ...problem, seed: 5100 + i }

      // 기준 — 절대 시각의 목표 틱까지 간 상태. 여기가 「지금」이다
      const refRng = createRng(p.seed)
      const reference = JSON.stringify(runTo(createState(p), refRng, target))

      // 옛 방식 — 60틱만 따라잡은 낡은 상태에 그대로 걸고 목표까지 간다
      const staleRng = createRng(p.seed)
      const lagged = runTo(createState(p), staleRng, OLD_CAP)
      const stale = runTo(pullLever(lagged), staleRng, target)
      if (JSON.stringify(stale) !== reference) stalePastChanged += 1

      // 지금 방식 — 같은 낡은 상태에서 조작이 들어온다
      const syncRng = createRng(p.seed)
      const opened = openForOrders(runTo(createState(p), syncRng, OLD_CAP), syncRng, hiddenMs)
      expect(opened.state.tick).toBe(target)
      if (JSON.stringify(opened.state) !== reference) syncedPastChanged += 1
    }

    // 옛 방식이 과거를 바꾼다는 것 자체가 이 검사가 살아 있다는 증거다
    expect(stalePastChanged).toBeGreaterThan(0)
    expect(syncedPastChanged).toBe(0)
  })

  it('실제 시각으로 끝난 경기는 사유를 돌려주고 지시를 받지 않는다', () => {
    const rng = createRng(problem.seed)
    const lagged = runTo(createState(problem), rng, OLD_CAP)
    // 화면은 아직 6초를 보여주지만 실제로는 75초가 다 갔다
    const opened = openForOrders(lagged, rng, TOTAL_TICKS * 1000)
    expect(opened.state.tick).toBe(TOTAL_TICKS)
    expect(opened.reason).toBeTruthy()
    expect(opened.reason).toMatch(/휘슬/)
  })

  it('따라잡기 자체는 경기를 바꾸지 않는다 — 나눠 돌린 것과 같은 결과', () => {
    for (let i = 0; i < 20; i += 1) {
      const p = { ...problem, seed: 5200 + i }

      const wholeRng = createRng(p.seed)
      const whole = catchUp(createState(p), wholeRng, TOTAL_TICKS)

      const splitRng = createRng(p.seed)
      let split = createState(p)
      while (split.tick < TOTAL_TICKS) {
        split = catchUp(split, splitRng, Math.min(TOTAL_TICKS, split.tick + OLD_CAP))
      }

      expect(JSON.stringify(split)).toBe(JSON.stringify(whole))
    }
  })

  it('정상적으로 보고 있는 감독은 막히지 않는다', () => {
    const nowMs = 30_000
    for (const lagTicks of [0, 1, 2]) {
      const p = { ...problem, seed: 5300 + lagTicks }
      const rng = createRng(p.seed)
      const shown = runTo(createState(p), rng, targetTick(nowMs) - lagTicks)
      const opened = openForOrders(shown, rng, nowMs)

      expect(opened.reason).toBeNull()
      // 따라잡아도 화면이 뒤처졌던 만큼만 움직인다
      expect(opened.state.tick).toBe(targetTick(nowMs))
    }
  })
})

describe('포메이션 변경', () => {
  it('4-4-2에서 올라간 선수를 풀고 5-4-1을 새 모양 그대로 세운다', () => {
    const base = createState(problem)
    const state = {
      ...base,
      players: base.players.map((player) => {
        if (player.id === 'MF06') return { ...player, order: 'PUSH_UP' as const }
        if (player.id === 'DF04') {
          return { ...player, order: 'HOLD' as const, position: { x: 24, y: 12 } }
        }
        if (player.id === 'MF07') return { ...player, order: 'CONSERVE' as const }
        return player
      }),
    }
    const changed = changeFormation(state, '5-4-1')

    expect(changed.next.formation).toBe('5-4-1')
    expect(changed.next.players.find((player) => player.id === 'MF06')?.order).toBe('NONE')
    expect(changed.next.players.find((player) => player.id === 'DF04')?.order).toBe('HOLD')
    expect(changed.next.players.find((player) => player.id === 'DF04')?.position).toBeNull()
    expect(changed.next.players.find((player) => player.id === 'MF07')?.order).toBe('CONSERVE')
    expect(changed.records).toContainEqual({ type: 'FORMATION', value: '5-4-1' })
    expect(changed.records).toContainEqual({
      type: 'ORDER',
      target: 'MF06',
      order: 'NONE',
    })
  })

  it('자동 해제도 결정 이력으로 재현된다', () => {
    const base = createState(problem)
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === 'MF06'
          ? { ...player, order: 'PUSH_UP' as const, position: { x: 58, y: 18 } }
          : player,
      ),
    }
    const changed = changeFormation(state, '5-4-1')
    const decisions = changed.records.map((record) => ({ ...record, tick: 0 })) as Decision[]
    const replay = simulate(
      {
        ...problem,
        initialFormation: state.formation,
        variation: undefined,
      },
      [
        { tick: 0, type: 'POSITION', target: 'MF06', position: { x: 58, y: 18 } },
        { tick: 0, type: 'ORDER', target: 'MF06', order: 'PUSH_UP' },
        ...decisions,
      ],
    )
    expect(replay.final.formation).toBe(changed.next.formation)
    expect(replay.final.players.find((player) => player.id === 'MF06')?.order).toBe('NONE')
    expect(replay.final.players.find((player) => player.id === 'MF06')?.position).toBeNull()
  })
})

describe('자유 위치 결정', () => {
  it('실제 좌표를 저장하고 POSITION 결정으로 기록하며 앞뒤 줄 지시를 푼다', () => {
    const base = createState(problem)
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === 'MF06' ? { ...player, order: 'PUSH_UP' as const } : player,
      ),
    }
    const changed = changePosition(state, 'MF06', { x: 58, y: 12 })

    expect(changed.error).toBeNull()
    expect(changed.record).toEqual({
      type: 'POSITION',
      target: 'MF06',
      position: { x: 58, y: 12 },
    })
    expect(changed.next.players.find((player) => player.id === 'MF06')).toMatchObject({
      order: 'NONE',
      position: { x: 58, y: 12 },
    })
  })

  it('기본 자리로 돌리는 것도 POSITION null 결정으로 남는다', () => {
    const base = createState(problem)
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.id === 'MF06' ? { ...player, position: { x: 60, y: 20 } } : player,
      ),
    }
    const changed = changePosition(state, 'MF06', null)
    expect(changed.error).toBeNull()
    expect(changed.record).toEqual({
      type: 'POSITION',
      target: 'MF06',
      position: null,
    })
    expect(changed.next.players.find((player) => player.id === 'MF06')?.position).toBeNull()
  })

  it('골키퍼 이동과 수비 셋 아래 이동은 엔진의 한국어 사유로 막는다', () => {
    const goalkeeper = changePosition(createState(problem), 'GK01', { x: 30, y: 34 })
    expect(goalkeeper.error).toBe('골키퍼는 자리를 옮길 수 없습니다')

    const shortProblem = PROBLEMS.find((entry) => entry.id === 'p03')!
    const rolled = createState(shortProblem)
    /**
     * 앞 감독이 걸어둔 지시를 걷어내고 시작한다.
     *
     * 지시는 판마다 다른 선수에게 걸리고 `PUSH_UP` 하나면 수비수가
     * 앞선으로 세어져 인원이 흔들린다. 여기서 볼 것은 그 무작위가 아니라
     * **수비가 셋일 때 한 명 더 빼는 이동을 막는가**다.
     */
    const shortBase = {
      ...rolled,
      players: rolled.players.map((player) => ({
        ...player,
        order: 'NONE' as const,
        position: null,
      })),
    }
    const defenders = shortBase.players.filter(
      (player) => player.onPitch && !player.out && effectivePos(player) === 'DF',
    )
    // 정확히 셋만 남긴다. 국면이 몇을 세우고 있든 같은 조건을 만든다
    const removedIds = new Set(defenders.slice(3).map((player) => player.id))
    const short = {
      ...shortBase,
      players: shortBase.players.map((player) =>
        removedIds.has(player.id) ? { ...player, onPitch: false, out: true } : player,
      ),
    }
    expect(
      short.players.filter(
        (player) => player.onPitch && !player.out && effectivePos(player) === 'DF',
      ),
    ).toHaveLength(3)
    const defender = short.players.find(
      (player) =>
        player.onPitch &&
        !player.out &&
        effectivePos(player) === 'DF',
    )!
    const tooHigh = changePosition(short, defender.id, { x: 80, y: 34 })
    expect(tooHigh.error).toBe('뒤에는 수비수가 적어도 세 명 남아야 합니다')
    expect(tooHigh.record).toBeNull()
    expect(tooHigh.next).toBe(short)
  })

  it('POSITION 결정은 종료 분석 재현에서도 같은 좌표가 된다', () => {
    const replay = simulate(
      {
        ...problem,
        variation: undefined,
      },
      [{ tick: 0, type: 'POSITION', target: 'MF06', position: { x: 62, y: 18 } }],
    )
    expect(replay.final.players.find((player) => player.id === 'MF06')?.position).toEqual({
      x: 62,
      y: 18,
    })
  })
})
