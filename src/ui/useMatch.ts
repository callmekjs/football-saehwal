import { useCallback, useEffect, useRef, useState } from 'react'
import { createRng, type Rng } from '../sim/rng'
import { applySub, createState, tick, checkSub, checkOrder, checkPosition } from '../sim/engine'
import { TOTAL_TICKS } from '../sim/constants'
import type { FormationId } from '../sim/formations'
import type {
  MatchAbility,
  Decision,
  OpponentId,
  Level,
  MatchState,
  PlayerOrder,
  PlayerPosition,
  Problem,
} from '../sim/types'

const TICK_MS = 100

/**
 * 종료 휘슬 뒤에 들어온 조작을 돌려보내는 사유.
 *
 * 화면이 뒤처져 아직 경기 중으로 보이더라도, 실제 시각으로 75초가 다 갔으면
 * 그 지시가 닿을 시간이 남아 있지 않다. `checkOrder`·`checkPosition` 과 같은
 * 문자열 통로로 돌려보내 경기 화면이 그대로 띄운다.
 */
export const AFTER_FULL_TIME = '종료 휘슬이 이미 울려 지시가 닿지 않습니다'

export type Phase = 'READY' | 'RUNNING' | 'DONE'

/**
 * 지금 이 순간의 경기 시각.
 *
 * 화면이 어디까지 그렸는지가 아니라 **킥오프에서 흐른 실제 시간**이 정한다.
 * 화면이 뒤처져 있어도 경기 시각은 언제나 이 값이고, 조작은 이 시각에
 * 들어가야 한다.
 */
export function targetTick(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0
  return Math.min(TOTAL_TICKS, Math.floor(elapsedMs / TICK_MS))
}

/**
 * 목표 틱까지 밀린 계산을 **남김없이** 끝낸다.
 *
 * 전에는 한 회에 60틱만 따라가고 멈췄다. 화면이 얼어붙는 것을 막으려던
 * 것인데, 그동안 화면은 과거를 보여주면서 조작은 열려 있어 이미 지나간
 * 구간에 지시가 소급 적용됐다. 한 경기를 통째로(750틱) 한 번에 도는 데
 * 드는 시간을 200회 재보니 평균 0.96ms · 최악 2.6ms 로, 60fps 한 프레임
 * 예산 16.7ms의 6분의 1도 되지 않았다. 게다가 한 경기의 총 계산량은
 * 750틱으로 고정이라 제한을 없애도 전체 일감이 늘지 않는다 — 나눠 하던
 * 것을 한 번에 할 뿐이다. 그래서 제한을 없애 화면이 경기 시각과 어긋나 있는
 * 시간 자체를 없앴다.
 */
export function catchUp(state: MatchState, rng: Rng, target: number): MatchState {
  let next = state
  while (next.tick < target) next = tick(next, rng)
  return next
}

/**
 * 조작을 받기 전에 통과해야 하는 문.
 *
 * 흐른 실제 시간만큼 먼저 계산을 끝내고, 그러고도 경기가 남아 있는지 답한다.
 * 이 문을 지나면 조작은 반드시 **지금 이후**에만 걸린다. 정상적으로 보고
 * 있는 감독에게는 밀린 틱이 0~1개라 아무 일도 일어나지 않는다.
 */
export function openForOrders(
  state: MatchState,
  rng: Rng,
  elapsedMs: number,
): { state: MatchState; reason: string | null } {
  const next = catchUp(state, rng, targetTick(elapsedMs))
  return { state: next, reason: next.tick >= TOTAL_TICKS ? AFTER_FULL_TIME : null }
}

type FormationRecord =
  | { type: 'FORMATION'; value: FormationId }
  | { type: 'ORDER'; target: string; order: 'NONE' }

/**
 * 포메이션을 바꿀 때 위치를 직접 옮기던 지시만 함께 푼다.
 *
 * `PUSH_UP`·`DROP_BACK`을 남기면 새 포메이션 자리에 다시 ±22m가 더해져
 * 방금 고른 형태가 즉시 무너진다. 골문 앞 지키기·물러서기·체력 아끼기는
 * 위치선 변경이 아니므로 그대로 둔다. 자동 해제도 결정 이력에 `ORDER
 * NONE`으로 남겨 종료 뒤 재현과 실제 상태가 같게 한다.
 */
