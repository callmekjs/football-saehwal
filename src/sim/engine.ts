import { createRng, type Rng } from './rng'
import { applyOrders, applyPositions, drainFactorOf, resolveCoefficients } from './tactics'
import { drawTick, resolveAttacks, type TickDraws } from './attack'
import type { Coefficients } from './tactics'
import { resolveEvents } from './events'
import { drainTick, effectiveFactor } from './stamina'
import {
  bestFinishing,
  effectivePos,
  getPlayer,
  initialPlayers,
  meanStamina,
  minDefenderSpeed,
  onPitchCount,
} from './squad'
import { rollSetup } from './setup'
import { EVENTS, FREE_POSITION, TOTAL_TICKS } from './constants'
import type {
  Decision,
  MatchState,
  Mentality,
  PlayerOrder,
  PlayerPosition,
  PlayerState,
  Problem,
} from './types'

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
  /**
   * 시작 조건은 국면 시드에서 뽑는다.
   *
   * 경기용 난수와 **분리된 스트림**을 쓰고 여기서 한 번만 소비한다.
   * 매 틱 18개를 뽑는 `drawTick()` 의 수열은 한 톨도 안 바뀐다.
   */
  const rolled = rollSetup(problem, initialPlayers(problem))
  const players = rolled.players
  return {
    tick: 0,
    score: [...problem.score] as [number, number],
    // 앞 감독이 걸어놓은 지시를 그대로 물려받는다
    tactics: rolled.tactics,
    captainEffect: rolled.captainEffect,
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
  // 골키퍼를 필드 플레이어로 바꾸면 골문이 빈다. 벤치에 백업 골키퍼가
  // 없으므로 되돌릴 방법도 없다. 규칙상 존재할 수 없는 수를 화면이
  // 허용하면 그건 선택지가 아니라 함정이다.
  if (getPlayer(out).pos === 'GK' && getPlayer(inId).pos !== 'GK') {
    return '골키퍼는 골키퍼로만 교체할 수 있다'
  }
  return null
}

function applySub(players: PlayerState[], out: string, inId: string): PlayerState[] {
  return players.map((s) => {
    // 나간 선수의 지시는 함께 걷힌다. 들어온 선수는 지시 없이 시작한다 —
    // 안 그러면 벤치에 앉아 있던 선수에게 유령 지시가 붙어 들어온다
    if (s.id === out) {
      return { ...s, onPitch: false, order: 'NONE' as const, position: null }
    }
    if (s.id === inId) {
      return { ...s, onPitch: true, order: 'NONE' as const, position: null }
    }
    return s
  })
}

/**
 * 개별 지시를 건다.
 *
 * 처음에는 세 명으로 묶어뒀다. "상한이 없으면 킥오프에 전부 걸어놓고 끝이라
 * 조작이 아니라 세팅이 된다"는 이유였다. **재보니 틀렸다.**
 *
 * 시드 1200개로 지시 인원을 3·5·8·10명으로 늘려가며 쟀다.
 *
 * | 지시 | 잠긴 문 (지키기) | 길이 막혔다 (쫓기) |
 * |---|---|---|
 * | 내려서라 | 3명 +6.4 → 5명 +9.5 → **10명 +7.9** (5명에서 꺾인다) | 10명 **−5.5** |
 * | 아껴 뛰어라 | 몇 명을 걸든 ±0.3 안 | ±0.3 안 |
 * | 골문 앞 | 3명 +12.1 → **10명 +29.1** (끝없이 커진다) | 10명 −3.2 |
 *
 * **내려서라는 다섯 명에서 꺾이고 아껴 뛰어라는 아예 평평하다.** 다 걸어봐야
 * 좋아지지 않으니 상한이 필요 없다. 게다가 쫓는 판에서는 전부 손해다 —
 * 국면에 따라 부호가 갈리므로 "다 거는 것"이 무뇌 정답이 되지 않는다.
 *
 * **끝없이 커지는 것은 `HOLD` 하나뿐이고, 그건 아래에서 따로 두 명으로 막는다.**
 * 그 하나만 막으면 나머지는 열어둬도 안전하다.
 *
 * 그래서 상한을 필드 플레이어 전원으로 연다. 골키퍼는 지시를 못 받으므로
 * 실질 상한은 열 명이다.
 */
export const MAX_ORDERS = 10

