import { createRng, type Rng } from './rng'
import { resolveCoefficients } from './tactics'
import { drawTick, resolveAttacks } from './attack'
import { resolveEvents } from './events'
import { drainTick, effectiveFactor } from './stamina'
import {
  bestFinishing,
  getPlayer,
  initialPlayers,
  meanStamina,
  minDefenderSpeed,
  onPitchCount,
} from './squad'
import { EVENTS, TOTAL_TICKS } from './constants'
import type { Decision, MatchState, Mentality, PlayerState, Problem } from './types'

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
  const players = initialPlayers(problem)
  return {
    tick: 0,
    score: [...problem.score] as [number, number],
    // 앞 감독이 걸어놓은 지시를 그대로 물려받는다
    tactics: { ...problem.initialTactics },
    formation: problem.initialFormation,
    players,
    opponent: mentalityOf(problem.score),
    homeCount: onPitchCount(players),
    awayCount: problem.awayCount,
    subsLeft: problem.subsLeft,
    pendingSubs: [],
    log: [],
  }
}

/** 교체가 유효한지. 무효면 사유를 돌려준다 */
export function checkSub(state: MatchState, out: string, inId: string): string | null {
  if (state.subsLeft <= 0) return '남은 교체 카드가 없다'
  const o = state.players.find((s) => s.id === out)
  const i = state.players.find((s) => s.id === inId)
  if (!o) return `${out} 은 명단에 없다`
  if (!i) return `${inId} 은 명단에 없다`
  if (!o.onPitch || o.out) return `${out} 은 이미 피치 밖이다`
  if (i.onPitch || i.out) return `${inId} 은 투입할 수 없다`
  if (state.pendingSubs.some((p) => p.out === out || p.in === inId)) return '이미 대기 중이다'
  return null
}

function applySub(players: PlayerState[], out: string, inId: string): PlayerState[] {
  return players.map((s) => {
    if (s.id === out) return { ...s, onPitch: false }
    if (s.id === inId) return { ...s, onPitch: true }
    return s
  })
}

export function tick(state: MatchState, rng: Rng): MatchState {
  const c = resolveCoefficients(
    state.tactics,
    state.opponent,
    state.awayCount < 11,
    state.homeCount < 11,
    state.formation,
  )

  let players = state.players.map((s) =>
    s.onPitch && !s.out ? { ...s, stamina: drainTick(s.stamina, c.drain) } : s,
  )
  const log = [...state.log]
  let score: [number, number] = [...state.score] as [number, number]

  // 대기 중인 교체가 반영될 시점인지
  const stillPending = []
  for (const p of state.pendingSubs) {
    if (p.atTick <= state.tick) {
      players = applySub(players, p.out, p.in)
      log.push({ tick: state.tick, kind: 'SUB', target: p.in, detail: p.out })
    } else {
      stillPending.push(p)
    }
  }

  const draws = drawTick(rng)

  // 능력치를 명단에서 읽는다. 수비수가 교체되면 배후 실점 확률이 즉시 바뀐다
  const homeFactor = effectiveFactor(meanStamina(players)) * bestFinishing(players)
  const attacks = resolveAttacks(draws, c, homeFactor, minDefenderSpeed(players))

  const ev = resolveEvents(draws, c, players, state.tactics.press, state.tick)

  if (ev.booked) {
    players = players.map((s) => (s.id === ev.booked ? { ...s, booked: true } : s))
  }
  if (ev.removed) {
    players = players.map((s) => (s.id === ev.removed ? { ...s, onPitch: false, out: true } : s))
  }
  for (const e of ev.events) log.push({ tick: e.tick, kind: e.kind, target: e.target })

  score[0] += attacks.homeGoals
  score[1] += attacks.awayGoals + ev.awayGoals
  if (attacks.homeGoals) log.push({ tick: state.tick, kind: 'GOAL' })
  if (attacks.awayGoals) log.push({ tick: state.tick, kind: 'CONCEDE' })

  return {
    ...state,
    tick: state.tick + 1,
    score,
    players,
    log,
    pendingSubs: stillPending,
    homeCount: onPitchCount(players),
    // 부상은 계획에 없던 교체를 강제한다. 남은 카드가 줄어든다
    subsLeft: ev.forcedSub ? Math.max(0, state.subsLeft - 1) : state.subsLeft,
    opponent:
      attacks.homeGoals || attacks.awayGoals || ev.awayGoals ? mentalityOf(score) : state.opponent,
  }
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
      if (d.type === 'SUB') {
        // 교체는 즉시 반영되지 않는다. 늦게 쓰면 늦게 듣는다
        if (checkSub(state, d.out, d.in) === null) {
          state = {
            ...state,
            subsLeft: state.subsLeft - 1,
            pendingSubs: [
              ...state.pendingSubs,
              { out: d.out, in: d.in, atTick: i + EVENTS.subDelayTicks },
            ],
          }
        }
      } else if (d.type === 'FORMATION') state = { ...state, formation: d.value }
      else if (d.type === 'LINE') state.tactics.line = d.value
      else if (d.type === 'PRESS') state.tactics.press = d.value
      else state.tactics.width = d.value
    }
    state = tick(state, rng)
  }

  return { final: state, passed: judge(state, problem.objective) }
}

/** 화면과 분석이 쓰는 조회 함수 */
export function playerOnPitch(state: MatchState, id: string): boolean {
  const s = state.players.find((p) => p.id === id)
  return !!s && s.onPitch && !s.out
}

export { getPlayer }