export function changeFormation(
  state: MatchState,
  value: FormationId,
): { next: MatchState; records: FormationRecord[] } {
  if (state.formation === value) return { next: state, records: [] }
  const cleared = state.players.filter(
    (player) =>
      player.onPitch &&
      !player.out &&
      (player.order === 'PUSH_UP' || player.order === 'DROP_BACK'),
  )
  const records: FormationRecord[] = [
    { type: 'FORMATION', value },
    ...cleared.map((player) => ({ type: 'ORDER' as const, target: player.id, order: 'NONE' as const })),
  ]
  const clearedIds = new Set(cleared.map((player) => player.id))
  return {
    next: {
      ...state,
      formation: value,
      players: state.players.map((player) =>
        clearedIds.has(player.id) || player.position !== null
          ? {
              ...player,
              order: clearedIds.has(player.id) ? 'NONE' : player.order,
              position: null,
            }
          : player,
      ),
    },
    records,
  }
}

type PositionRecord = {
  type: 'POSITION'
  target: string
  position: PlayerPosition | null
}

const movesLine = (order: PlayerOrder) =>
  order === 'PUSH_UP' || order === 'DROP_BACK'

/**
 * 선수를 피치 미터 좌표에 놓고 재현 가능한 결정 한 줄을 만든다.
 *
 * 유효성은 엔진 `checkPosition` 하나만 쓴다. 직접 놓은 자리가 마지막 위치
 * 지시이므로 앞뒤 줄을 옮기던 지시는 함께 풀고, 행동 지시는 보존한다.
 */
export function changePosition(
  state: MatchState,
  target: string,
  position: PlayerPosition | null,
): { next: MatchState; record: PositionRecord | null; error: string | null } {
  const error = checkPosition(state, target, position)
  if (error) return { next: state, record: null, error }
  const before = state.players.find((player) => player.id === target)
  if (!before) return { next: state, record: null, error: '선수를 명단에서 찾을 수 없습니다' }

  const samePosition =
    before.position === position ||
    (before.position !== null &&
      position !== null &&
      before.position.x === position.x &&
      before.position.y === position.y)
  const nextOrder = movesLine(before.order) ? 'NONE' : before.order
  if (samePosition && before.order === nextOrder) {
    return { next: state, record: null, error: null }
  }

  return {
    next: {
      ...state,
      players: state.players.map((player) =>
        player.id === target
          ? {
              ...player,
              position: position ? { ...position } : null,
              order: nextOrder,
            }
          : player,
      ),
    },
    record: {
      type: 'POSITION',
      target,
      position: position ? { ...position } : null,
    },
    error: null,
  }
}

/**
 * 10Hz 엔진을 화면에 연결한다.
 *
 * 엔진은 100ms마다 한 번 돈다. 화면은 그것과 별개로 매 프레임 다시
 * 그린다. 렌더가 느려도 경기 속도는 변하지 않아야 하므로 누적 시간으로
 * 따라잡는다. 탭을 벗어났다 돌아왔을 때도 실제 시각의 목표 틱까지 한 번에
 * 확정해, 지나간 구간에 늦은 지시가 들어갈 틈을 남기지 않는다.
 */