/**
 * `HOLD` 만은 두 명까지다.
 *
 * 이것만 인원에 비례해 끝없이 세진다 — 지키는 두 국면에서 열 명을 세우면
 * 통과율이 각각 **+29.1%p · +35.9%p** 오른다. 47.8% 국면이 76.8%가 되고
 * 37.2% 국면이 73.1%가 된다. 막지 않으면 "전원 골문 앞"이 지배 전략이 되어
 * 판단할 것이 사라진다.
 */
export const MAX_HOLD = 2

const movesLine = (order: PlayerOrder): boolean =>
  order === 'DROP_BACK' || order === 'PUSH_UP'

/**
 * 자유 배치가 유효한지 검사한다. 무효면 화면에 그대로 보여줄 사유를 돌려준다.
 *
 * 골키퍼는 골문 앞의 기하 규칙을 따라야 하므로 직접 옮기지 못한다. 필드
 * 선수도 수비 자원을 셋 아래로 줄이는 이동은 막는다. 좌표를 지우는 null 은
 * 포메이션 기본 자리로 돌아가라는 뜻이다.
 */
export function checkPosition(
  state: MatchState,
  target: string,
  position: PlayerPosition | null,
): string | null {
  const player = state.players.find((s) => s.id === target)
  if (!player) return `${target} 은 명단에 없다`
  if (!player.onPitch || player.out) return '피치 위 선수가 아니다'

  const registered = getPlayer(target).pos
  if (registered === 'GK') {
    return position === null ? null : '골키퍼는 자리를 옮길 수 없다'
  }

  if (position) {
    const pitch = FREE_POSITION.pitch
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      position.x < pitch.minX ||
      position.x > pitch.maxX ||
      position.y < pitch.minY ||
      position.y > pitch.maxY
    ) {
      return '경기장 안에 놓아야 한다'
    }
  }

  const next: PlayerState = {
    ...player,
    position,
    order: movesLine(player.order) ? 'NONE' : player.order,
  }
  if (effectivePos(player) === 'DF' && effectivePos(next) !== 'DF') {
    const remaining = state.players.filter(
      (s) => s.onPitch && !s.out && s.id !== target && effectivePos(s) === 'DF',
    )
    if (remaining.length < FREE_POSITION.rules.minDefenders) {
      return '뒤에 수비가 셋은 남아야 한다'
    }
  }
  return null
}

