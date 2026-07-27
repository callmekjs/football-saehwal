import { createRng, type Rng } from './rng'
import { resolveCoefficients } from './tactics'
import { drawTick, resolveAttacks, type TickDraws } from './attack'
import type { Coefficients } from './tactics'
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
    ball: { x: 0.5, y: 0.5, owner: 'HOME', tilt: 0 },
    stats: { homeAttempt: 0, awayAttempt: 0, homeShot: 0, awayShot: 0, setPiece: 0, behind: 0 },
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

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

type Ball = MatchState['ball']

/**
 * 볼의 화면상 위치.
 *
 * 판정에 쓰이지 않는다. 이미 뽑아둔 난수에서 파생하므로 별도로 난수를
 * 소비하지 않고, 따라서 이 함수를 고쳐도 경기 결과가 변하지 않는다.
 *
 * 공을 가진 쪽이 상대 골대 쪽으로 계속 밀고 나가고, 점유가 넘어가면
 * 방향이 뒤집힌다. 공격 시도가 발생한 틱에만 움직이게 하면 그런 틱이
 * 전체의 몇 퍼센트뿐이라 공이 제자리에 서 있는 것처럼 보인다.
 */
function nextBall(
  ball: Ball,
  d: TickDraws,
  c: Coefficients,
  scored: boolean,
  conceded: boolean,
): Ball {
  if (scored) return { x: 0.5, y: 0.5, owner: 'AWAY', tilt: -0.2 }
  if (conceded) return { x: 0.5, y: 0.5, owner: 'HOME', tilt: 0.2 }

  // 점유 전환. 압박이 강하면 우리가 더 자주 뺏고, 상대 진영 깊숙이
  // 들어갈수록 뺏기기 쉽다 — 공이 한쪽에 영원히 머물지 않는다.
  // 전환이 너무 잦으면 공이 가운데서만 왔다갔다 하다 끝난다.
  // 공이 느려진 만큼 점유도 오래 간다. 전환이 잦으면 공이 상대 진영
  // 깊숙이 가보지도 못하고 계속 가운데서만 왔다갔다 한다
  const attacking = ball.owner === 'HOME' ? ball.x : 1 - ball.x
  const turnover = 0.005 + attacking * 0.022
  const bias = ball.owner === 'HOME' ? 1 / c.steal : c.steal
  let owner = ball.owner
  // 골문 앞까지 가면 반드시 끊긴다. 벽에 붙어 멈추는 것을 막는 장치
  if (attacking > 0.88 || d.card < turnover * bias) {
    owner = ball.owner === 'HOME' ? 'AWAY' : 'HOME'
  }

  const dir = owner === 'HOME' ? 1 : -1
  const goal = owner === 'HOME' ? 0.94 : 0.06
  // 골대에 가까워질수록 느려진다.
  //
  // 이 값이 크면 공이 초속 15미터로 달려 선수(초속 7미터)가 영영 못
  // 따라간다. 공만 레일 위를 달리고 사람은 늘 뒤처진 화면이 된다.
  // 경기장을 가로지르는 데 9초쯤 걸리게 잡았다.
  const speed = 0.009 * (0.45 + Math.abs(goal - ball.x))

  // 폭을 벌리면 볼이 좌우로 더 넓게 돈다 — 레버 효과가 눈에 보인다
  const lane = 0.5 + (d.penaltyShot - 0.5) * clamp(c.widthK, 0.5, 1.6)

  // 블록 전체가 옮겨가는 데 걸리는 시간. 0.06이면 약 2초
  const tilt = ball.tilt + ((owner === 'HOME' ? 1 : -1) - ball.tilt) * 0.06

  return {
    owner,
    tilt,
    x: clamp(ball.x + dir * speed + (d.sendOff - 0.5) * 0.004, 0.04, 0.96),
    y: clamp(ball.y + (lane - ball.y) * 0.05, 0.06, 0.94),
  }
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

  const ball = nextBall(state.ball, draws, c, attacks.homeGoals > 0, attacks.awayGoals > 0)

  const s = state.stats
  return {
    ...state,
    tick: state.tick + 1,
    score,
    players,
    ball,
    stats: {
      homeAttempt: s.homeAttempt + attacks.homeAttempt,
      awayAttempt: s.awayAttempt + attacks.awayAttempt,
      homeShot: s.homeShot + attacks.homeShot,
      awayShot: s.awayShot + attacks.awayShot,
      setPiece: s.setPiece + attacks.setPiece,
      behind: s.behind + attacks.behind,
    },
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
