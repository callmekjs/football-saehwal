import { useCallback, useEffect, useRef, useState } from 'react'
import { createRng, type Rng } from '../sim/rng'
import { createState, tick, checkSub, checkOrder, checkPosition } from '../sim/engine'
import { TOTAL_TICKS } from '../sim/constants'
import type { FormationId } from '../sim/formations'
import type {
  Decision,
  Level,
  MatchState,
  PlayerOrder,
  PlayerPosition,
  Problem,
} from '../sim/types'

const TICK_MS = 100

export type Phase = 'READY' | 'RUNNING' | 'DONE'

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
  if (!before) return { next: state, record: null, error: `${target} 은 명단에 없다` }

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
 * 따라잡는다. 탭을 벗어났다 돌아왔을 때 수백 틱이 한 번에 밀려드는 것을
 * 막기 위해 한 프레임에 처리할 틱 수를 제한한다.
 */
export function useMatch(problem: Problem) {
  const [state, setState] = useState<MatchState>(() => createState(problem))
  const [phase, setPhase] = useState<Phase>('READY')

  const rngRef = useRef<Rng>(createRng(problem.seed))
  const stateRef = useRef<MatchState>(state)
  const decisionsRef = useRef<Decision[]>([])
  const timerRef = useRef<number>(0)
  const startedAtRef = useRef<number>(0)

  stateRef.current = state

  const reset = useCallback(() => {
    clearInterval(timerRef.current)
    rngRef.current = createRng(problem.seed)
    decisionsRef.current = []
    const fresh = createState(problem)
    stateRef.current = fresh
    setState(fresh)
    setPhase('READY')
  }, [problem])

  useEffect(() => reset(), [reset])

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
   * 돌아왔을 때 밀린 틱은 한 번에 따라잡되 한 회에 60틱(6초)으로 제한해
   * 화면이 얼어붙지 않게 한다.
   */
  useEffect(() => {
    if (phase !== 'RUNNING') return

    const step = () => {
      const elapsed = performance.now() - startedAtRef.current
      const target = Math.min(TOTAL_TICKS, Math.floor(elapsed / TICK_MS))

      let next = stateRef.current
      let steps = 0
      while (next.tick < target && steps < 60) {
        next = tick(next, rngRef.current)
        steps += 1
      }

      if (steps > 0) {
        stateRef.current = next
        setState(next)
      }
      if (next.tick >= TOTAL_TICKS) {
        clearInterval(timerRef.current)
        setPhase('DONE')
      }
    }

    timerRef.current = window.setInterval(step, TICK_MS)
    return () => clearInterval(timerRef.current)
  }, [phase])

  /** 조작은 전부 결정 이력에 남는다. 이것만 있으면 경기를 재현할 수 있다 */
  const record = useCallback((d: Omit<Decision, 'tick'>) => {
    decisionsRef.current.push({ ...d, tick: stateRef.current.tick } as Decision)
  }, [])

  const setLever = useCallback(
    (type: 'LINE' | 'PRESS' | 'WIDTH', value: Level) => {
      const cur = stateRef.current
      const key = type === 'LINE' ? 'line' : type === 'PRESS' ? 'press' : 'width'
      if (cur.tactics[key] === value) return
      record({ type, value } as Omit<Decision, 'tick'>)
      const next = { ...cur, tactics: { ...cur.tactics, [key]: value } }
      stateRef.current = next
      setState(next)
    },
    [record],
  )

  const setFormation = useCallback(
    (value: FormationId) => {
      const cur = stateRef.current
      if (cur.formation === value) return
      const changed = changeFormation(cur, value)
      for (const decision of changed.records) {
        record(decision as Omit<Decision, 'tick'>)
      }
      const next = changed.next
      stateRef.current = next
      setState(next)
    },
    [record],
  )

  const setPosition = useCallback(
    (target: string, position: PlayerPosition | null): string | null => {
      const changed = changePosition(stateRef.current, target, position)
      if (changed.error) return changed.error
      if (!changed.record) return null
      record(changed.record as Omit<Decision, 'tick'>)
      stateRef.current = changed.next
      setState(changed.next)
      return null
    },
    [record],
  )

  const substitute = useCallback(
    (out: string, inId: string): string | null => {
      const cur = stateRef.current
      const reason = checkSub(cur, out, inId)
      if (reason) return reason
      record({ type: 'SUB', out, in: inId } as Omit<Decision, 'tick'>)
      const next: MatchState = {
        ...cur,
        subsLeft: cur.subsLeft - 1,
        pendingSubs: [...cur.pendingSubs, { out, in: inId, atTick: cur.tick + 60 }],
      }
      stateRef.current = next
      setState(next)
      return null
    },
    [record],
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
      const cur = stateRef.current
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
    [record],
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
    decisions: decisionsRef,
  }
}
