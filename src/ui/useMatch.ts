import { useCallback, useEffect, useRef, useState } from 'react'
import { createRng, type Rng } from '../sim/rng'
import { createState, tick, checkSub, checkOrder } from '../sim/engine'
import { TOTAL_TICKS } from '../sim/constants'
import type { FormationId } from '../sim/formations'
import type { Decision, Level, MatchState, PlayerOrder, Problem } from '../sim/types'

const TICK_MS = 100

export type Phase = 'READY' | 'RUNNING' | 'DONE'

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
      record({ type: 'FORMATION', value } as Omit<Decision, 'tick'>)
      const next = { ...cur, formation: value }
      stateRef.current = next
      setState(next)
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
        players: cur.players.map((s) => (s.id === target ? { ...s, order } : s)),
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
    decisions: decisionsRef,
  }
}
