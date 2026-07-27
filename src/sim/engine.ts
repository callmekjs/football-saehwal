import { createRng, type Rng } from './rng'
import { resolveCoefficients } from './tactics'
import { drawTick, resolveAttacks } from './attack'
import { drainTick, effectiveFactor } from './stamina'
import { TOTAL_TICKS } from './constants'
import type { Decision, MatchState, Mentality, Problem } from './types'

/**
 * 상대 성향을 스코어에서 도출한다.
 *
 * 국면 데이터에 고정값으로 두면 경기 중 스코어가 바뀌어도 상대가
 * 그대로여서, 이기고 있던 팀이 동점을 허용하고도 계속 내려앉아 있게 된다.
 */
export function mentalityOf(score: [number, number]): Mentality {
  const diff = score[1] - score[0]
  if (diff < 0) return 'ALL_OUT'
  if (diff > 0) return 'PARK_BUS'
  return 'BALANCED'
}

export function createState(problem: Problem): MatchState {
  return {
    tick: 0,
    score: [...problem.score] as [number, number],
    // 앞 감독이 걸어놓은 지시를 그대로 물려받는다
    tactics: { ...problem.initialTactics },
    stamina: { ...problem.startStamina },
    opponent: mentalityOf(problem.score),
    homeCount: problem.homeCount,
    awayCount: problem.awayCount,
  }
}

function meanStamina(stamina: Record<string, number>): number {
  const values = Object.values(stamina)
  if (values.length === 0) return 100
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function tick(state: MatchState, problem: Problem, rng: Rng): MatchState {
  const c = resolveCoefficients(state.tactics, state.opponent, state.awayCount < 11)
  const next: MatchState = {
    ...state,
    score: [...state.score] as [number, number],
    stamina: { ...state.stamina },
  }

  for (const id of Object.keys(next.stamina)) {
    next.stamina[id] = drainTick(next.stamina[id], c.drain)
  }

  const homeFactor = effectiveFactor(meanStamina(next.stamina))
  const { homeGoals, awayGoals } = resolveAttacks(
    drawTick(rng),
    c,
    homeFactor,
    problem.minDefenderSpeed,
  )

  next.score[0] += homeGoals
  next.score[1] += awayGoals
  if (homeGoals || awayGoals) next.opponent = mentalityOf(next.score)
  next.tick = state.tick + 1
  return next
}

/**
 * 목표 달성 판정.
 *
 * SURVIVE 는 리드를 "지키는" 것이므로 동점을 허용하면 실패다. 1-0으로
 * 이기다 1-1이 되면 리드를 지킨 것이 아니다. 두 목표를 같은 조건으로
 * 뭉개면 1골 차 리드가 완충재로 작용해 무개입 통과율이 77%까지 올라가고
 * 국면이 퍼즐로 성립하지 않는다.
 *
 * EQUALIZE 는 쫓아가는 상황이므로 무승부부터 통과다.
 */
function judge(state: MatchState, objective: Problem['objective']): boolean {
  const [home, away] = state.score
  return objective.type === 'SURVIVE' ? home > away : home >= away
}

export function simulate(
  problem: Problem,
  decisions: Decision[],
): { final: MatchState; passed: boolean } {
  const rng = createRng(problem.seed)
  let state = createState(problem)

  const byTick = new Map<number, Decision[]>()
  for (const d of decisions) {
    const list = byTick.get(d.tick) ?? []
    list.push(d)
    byTick.set(d.tick, list)
  }

  for (let i = 0; i < TOTAL_TICKS; i++) {
    for (const d of byTick.get(i) ?? []) {
      if (d.type === 'LINE') state.tactics.line = d.value
      else if (d.type === 'PRESS') state.tactics.press = d.value
      else state.tactics.width = d.value
    }
    state = tick(state, problem, rng)
  }

  return { final: state, passed: judge(state, problem.objective) }
}