export function checkOrder(
  state: MatchState,
  target: string,
  order: PlayerOrder,
): string | null {
  const p = state.players.find((s) => s.id === target)
  if (!p) return `${target} 은 명단에 없다`
  if (!p.onPitch || p.out) return '피치 위 선수가 아니다'
  if (p.order === order) return null
  if (order === 'NONE') return null

  const active = state.players.filter((s) => s.onPitch && !s.out && s.order !== 'NONE')
  if (p.order === 'NONE' && active.length >= MAX_ORDERS) {
    return `지시는 ${MAX_ORDERS}명까지다. 하나를 풀어라`
  }
  const registered = getPlayer(target).pos
  if (registered === 'GK') return '골키퍼에게는 지시할 수 없다'
  const pos = effectivePos(p)

  if (order === 'HOLD') {
    if (pos !== 'DF' && pos !== 'MF') return '골문 앞은 수비수와 미드필더만'
    const holding = active.filter((s) => s.order === 'HOLD' && s.id !== target)
    if (holding.length >= MAX_HOLD) return `골문 앞은 ${MAX_HOLD}명까지다`
  }
  // 이미 그 줄에 서 있는 선수에게 그리로 가라고 할 수는 없다
  if (order === 'DROP_BACK' && pos === 'DF') return '이미 수비수다'
  if (order === 'PUSH_UP' && pos === 'FW') return '이미 공격수다'

  // 수비 자원을 전부 앞으로 올리면 배후가 통째로 빈다. 실점 공식이
  // "수비수가 없으면 최악값"으로 떨어져 한 번의 조작으로 판이 끝난다
  if (order === 'PUSH_UP') {
    const backs = state.players.filter(
      (s) => s.onPitch && !s.out && s.id !== target && effectivePos(s) === 'DF',
    )
    if (backs.length < FREE_POSITION.rules.minDefenders) {
      return '뒤에 수비가 셋은 남아야 한다'
    }
  }
  return null
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
  // 레버가 정한 계수 위에 개별 지시를 얹는다.
  // 지시가 하나도 없으면 `applyOrders` 는 항등이라 계수가 그대로 나간다
  const c = applyPositions(
    applyOrders(
      resolveCoefficients(
        state.tactics,
        state.opponent,
        state.awayCount < 11,
        state.homeCount < 11,
        state.formation,
      ),
      state.players,
    ),
    state.players,
  )

  // 체력 소모는 선수마다 다르다. 아껴 뛰라고 한 선수만 덜 닳는다 —
  // 얇아 보이지만 부상 임계(체력 25)를 넘기느냐가 여기서 갈리고, 부상은
  // 교체 카드를 강제로 태운다. 지시가 없으면 배수가 1이라 계수가 그대로다
  let players = state.players.map((s) =>
    s.onPitch && !s.out
      ? { ...s, stamina: drainTick(s.stamina, c.drain * drainFactorOf(s.order)) }
      : s,
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
  for (const e of ev.events) {
    const detail =
      e.kind === 'PENALTY' ? (e.conceded ? 'PENALTY_SCORED' : 'PENALTY_MISSED') : undefined
    log.push({
      tick: e.tick,
      kind: e.kind,
      target: e.target,
      ...(detail ? { detail } : {}),
    })
  }

  score[0] += attacks.homeGoals
  score[1] += attacks.awayGoals + ev.awayGoals
  if (attacks.homeGoals) {
    const detail = attacks.homeGoalCauses?.join('+')
    log.push({ tick: state.tick, kind: 'GOAL', ...(detail ? { detail } : {}) })
  }
  if (attacks.awayGoals) {
    const detail = attacks.awayGoalCauses?.join('+')
    log.push({ tick: state.tick, kind: 'CONCEDE', ...(detail ? { detail } : {}) })
  }

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
 *
 * 화면도 이 함수를 쓴다. 승패 판정을 화면에 따로 적어두면 언젠가
 * 한쪽만 고쳐져, 통과라고 표시된 판이 검증에서는 실패로 세어진다.
 */
export function judge(state: MatchState, objective: Problem['objective']): boolean {
  const [home, away] = state.score
  return objective.type === 'SURVIVE' ? home > away : home >= away
}

/**
 * 전반이 끝난 상태를 후반의 시작 상태로 넘긴다.
 *
 * 사용자가 지적했다 — *"전반전이 끝나면 후반전으로 넘어가야지 계속
 * 전반전에만 있어."* 전반을 고르면 전반만 뛰고 끝나 있었다.
 *
 * **경기는 이어진다.** 점수·체력·경고·퇴장·남은 교체 카드·포메이션·전술·
 * 걸어둔 지시가 그대로 후반으로 넘어간다. 하프타임에 회복되는 것은 없다 —
 * 실제 축구도 15분 쉰다고 체력이 돌아오지 않는다.
 *
 * **초기화하는 것:** 시계(0틱), 그 반의 통계, 사건 기록, 그리고 대기 중이던
 * 교체다. 통계와 기록을 이어붙이면 후반 화면이 전반 숫자까지 합쳐 보여줘
 * "이 반에 무슨 일이 있었나"를 읽을 수 없게 된다. 전반 기록은 화면 쪽이
 * 따로 들고 있다가 종료 보고서에서 합친다.
 *
 * 대기 중이던 교체는 **하프타임에 이뤄진 것으로 본다.** 버리면 감독이
 * 카드를 쓰고도 선수를 못 받고, 그대로 두면 후반 6초 뒤에 갑자기 바뀐다.
 * 실제로도 하프타임은 교체하는 자리다.
 *
 * **순수 함수다.** 난수를 쓰지 않으므로 매 틱 18개의 수열과 무관하다.
 */
export function carryToNextHalf(state: MatchState): MatchState {
  // 대기 중이던 교체를 먼저 성사시킨다
  let players = state.players
  for (const p of state.pendingSubs) {
    players = players.map((s) =>
      s.id === p.out
        ? { ...s, onPitch: false }
        : s.id === p.in
          ? { ...s, onPitch: true }
          : s,
    )
  }

  return {
    ...state,
    tick: 0,
    players,
    pendingSubs: [],
    log: [],
    stats: {
      homeAttempt: 0,
      awayAttempt: 0,
      homeShot: 0,
      awayShot: 0,
      setPiece: 0,
      behind: 0,
    },
    // 후반은 킥오프로 다시 시작한다. 전반이 끝난 순간의 공 위치를 물려주면
    // 그 자리에서 경기가 이어지는 것처럼 보인다
    ball: { x: 0.5, y: 0.5, owner: 'AWAY', tilt: 0 },
  }
}

/**
 * 후반이 쓸 난수 시드.
 *
 * 전반과 같은 시드를 쓰면 같은 수열이 다시 흘러 두 반이 똑같이 전개된다.
 * 국면 시드에서 결정적으로 파생시켜 같은 경기는 언제나 같은 후반을 낸다.
 */
export const secondHalfSeed = (seed: number): number => (seed ^ 0x9e3779b9) >>> 0

/**
 * 두 반을 이어서 돌린다.
 *
 * 사용자가 전반부터 뛰면 경기는 1,500틱이다. 판정은 **후반이 끝난 뒤
 * 한 번만** 한다 — 전반 종료 시점에 승패를 매기면 뒤집을 45분이 남았는데
 * 결과를 선고하는 셈이다.
 *
 * 종료 뒤 150판 비교도 반드시 이 함수를 써야 한다. 사용자는 두 반을
 * 뛰었는데 비교는 한 반만 돌리면, 무개입 통과율이 실제로 겪은 것보다
 * 높게 나와 판단 평가가 통째로 틀린다.
 */
/**
 * 결정 하나를 상태에 적용한다.
 *
 * `simulate` 안에 인라인으로 있던 것을 뺐다. 두 반을 이어 돌리려면 후반
 * 루프도 **똑같은 규칙**으로 결정을 적용해야 하는데, 복사해두면 한쪽만
 * 고쳐져 전반과 후반이 다른 게임이 된다.
 *
 * `atTick` 은 교체 반영 시각을 계산하는 데만 쓴다.
 */
function applyDecision(state: MatchState, d: Decision, atTick: number): MatchState {
  if (d.type === 'SUB') {
    // 교체는 즉시 반영되지 않는다. 늦게 쓰면 늦게 듣는다
    if (checkSub(state, d.out, d.in) !== null) return state
    return {
      ...state,
      subsLeft: state.subsLeft - 1,
      pendingSubs: [
        ...state.pendingSubs,
        { out: d.out, in: d.in, atTick: atTick + EVENTS.subDelayTicks },
      ],
    }
  }
  if (d.type === 'FORMATION') {
    // 새 포메이션은 전체 재배치다. 전에 손으로 옮긴 좌표를 남겨두면
    // 새 자리와 겹치고, 배치판과 중앙 경기장이 서로 다른 모양이 된다.
    return {
      ...state,
      formation: d.value,
      players: state.players.map((s) => (s.position === null ? s : { ...s, position: null })),
    }
  }
  if (d.type === 'ORDER') {
    // 재현에서도 상한을 지킨다. 통과한 지시만 걸려야 화면과 결과가 같아진다
    if (checkOrder(state, d.target, d.order)) return state
    return {
      ...state,
      players: state.players.map((s) =>
        s.id === d.target
          ? {
              ...s,
              order: d.order,
              // 앞뒤 줄 지시는 포메이션 기준에서 다시 시작한다. 자유 좌표와
              // 동시에 남겨 어느 것이 우선인지 모호하게 만들지 않는다
              position: movesLine(d.order) ? null : s.position,
            }
          : s,
      ),
    }
  }
  if (d.type === 'POSITION') {
    if (checkPosition(state, d.target, d.position)) return state
    return {
      ...state,
      players: state.players.map((s) =>
        s.id === d.target
          ? {
              ...s,
              position: d.position ? { ...d.position } : null,
              // 직접 놓은 자리가 마지막 위치 지시다. 행동 지시는 보존하되
              // 앞뒤 줄을 옮기던 지시는 풀어 충돌을 막는다
              order: movesLine(s.order) ? 'NONE' : s.order,
            }
          : s,
      ),
    }
  }
  // 레버는 승수라 순서가 없다. 마지막 값이 이긴다
  const tactics = { ...state.tactics }
  if (d.type === 'LINE') tactics.line = d.value
  else if (d.type === 'PRESS') tactics.press = d.value
  else tactics.width = d.value
  return { ...state, tactics }
}

export function simulateHalves(
  problem: Problem,
  first: Decision[],
  second: Decision[],
): { final: MatchState; passed: boolean; halftime: MatchState } {
  const firstRun = simulate(problem, first)
  const carried = carryToNextHalf(firstRun.final)

  const rng = createRng(secondHalfSeed(problem.seed))
  let state = carried
  const byTick = new Map<number, Decision[]>()
  for (const d of second) {
    const list = byTick.get(d.tick) ?? []
    list.push(d)
    byTick.set(d.tick, list)
  }
  for (let i = 0; i < TOTAL_TICKS; i++) {
    for (const d of byTick.get(i) ?? []) state = applyDecision(state, d, i)
    state = tick(state, rng)
  }
  return { final: state, passed: judge(state, problem.objective), halftime: firstRun.final }
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
    for (const d of byTick.get(i) ?? []) state = applyDecision(state, d, i)
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
