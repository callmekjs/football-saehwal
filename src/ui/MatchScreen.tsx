import { useEffect, useState } from 'react'
import { Pitch } from './Pitch'
import { FORMATION_IDS, getFormation, shapeOf, type FormationId } from '../sim/formations'
import { BENCH, getPlayer } from '../sim/squad'
import { judge, MAX_ORDERS } from '../sim/engine'
import { TOTAL_TICKS } from '../sim/constants'
import { useMatch } from './useMatch'
import type { Level, MatchState, PlayerOrder, Problem } from '../sim/types'

const LEVER_LABELS = {
  LINE: ['낮음', '보통', '높음'],
  PRESS: ['약', '중', '강'],
  WIDTH: ['좁게', '보통', '넓게'],
} as const

/** 경기 내 시계. 국면 시작 분에서 15분이 흐른다 */
function clockOf(tick: number, kickoff: number): string {
  const minutes = kickoff + (tick / TOTAL_TICKS) * 15
  const m = Math.floor(minutes)
  const s = String(Math.floor((minutes - m) * 60)).padStart(2, '0')
  return `${m}:${s}`
}

/**
 * 90분을 넘겼는가.
 *
 * 후반은 90분에 끝나지 않는다. 90분을 채우고 주심이 정한 추가시간을 더
 * 뛴다. 중계 화면은 이때 시계를 그대로 흘려보내면서 `+3` 을 따로 띄운다 —
 * 시계만 보면 "왜 아직 안 끝나지?"가 되고, 시계를 90:00에 세우면 남은
 * 시간을 읽을 수 없다. 둘을 나란히 두는 것이 실제 중계의 방식이다.
 */
const inAddedTime = (tick: number, kickoff: number) =>
  kickoff + (tick / TOTAL_TICKS) * 15 >= 90

/** 이 국면의 추가시간(분). 90분을 넘겨 끝나는 만큼이다 */
export const addedTimeOf = (kickoff: number) => kickoff + 15 - 90

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

const ORDER_LABELS: Record<Exclude<PlayerOrder, 'NONE'>, { name: string; hint: string }> = {
  HOLD: { name: '골문 앞', hint: '공이 반대편에 있어도 골문 앞에 남는다' },
  BACK_OFF: { name: '물러서라', hint: '달려들지 않고 자리를 지킨다. 경고·퇴장을 피한다' },
  CONSERVE: { name: '아껴 뛰어라', hint: '전력으로 안 뛴다. 체력이 덜 닳는다' },
}

/** 지시가 걸린 선수 칩에 붙는 짧은 꼬리표 */
const ORDER_TAG: Record<Exclude<PlayerOrder, 'NONE'>, string> = {
  HOLD: '골문',
  BACK_OFF: '물러',
  CONSERVE: '아껴',
}

/**
 * 손볼 이유가 있는 선수를 칩에서 알려준다.
 *
 * 실시간 화면에서 진짜 병목은 조작 비용이 아니라 **판을 읽는 비용**이다.
 * 75초 동안 열한 명의 체력과 경고를 눈으로 훑을 시간이 없다. 급소를 칩이
 * 스스로 말하면 읽는 비용이 0이 되고, 그래도 실행은 여전히 두 번 탭이라
 * 손가락을 내리는 사이 뜻이 바뀌는 오조작이 원리적으로 불가능하다.
 */
function alertOf(s: MatchState['players'][number], press: Level): string | null {
  if (s.stamina < 25) return '부상 위험'
  if (s.booked && press === 2) return '퇴장 위험'
  if (s.stamina < 35) return '지쳤다'
  if (s.booked) return '경고'
  return null
}

/**
 * 선수 지시 — 이 시뮬레이션에서 유일하게 **판 위의 한 점**을 고르는 조작.
 *
 * 레버와 포메이션은 팀 전체에 걸린다. 그것만으로는 "지금 저 선수 하나에게
 * 무엇을 시킨다"가 75초 동안 한 번도 성립하지 않는다.
 *
 * 문법은 하나다 — **선수 칩 1탭 → 행동 칩 1탭.** 같은 자리에서 칩만 바뀌므로
 * 손가락이 60px 움직이고, 조작하는 2초 동안 경기장이 통째로 시야에 남는다.
 * 모달이나 하단 시트를 쓰면 지시하느라 경기를 못 보는데, 실시간 화면에서
 * 그건 조작이 아니라 방해다.
 *
 * 경기장 위를 탭하게 하지 않는다. 폰에서 선수 원의 반지름은 7픽셀이라
 * 손가락 표적이 되지 못한다.
 */