export function useMatch(
  problem: Problem,
  opponent: OpponentId = 'USA',
  /** 감독이 고른 선발과 다시 뽑은 명단. 없으면 기본 선수단이다 */
  squad?: { starters?: ReadonlySet<string>; roster?: ReadonlyMap<string, MatchAbility> },
) {
  const [state, setState] = useState<MatchState>(() =>
    createState(problem, opponent, squad?.starters, squad?.roster),
  )
  const [phase, setPhase] = useState<Phase>('READY')

  const rngRef = useRef<Rng>(createRng(problem.seed))
  const stateRef = useRef<MatchState>(state)
  const decisionsRef = useRef<Decision[]>([])
  const timerRef = useRef<number>(0)
  const startedAtRef = useRef<number>(0)
  /** 조작 처리기가 읽는 지금 단계. 급수 타임에는 절대 시각을 보면 안 된다 */
  const phaseRef = useRef<Phase>(phase)

  stateRef.current = state
  phaseRef.current = phase

  const reset = useCallback(() => {
    clearInterval(timerRef.current)
    rngRef.current = createRng(problem.seed)
    decisionsRef.current = []
    const fresh = createState(problem, opponent)
    stateRef.current = fresh
    setState(fresh)
    setPhase('READY')
  }, [problem, opponent])

  useEffect(() => reset(), [reset])

  /**
   * 이어지는 반을 시작한다.
   *
   * `reset` 과 다르다 — 저건 국면을 처음부터 다시 하는 것이고 이건
   * **경기가 계속되는** 것이다. 점수·체력·경고·교체 카드를 그대로 물려받은
   * 상태로 급수 타임(`READY`)에 들어가므로, 감독은 후반 지시를 새로 걸고
   * 휘슬을 분다.
   *
   * 결정 이력은 반마다 새로 시작한다. 호출하는 쪽이 전반 것을 따로 챙겨야
   * 종료 보고서에서 두 반을 합칠 수 있다.
   */
  const startNextHalf = useCallback((initial: MatchState, seed: number) => {
    clearInterval(timerRef.current)
    rngRef.current = createRng(seed)
    decisionsRef.current = []
    stateRef.current = initial
    setState(initial)
    setPhase('READY')
  }, [])

  const start = useCallback(() => {
    if (phase !== 'READY') return
    startedAtRef.current = performance.now()
    setPhase('RUNNING')
  }, [phase])

  /**
   * 경기 진행은 절대 시각을 기준으로 한다.
   *
   * requestAnimationFrame 은 탭이 화면에 없으면 아예 멈춘다. 그걸 쓰면
   * 탭을 바꾸는 것이 일시정지 치트가 되어 "시계는 멈추지 않는다"는
   * 이 게임의 전제가 무너진다. 킥오프 시각에서 지금까지 흐른 실제
   * 시간으로 목표 틱을 계산하면, 화면이 얼마나 느리든 백그라운드로
   * 밀려났든 경기 시간은 실제 시간과 정확히 일치한다.
   *
   * 밀린 틱은 **한 번에 끝까지** 따라잡는다. 나눠서 따라잡으면 그동안
   * 화면이 과거를 보여주고, 그 과거에 지시를 걸 수 있게 된다. 비용은
   * `catchUp` 주석에 잰 대로 한 프레임 안쪽이다.
   *
   * 숨겼던 탭이 다시 보이는 순간에도 한 번 따라잡는다. 타이머는 백그라운드
   * 에서 묶여 있다가 돌아온 뒤에도 최대 한 주기만큼 늦게 깨어나는데, 그
   * 사이가 바로 화면과 경기 시각이 어긋나는 구간이다.
   */
  useEffect(() => {
    if (phase !== 'RUNNING') return

    const step = () => {
      const next = catchUp(
        stateRef.current,
        rngRef.current,
        targetTick(performance.now() - startedAtRef.current),
      )

      if (next !== stateRef.current) {
        stateRef.current = next
        setState(next)
      }
      if (next.tick >= TOTAL_TICKS) {
        clearInterval(timerRef.current)
        setPhase('DONE')
      }
    }

    timerRef.current = window.setInterval(step, TICK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') step()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timerRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [phase])

  /**
   * 조작을 받기 전에 지금까지 흐른 실제 시간을 먼저 계산해 둔다.
   *
   * 이것이 QA-31의 잠금이다. 탭에서 돌아온 직후처럼 화면이 뒤처져 있으면
   * 먼저 현재까지 계산을 끝내고, 지시는 **따라잡은 뒤의 틱**에 걸린다.
   * 정상적으로 보고 있으면 밀린 틱이 0~1개라 하는 일이 없다.
   */
  const syncToNow = useCallback((): { state: MatchState; reason: string | null } => {
    if (phaseRef.current !== 'RUNNING') return { state: stateRef.current, reason: null }
    const opened = openForOrders(
      stateRef.current,
      rngRef.current,
      performance.now() - startedAtRef.current,
    )
    if (opened.state !== stateRef.current) {
      stateRef.current = opened.state
      setState(opened.state)
      if (opened.state.tick >= TOTAL_TICKS) {
        clearInterval(timerRef.current)
        setPhase('DONE')
      }
    }
    return opened
  }, [])

  /** 조작은 전부 결정 이력에 남는다. 이것만 있으면 경기를 재현할 수 있다 */
  const record = useCallback((d: Omit<Decision, 'tick'>) => {
    decisionsRef.current.push({ ...d, tick: stateRef.current.tick } as Decision)
  }, [])

  const setLever = useCallback(
    (type: 'LINE' | 'PRESS' | 'WIDTH', value: Level): string | null => {
      const { state: cur, reason } = syncToNow()
      if (reason) return reason
      const key = type === 'LINE' ? 'line' : type === 'PRESS' ? 'press' : 'width'
      if (cur.tactics[key] === value) return null
      record({ type, value } as Omit<Decision, 'tick'>)
      const next = { ...cur, tactics: { ...cur.tactics, [key]: value } }
      stateRef.current = next
      setState(next)
      return null
    },
    [record, syncToNow],
  )

  const setFormation = useCallback(
    (value: FormationId): string | null => {
      const { state: cur, reason } = syncToNow()
      if (reason) return reason
      if (cur.formation === value) return null
      const changed = changeFormation(cur, value)
      for (const decision of changed.records) {
        record(decision as Omit<Decision, 'tick'>)
      }
      const next = changed.next
      stateRef.current = next
      setState(next)
      return null
    },
    [record, syncToNow],
  )

  const setPosition = useCallback(
    (target: string, position: PlayerPosition | null): string | null => {
      const { state: cur, reason } = syncToNow()
      if (reason) return reason
      const changed = changePosition(cur, target, position)
      if (changed.error) return changed.error
      if (!changed.record) return null
      record(changed.record as Omit<Decision, 'tick'>)
      stateRef.current = changed.next
      setState(changed.next)
      return null
    },
    [record, syncToNow],
  )

  const substitute = useCallback(
    (out: string, inId: string): string | null => {
      const { state: cur, reason: late } = syncToNow()
      if (late) return late
      const reason = checkSub(cur, out, inId)
      if (reason) return reason
      record({ type: 'SUB', out, in: inId } as Omit<Decision, 'tick'>)
      /**
       * **급수 타임 교체는 즉시 끝난다.**
       *
       * 사용자가 정했다 — *"바로 선수교체가 가능하게 해줘. 5초 기다렸다
       * 할 필요 없고."* 공이 이미 죽어 있고 시계가 멈춰 있는 시간이다.
       * 실제 축구도 하프타임 교체는 후반 휘슬에 이미 끝나 있다.
       *
       * 6초 지연은 경기가 흐르는 중에만 걸린다 — 그때는 선수가 실제로
       * 걸어 나오고 들어가는 시간이라 맞다.
       *
       * 기준(0틱)은 `applyDecision` 과 **같아야 한다.** 다르면 사용자가
       * 본 선발과 150판 비교가 쓰는 선발이 갈린다.
       */
      const next: MatchState =
        cur.tick === 0
          ? {
              ...cur,
              subsLeft: cur.subsLeft - 1,
              players: applySub(cur.players, out, inId),
            }
          : {
              ...cur,
              subsLeft: cur.subsLeft - 1,
              pendingSubs: [...cur.pendingSubs, { out, in: inId, atTick: cur.tick + 60 }],
            }
      stateRef.current = next
      setState(next)
      return null
    },
    [record, syncToNow],
  )

  /**
   * 선수 한 명에게 지시를 건다.
   *
   * 교체와 달리 **즉시** 반영된다. 교체는 선수가 실제로 걸어 나가고 들어와야
   * 하지만 지시는 벤치에서 소리치는 것이다. 6초를 기다릴 이유가 없고,
   * 75초짜리 경기에서 그 지연은 지시를 쓸모없게 만든다.
   */
  const setOrder = useCallback(
    (target: string, order: PlayerOrder): string | null => {
      const { state: cur, reason: late } = syncToNow()
      if (late) return late
      const reason = checkOrder(cur, target, order)
      if (reason) return reason
      const before = cur.players.find((s) => s.id === target)
      if (before?.order === order) return null
      record({ type: 'ORDER', target, order } as Omit<Decision, 'tick'>)
      const next: MatchState = {
        ...cur,
        players: cur.players.map((s) =>
          s.id === target
            ? {
                ...s,
                order,
                position: movesLine(order) ? null : s.position,
              }
            : s,
        ),
      }
      stateRef.current = next
      setState(next)
      return null
    },
    [record, syncToNow],
  )

  return {
    state,
    phase,
    start,
    reset,
    setLever,
    setFormation,
    substitute,
    setOrder,
    setPosition,
    startNextHalf,
    decisions: decisionsRef,
  }
}
