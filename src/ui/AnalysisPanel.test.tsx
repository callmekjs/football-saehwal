/**
 * @vitest-environment jsdom
 *
 * 감독 보고서를 **띄워 둔 채 아무것도 안 할 때** 무슨 일이 일어나는가.
 *
 * 공개 배포본에서 3분을 방치하자 같은 판이 1 → 2 → 3 → 4건으로 쌓였다.
 * 60초마다 한 바퀴였고, 그 한 바퀴마다 150판 비교가 통째로 다시 돌았다.
 * 짧게 보면 안 보인다 — `SAME_MATCH_WINDOW_MS`(60초)가 그 창을 가려주고
 * 루프 주기가 59~62초라 통째로 그 안에 들어간다.
 *
 * 그래서 이 검사는 **가짜 시계로 3분을 넘긴다.**
 */
import { StrictMode, useEffect, useRef, useState } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalysisPanel } from './AnalysisPanel'
import { mount } from './domHarness'
import { clearHistory, readHistory, upsertRecord, type MatchRecord } from './matchHistory'
import { isSameMatch, toRecord } from './recordMatch'
import { createState, simulate } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import type { Problem } from '../sim/types'

/** 150판 비교가 **실제로** 몇 번 돌았나. 그려진 글자가 아니라 이 숫자가 고장을 잡는다 */
const spy = vi.hoisted(() => ({ runs: 0 }))

vi.mock('../analysis/compare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../analysis/compare')>()
  return {
    ...actual,
    /**
     * 진짜 함수를 그대로 부르되 **횟수만 센다.**
     *
     * 판수만 2로 줄인다. 검사에서 150판을 세 갈래로 돌리면 몇 분이 걸린다.
     * 화면이 넘기는 `ANALYSIS_RUNS` 는 150 그대로다 — 그 값을 줄이는 것은
     * 이 고장을 고치는 것이 아니라 덜 아프게 만드는 것뿐이다.
     */
    compareDecisions: ((problem, decisions, _runs, kickoff, firstHalf, opponent) => {
      spy.runs += 1
      return actual.compareDecisions(problem, decisions, 2, kickoff, firstHalf, opponent)
    }) as typeof actual.compareDecisions,
  }
})

const PROBLEM = PROBLEMS[0]
const INITIAL = createState(PROBLEM)
const FINAL = simulate(PROBLEM, []).final

/**
 * **고치기 전의 App 이 하던 짓을 그대로 하는 부모.**
 *
 * 일부러 나쁘게 만들었다. 매 렌더 새 `problem` 객체와 새 결정 배열을
 * 만들고, 기록이 저장될 때마다 상태를 바꿔 다시 그린다. 고치기 전에는 이
 * 둘이 서로를 불러 끝없이 돌았다.
 *
 * 보고서 화면이 이 부모 밑에서도 조용하면, 실제 App 밑에서는 더 조용하다.
 */
function Report({ onSave }: { onSave: (delta: number | null) => void }) {
  const [, setHistory] = useState<MatchRecord[]>(() => readHistory())
  const reported = useRef(false)

  const save = (delta: number | null) => {
    onSave(delta)
    setHistory(
      upsertRecord(
        toRecord({
          problem: PROBLEM,
          final: FINAL,
          opponent: 'USA',
          half: 2,
          decisions: 0,
          delta,
          at: Date.now(),
        }),
        isSameMatch,
      ),
    )
  }

  // MatchScreen 의 FinishReporter — 붙는 순간 한 번 저장한다
  useEffect(() => {
    if (reported.current) return
    reported.current = true
    save(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 매 렌더 새 객체다. 고치기 전 `App.tsx` 가 하던 그대로
  const churned: Problem = { ...PROBLEM, seed: PROBLEM.seed }

  return (
    <AnalysisPanel
      problem={churned}
      initialState={INITIAL}
      finalState={FINAL}
      passed={false}
      decisions={[]}
      kickoff={70}
      kickoffHalf={2}
      opponent="USA"
      onDelta={(delta) => save(delta)}
    />
  )
}

/** 가짜 시계를 `ms` 만큼 흘린다. 그 사이에 걸린 효과와 타이머가 함께 돈다 */
function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('감독 보고서를 띄워 두고 기다릴 때', () => {
  beforeEach(() => {
    clearHistory()
    window.localStorage.clear()
    spy.runs = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('3분을 방치해도 기록은 한 건이고 150판 비교는 한 번만 돈다', () => {
    const saves: Array<number | null> = []
    const view = mount(<Report onSave={(delta) => saves.push(delta)} />)

    // 0ms 타이머에 걸어둔 첫 분석을 흘려보낸다
    wait(10)
    expect(spy.runs).toBe(1)

    // 사람이 아무것도 하지 않고 3분 20초를 본다
    for (let i = 0; i < 20; i += 1) wait(10_000)

    expect(spy.runs).toBe(1)
    // 종료 즉시 한 번(delta 없음) + 분석이 끝나고 한 번. 이 둘은 설계된 것이다
    expect(saves).toHaveLength(2)
    expect(saves[0]).toBeNull()
    expect(saves[1]).not.toBeNull()
    expect(readHistory()).toHaveLength(1)

    view.unmount()
  })

  it('부모가 다시 그려도 분석과 저장이 되풀이되지 않는다', () => {
    const saves: Array<number | null> = []
    const push = (delta: number | null) => saves.push(delta)
    const view = mount(<Report onSave={push} />)
    wait(10)
    expect(spy.runs).toBe(1)

    // App 이 다시 그려지는 상황. problem 객체와 결정 배열이 매번 새로 생긴다
    for (let i = 0; i < 5; i += 1) view.render(<Report onSave={push} />)
    wait(1_000)

    expect(spy.runs).toBe(1)
    expect(saves).toHaveLength(2)
    expect(readHistory()).toHaveLength(1)

    view.unmount()
  })

  it('StrictMode 가 효과를 두 번 붙여도 분석은 사라지지 않고 한 번만 돈다', () => {
    // 실제 앱은 StrictMode 안에서 돈다(`main.tsx`). 붙자마자 떼었다 다시
    // 붙이므로, "한 번만" 을 붙는 순간으로 막으면 분석이 아예 안 돈다
    const saves: Array<number | null> = []
    const view = mount(
      <StrictMode>
        <Report onSave={(delta) => saves.push(delta)} />
      </StrictMode>,
    )
    wait(10)
    for (let i = 0; i < 20; i += 1) wait(10_000)

    expect(spy.runs).toBe(1)
    expect(saves).toHaveLength(2)
    expect(readHistory()).toHaveLength(1)

    view.unmount()
  })
})