function Orders({
  state,
  onOrder,
}: {
  state: MatchState
  onOrder: (target: string, order: PlayerOrder) => string | null
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 2200)
    return () => clearTimeout(t)
  }, [note])

  // 지시 모드에 갇힌 채 경기를 놓치는 실패를 막는다. 3초 무입력이면 되돌아간다
  useEffect(() => {
    if (!picked) return
    const t = setTimeout(() => setPicked(null), 3000)
    return () => clearTimeout(t)
  }, [picked])

  const onPitch = state.players.filter((s) => s.onPitch && !s.out)
  const active = onPitch.filter((s) => s.order !== 'NONE')
  const cur = picked ? onPitch.find((s) => s.id === picked) : null

  return (
    <section className="panel">
      <h2>
        선수 지시 {active.length}/{MAX_ORDERS}
        {cur ? (
          <span style={{ color: 'var(--accent)' }}> — {getPlayer(cur.id).num}번에게 무엇을</span>
        ) : (
          <span style={{ color: 'var(--dim)', fontWeight: 400 }}> — 선수부터 고르세요</span>
        )}
      </h2>

      <div style={{ padding: 10, display: 'grid', gap: 8 }}>
        {cur ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(ORDER_LABELS) as Array<Exclude<PlayerOrder, 'NONE'>>).map((o) => (
              <button
                key={o}
                className="chip"
                aria-pressed={cur.order === o}
                title={ORDER_LABELS[o].hint}
                onClick={() => {
                  const err = onOrder(cur.id, cur.order === o ? 'NONE' : o)
                  setNote(
                    err ??
                      (cur.order === o
                        ? `${getPlayer(cur.id).num}번 지시 해제`
                        : `${getPlayer(cur.id).num}번 — ${ORDER_LABELS[o].name}`),
                  )
                  setPicked(null)
                }}
                style={{ flex: '1 1 96px', textAlign: 'center', display: 'grid', gap: 1 }}
              >
                <span style={{ fontSize: 14 }}>{ORDER_LABELS[o].name}</span>
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>
                  {cur.order === o ? '누르면 해제' : ''}
                </span>
              </button>
            ))}
            <button
              className="chip"
              onClick={() => setPicked(null)}
              style={{ minWidth: 54, textAlign: 'center' }}
            >
              취소
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {onPitch.map((s) => {
              const p = getPlayer(s.id)
              const alert = alertOf(s, state.tactics.press)
              return (
                <button
                  key={s.id}
                  className="chip"
                  aria-pressed={s.order !== 'NONE'}
                  onClick={() => setPicked(s.id)}
                  style={{ minWidth: 54, textAlign: 'center', display: 'grid', gap: 1 }}
                >
                  <span style={{ fontSize: 15 }}>{p.num}</span>
                  <span style={{ fontSize: 10, color: alert ? 'var(--warn)' : undefined }}>
                    {s.order !== 'NONE' ? ORDER_TAG[s.order] : (alert ?? p.pos)}
                  </span>
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
        {picked ? (
          <span style={{ color: 'var(--accent)' }}> — 나갈 선수를 고르세요</span>
        ) : (
          <span style={{ color: 'var(--dim)', fontWeight: 400 }}> — 넣을 선수부터</span>
        )}
      </h2>

      {/* 교체는 6초 뒤에 반영된다. 그 사이 아무 표시가 없으면 안 눌린 줄 안다 */}
      {state.pendingSubs.length > 0 && (
        <div
          style={{
            padding: '6px 10px',
            display: 'grid',
            gap: 2,
            background: 'var(--panel-2)',
            fontSize: 12,
            color: 'var(--warn)',
          }}
        >
          {state.pendingSubs.map((p) => (
            <span key={p.in}>
              {getPlayer(p.out).num}번 → {getPlayer(p.in).num}번 · 준비 중{' '}
              {Math.max(0, Math.ceil((p.atTick - state.tick) / 10))}초
            </span>
          ))}
        </div>
      )}
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
  const { state, phase, start, reset, setLever, setFormation, substitute, setOrder } =
    useMatch(problem)
  const objective =
    problem.objective.type === 'SURVIVE' ? '리드를 지켜라' : '동점 이상을 만들어라'

  /**
   * 점수판에 띄우는 점수.
   *
   * 시뮬은 확률로 득점을 정하는데, 그 순간의 경기 상황이 골을 그릴 수
   * 있는 상황이 아닌 경우가 절반이 넘는다. 그래서 연출은 골을 예약해두고
   * 공격 장면을 만든 다음 보여주고, 점수판은 그 장면에 맞춰 오른다.
   * 숫자가 먼저 오르면 "공은 하프라인도 못 넘었는데 골"이 된다.
   *
   * **승패 판정은 이 값을 쓰지 않는다.** 아래 `judge(state, ...)` 는
   * 시뮬의 점수를 그대로 읽고, 이 숫자는 종료 휘슬에서 시뮬과 같아진다.
   */
  const [shown, setShown] = useState<[number, number]>(problem.score)
  useEffect(() => setShown(problem.score), [problem])

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
        {inAddedTime(state.tick, kickoff) && (
          <span
            title={`추가시간 ${addedTimeOf(kickoff)}분`}
            style={{
              fontVariantNumeric: 'tabular-nums',
              fontSize: 12,
              padding: '2px 7px',
              borderRadius: 5,
              background: 'var(--warn)',
              color: '#1a1206',
            }}
          >
            +{addedTimeOf(kickoff)}
          </span>
        )}
        <span style={{ fontSize: 13 }}>우리 팀</span>
        <strong style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
          {shown[0]} – {shown[1]}
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
            <Pitch
              state={state}
              seed={problem.seed}
              live={phase === 'RUNNING'}
              onScore={setShown}
            />
          </div>

          {/*
            조작은 경기장 바로 밑에 둔다. 폰에서 이 화면은 1712px인데 한 번에
            보이는 건 812px뿐이라, 아래에 두면 75초짜리 경기 도중에 스크롤을
            내려야 킥오프도 교체도 할 수 있다. 실시간 경기에서 그건 조작이
            없는 것과 같다.
          */}
          {phase === 'READY' && (
            <button
              className="chip"
              aria-pressed
              onClick={start}
              style={{ textAlign: 'center', fontSize: 16, minHeight: 52 }}
            >
              킥오프
            </button>
          )}
          {/*
            지시가 교체보다 위다. 지시는 즉시 걸리고 되돌릴 수 있어 한 판에
            여러 번 쓰지만, 교체는 세 장뿐이고 회수되지 않아 드물게 쓴다.
            자주 쓰는 것이 손가락에 가까워야 한다.
          */}
          {phase === 'RUNNING' && <Orders state={state} onOrder={setOrder} />}
          {phase === 'RUNNING' && <Bench state={state} onSub={substitute} />}
          {phase === 'DONE' && (
            <section className="panel">
              <div style={{ padding: 12, display: 'grid', gap: 8, justifyItems: 'center' }}>
                <strong
                  style={{
                    fontSize: 19,
                    color: judge(state, problem.objective) ? 'var(--accent)' : 'var(--away)',
                  }}
                >
                  {problem.objective.type === 'SURVIVE'
                    ? judge(state, problem.objective)
                      ? '지켜냈다'
                      : '무너졌다'
                    : judge(state, problem.objective)
                      ? '따라잡았다'
                      : '실패했다'}
                </strong>
                <button
                  className="chip"
                  onClick={reset}
                  style={{ textAlign: 'center', minWidth: 140 }}
                >
                  다시 풀기
                </button>
              </div>
            </section>
          )}

          <StatBars state={state} />
        </div>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <section className="panel">
            <h2>이 국면</h2>
            <div style={{ padding: 12, display: 'grid', gap: 6 }}>
              <strong style={{ fontSize: 15 }}>{problem.title}</strong>
              <span style={{ fontSize: 13, color: 'var(--accent)' }}>{objective}</span>
              <span style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                후반 {kickoff}분 · 90분까지 {90 - kickoff}분 + 추가시간 {addedTimeOf(kickoff)}분
                <br />
                앞 감독이 걸어둔 지시를 물려받았습니다.
              </span>
            </div>
          </section>
          <Log state={state} kickoff={kickoff} />
        </div>
      </div>
    </div>
  )
}
