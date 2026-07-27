import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drawPitch } from '../render/pitch'
import { FORMATION_IDS, getFormation, shapeOf, type FormationId } from '../sim/formations'
import { BENCH, getPlayer } from '../sim/squad'
import { TOTAL_TICKS } from '../sim/constants'
import { useMatch } from './useMatch'
import type { Level, MatchState, Problem } from '../sim/types'

const LEVER_LABELS = {
  LINE: ['낮음', '보통', '높음'],
  PRESS: ['약', '중', '강'],
  WIDTH: ['좁게', '보통', '넓게'],
} as const

/** 게임 내 시계. 국면 시작 분에서 15분이 흐른다 */
function clockOf(tick: number, kickoff: number): string {
  const minutes = kickoff + (tick / TOTAL_TICKS) * 15
  const m = Math.floor(minutes)
  const s = Math.floor((minutes - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function Pitch({ state }: { state: MatchState }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let raf = 0

    const render = () => {
      const parent = canvas.parentElement
      if (parent) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = parent.clientWidth
        const h = Math.round(w * (68 / 105))
        if (canvas.width !== Math.round(w * dpr)) {
          canvas.width = Math.round(w * dpr)
          canvas.height = Math.round(h * dpr)
          canvas.style.width = `${w}px`
          canvas.style.height = `${h}px`
        }
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          drawPitch(ctx, stateRef.current, w, h)
        }
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={ref} style={{ display: 'block', width: '100%', borderRadius: 8 }} />
}

function FormationPanel({
  current,
  onChange,
  tenMen,
}: {
  current: FormationId
  onChange: (f: FormationId) => void
  tenMen: boolean
}) {
  const shape = shapeOf(current)
  return (
    <section className="panel">
      <h2>우리 포메이션 {tenMen && <span style={{ color: 'var(--away)' }}>· 10명</span>}</h2>
      <div style={{ padding: 10, display: 'grid', gap: 6 }}>
        {FORMATION_IDS.map((id) => {
          const f = getFormation(id)
          const on = id === current
          return (
            <button
              key={id}
              className="chip"
              aria-pressed={on}
              onClick={() => onChange(id)}
              style={{ textAlign: 'left', display: 'grid', gap: 2 }}
            >
              <span style={{ fontSize: 15, fontWeight: 500 }}>{f.label}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{f.hint}</span>
            </button>
          )
        })}
        <p style={{ margin: '4px 2px 0', fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>
          수비 {shape.DF} · 중원 {shape.MF} · 공격 {shape.FW}
          <br />
          바꾸면 즉시 반영됩니다.
        </p>
      </div>
    </section>
  )
}

function Levers({
  tactics,
  onSet,
}: {
  tactics: MatchState['tactics']
  onSet: (t: 'LINE' | 'PRESS' | 'WIDTH', v: Level) => void
}) {
  const rows = [
    ['LINE', '수비라인', tactics.line],
    ['PRESS', '압박', tactics.press],
    ['WIDTH', '수비 폭', tactics.width],
  ] as const

  return (
    <section className="panel">
      <h2>전술 레버</h2>
      <div style={{ padding: 10, display: 'grid', gap: 10 }}>
        {rows.map(([key, label, value]) => (
          <div key={key} style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5 }}>
              {LEVER_LABELS[key].map((text, i) => (
                <button
                  key={text}
                  className="chip"
                  aria-pressed={value === i}
                  onClick={() => onSet(key, i as Level)}
                  style={{ textAlign: 'center', padding: '8px 4px' }}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * 경기 기록. FM의 좌우 마주보는 막대를 그대로 가져왔다.
 *
 * 전부 엔진이 실제로 센 횟수다. 레버를 당기면 몇 초 안에 이 숫자가
 * 움직이고, 그것이 "내가 뭘 바꿨는지"를 알려주는 주 채널이다.
 */
function StatBars({ state }: { state: MatchState }) {
  const s = state.stats
  const rows: Array<[string, number, number, boolean]> = [
    ['공격 전개', s.homeAttempt, s.awayAttempt, false],
    ['슈팅 상황', s.homeShot, s.awayShot, false],
    ['세트피스 허용', 0, s.setPiece, true],
    ['배후 뚫림', 0, s.behind, true],
  ]

  return (
    <section className="panel">
      <h2>경기 기록</h2>
      <div style={{ padding: '10px 12px', display: 'grid', gap: 9 }}>
        {rows.map(([label, home, away, oneSided]) => {
          const total = home + away
          const hp = total === 0 ? 0.5 : home / total
          return (
            <div key={label} style={{ display: 'grid', gap: 3 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: 'var(--muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span>{oneSided ? '' : home}</span>
                <span>{label}</span>
                <span style={{ color: oneSided && away > 0 ? 'var(--away)' : undefined }}>
                  {away}
                </span>
              </div>
              <div style={{ display: 'flex', height: 6, gap: 2, background: 'var(--panel-2)', borderRadius: 3 }}>
                <div style={{ flex: hp, background: 'var(--accent)', borderRadius: 3 }} />
                <div style={{ flex: 1 - hp, background: 'var(--away)', borderRadius: 3 }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const EVENT_TEXT: Record<string, string> = {
  GOAL: '골! 우리가 넣었다',
  CONCEDE: '실점. 상대가 넣었다',
  CARD: '경고가 나왔다',
  SEND_OFF: '퇴장. 한 명이 빠진다',
  INJURY: '부상으로 교체가 강제된다',
  PENALTY: '페널티킥',
  FOUL: '파울',
  SUB: '교체 투입',
}

function Log({ state, kickoff }: { state: MatchState; kickoff: number }) {
  const shown = state.log.filter((e) => e.kind !== 'FOUL').slice(-7).reverse()
  return (
    <section className="panel" style={{ minHeight: 120 }}>
      <h2>경기 이벤트</h2>
      <div style={{ padding: '8px 12px', display: 'grid', gap: 5 }}>
        {shown.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>아직 특이사항 없음</span>
        )}
        {shown.map((e, i) => (
          <div key={`${e.tick}-${i}`} style={{ fontSize: 12, display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--dim)', minWidth: 34 }}>
              {Math.floor(kickoff + (e.tick / TOTAL_TICKS) * 15)}'
            </span>
            <span style={{ color: e.kind === 'GOAL' ? 'var(--accent)' : e.kind === 'CONCEDE' ? 'var(--away)' : 'var(--text)' }}>
              {EVENT_TEXT[e.kind] ?? e.kind}
              {e.target && <span style={{ color: 'var(--dim)' }}> · {getPlayer(e.target).num}번</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Bench({
  state,
  onSub,
}: {
  state: MatchState
  onSub: (out: string, inId: string) => string | null
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 2200)
    return () => clearTimeout(t)
  }, [note])

  const onPitch = state.players.filter((s) => s.onPitch && !s.out)

  return (
    <section className="panel">
      <h2>
        벤치 · 교체 {state.subsLeft}장 남음
        {picked && <span style={{ color: 'var(--accent)' }}> — 나갈 선수를 고르세요</span>}
      </h2>
      <div style={{ padding: 10, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {BENCH.map((b) => {
            const s = state.players.find((p) => p.id === b.id)!
            const used = s.onPitch || s.out
            return (
              <button
                key={b.id}
                className="chip"
                aria-pressed={picked === b.id}
                disabled={used || state.subsLeft <= 0}
                onClick={() => setPicked(picked === b.id ? null : b.id)}
                style={{ minWidth: 62, textAlign: 'center', display: 'grid', gap: 1 }}
              >
                <span style={{ fontSize: 16, fontWeight: 500 }}>{b.num}</span>
                <span style={{ fontSize: 10 }}>
                  {b.pos} · 속도 {b.speed}
                </span>
              </button>
            )
          })}
        </div>

        {picked && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {onPitch.map((s) => {
              const p = getPlayer(s.id)
              return (
                <button
                  key={s.id}
                  className="chip"
                  onClick={() => {
                    const err = onSub(s.id, picked)
                    setNote(err ?? `${p.num}번 → ${getPlayer(picked).num}번`)
                    setPicked(null)
                  }}
                  style={{ minWidth: 54, textAlign: 'center', display: 'grid', gap: 1 }}
                >
                  <span style={{ fontSize: 15 }}>{p.num}</span>
                  <span style={{ fontSize: 10 }}>체력 {Math.round(s.stamina)}</span>
                </button>
              )
            })}
          </div>
        )}

        {note && <span style={{ fontSize: 12, color: 'var(--warn)' }}>{note}</span>}
      </div>
    </section>
  )
}

export function MatchScreen({ problem, kickoff }: { problem: Problem; kickoff: number }) {
  const { state, phase, start, reset, setLever, setFormation, substitute } = useMatch(problem)
  const objective =
    problem.objective.type === 'SURVIVE' ? '리드를 지켜라' : '동점 이상을 만들어라'

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: 12, display: 'grid', gap: 12 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          borderRadius: 999,
          padding: '8px 16px',
        }}
      >
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted)', fontSize: 13 }}>
          {clockOf(state.tick, kickoff)}
        </span>
        <span style={{ fontSize: 13 }}>우리 팀</span>
        <strong style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
          {state.score[0]} – {state.score[1]}
        </strong>
        <span style={{ fontSize: 13 }}>상대</span>
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>교체 {state.subsLeft}</span>
      </header>

      <div className="layout">
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <FormationPanel
            current={state.formation}
            onChange={setFormation}
            tenMen={state.homeCount < 11}
          />
          <Levers tactics={state.tactics} onSet={setLever} />
        </div>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div className="panel" style={{ padding: 8 }}>
            <Pitch state={state} />
          </div>
          <StatBars state={state} />
        </div>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <section className="panel">
            <h2>이 국면</h2>
            <div style={{ padding: 12, display: 'grid', gap: 6 }}>
              <strong style={{ fontSize: 15 }}>{problem.title}</strong>
              <span style={{ fontSize: 13, color: 'var(--accent)' }}>{objective}</span>
              <span style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                후반 {kickoff}분 · 남은 15분
                <br />
                앞 감독이 걸어둔 지시를 물려받았습니다.
              </span>
              {phase === 'READY' && (
                <button
                  className="chip"
                  aria-pressed
                  onClick={start}
                  style={{ marginTop: 4, textAlign: 'center', fontSize: 15 }}
                >
                  킥오프
                </button>
              )}
              {phase === 'DONE' && (
                <>
                  <strong
                    style={{
                      marginTop: 4,
                      fontSize: 17,
                      color: state.score[0] > state.score[1] ? 'var(--accent)' : 'var(--away)',
                    }}
                  >
                    {problem.objective.type === 'SURVIVE'
                      ? state.score[0] > state.score[1]
                        ? '지켜냈다'
                        : '무너졌다'
                      : state.score[0] >= state.score[1]
                        ? '따라잡았다'
                        : '실패했다'}
                  </strong>
                  <button className="chip" onClick={reset} style={{ textAlign: 'center' }}>
                    다시 풀기
                  </button>
                </>
              )}
            </div>
          </section>
          <Log state={state} kickoff={kickoff} />
        </div>
      </div>

      <Bench state={state} onSub={substitute} />
    </div>
  )
}
