import { useEffect, useRef, useState } from 'react'
import {
  FORMATION_IDS,
  getFormation,
  shapeOf,
  slotsForTenMen,
  type FormationId,
  type Slot,
} from '../sim/formations'
import { getPlayer } from '../sim/squad'
import { MAX_ORDERS } from '../sim/engine'
import type { Level, MatchState, PlayerOrder, PlayerState, Position } from '../sim/types'

/**
 * 옆에 세우는 세로 전술판의 좌표계.
 *
 * 포메이션 자리는 `x 0~105`(우리 골문 → 상대 골문) · `y 0~68` 이다. 세로로
 * 세운 판에서는 **아래가 우리 골문, 위가 상대 골문**이므로 x 를 뒤집어
 * 위아래로, y 를 그대로 좌우로 쓴다.
 *
 * 정의역을 실제 쓰이는 구간(`x 4~80` · `y 6~62`)으로 좁힌 이유가 있다.
 * 0~105 을 그대로 펼치면 카드가 판 가운데에 몰려 서로 겹친다. 카드는
 * 손가락 표적이라 44px 아래로 줄일 수 없으므로, 대신 판을 넓게 쓴다.
 * 가장 빡빡한 자리는 3-5-2 의 미드필더 다섯(좌우)과 4-4-2 다이아몬드의
 * 수비-홀딩(위아래)이며, 이 정의역에서 둘 다 44px 이상 벌어진다.
 */
const X0 = 4
const X1 = 80
const Y0 = 6
const Y1 = 62

const pct = (v: number) => (v < 0 ? 0 : v > 100 ? 100 : v)
/** 위아래 — 위가 상대 골문이다 */
export const slotTop = (x: number) => pct((1 - (x - X0) / (X1 - X0)) * 100)
/** 좌우 */
export const slotLeft = (y: number) => pct(((y - Y0) / (Y1 - Y0)) * 100)

export const ORDER_LABELS: Record<Exclude<PlayerOrder, 'NONE'>, { name: string; hint: string }> = {
  DROP_BACK: { name: '내려서라', hint: '수비로 내려간다. 발이 빠르면 배후가 막힌다' },
  PUSH_UP: { name: '올라가라', hint: '공격으로 올라간다. 골 넣을 사람이 하나 는다' },
  HOLD: { name: '골문 앞', hint: '공이 반대편에 있어도 골문 앞에 남는다' },
  BACK_OFF: { name: '물러서라', hint: '달려들지 않고 자리를 지킨다. 경고·퇴장을 피한다' },
  CONSERVE: { name: '아껴 뛰어라', hint: '전력으로 안 뛴다. 체력이 덜 닳는다' },
}

/** 지시가 걸린 선수 카드에 붙는 짧은 꼬리표 */
const ORDER_TAG: Record<Exclude<PlayerOrder, 'NONE'>, string> = {
  DROP_BACK: '↓수비',
  PUSH_UP: '↑공격',
  HOLD: '골문',
  BACK_OFF: '물러',
  CONSERVE: '아껴',
}

/**
 * 손볼 이유가 있는 선수를 카드에서 알려준다.
 *
 * 실시간 화면에서 진짜 병목은 조작 비용이 아니라 **판을 읽는 비용**이다.
 * 75초 동안 열한 명의 체력과 경고를 눈으로 훑을 시간이 없다. 급소를 카드가
 * 스스로 말하면 읽는 비용이 0이 된다.
 */
function alertOf(s: PlayerState, press: Level): { tag: string; why: string } | null {
  if (s.stamina < 25) return { tag: '위험', why: '체력이 바닥이다 — 부상 위험' }
  if (s.booked && press === 2) return { tag: '퇴장', why: '경고를 안고 강하게 압박 중 — 퇴장 위험' }
  if (s.stamina < 35) return { tag: '지침', why: '지쳤다' }
  if (s.booked) return { tag: '경고', why: '경고를 안고 있다' }
  return null
}

/**
 * 선수를 포메이션 자리에 나눠 놓는다.
 *
 * **관전 화면(`src/render/visual.ts`)과 같은 규칙**이어야 한다. 옆 전술판과
 * 경기장이 서로 다른 자리를 가리키면 둘 중 하나는 거짓말이 된다.
 * 규칙은 하나다 — 뛰던 선수는 쓰던 자리를 그대로 지키고, 빈자리는 새로
 * 들어온 선수가 받되 포지션이 맞는 자리를 먼저 준다.
 */
function assign(
  before: Map<string, number>,
  players: PlayerState[],
  slots: Slot[],
): { placed: Array<{ s: PlayerState; slot: Slot }>; next: Map<string, number> } {
  const taken: Array<PlayerState | null> = new Array(slots.length).fill(null)
  const rest: PlayerState[] = []

  for (const s of players) {
    const k = before.get(s.id)
    if (k !== undefined && k >= 0 && k < slots.length && taken[k] === null) taken[k] = s
    else rest.push(s)
  }
  for (const s of rest) {
    const pos = getPlayer(s.id).pos
    let k = taken.findIndex((v, i) => v === null && slots[i].pos === pos)
    if (k < 0) k = taken.findIndex((v) => v === null)
    if (k >= 0) taken[k] = s
  }

  const placed: Array<{ s: PlayerState; slot: Slot }> = []
  const next = new Map<string, number>()
  taken.forEach((s, i) => {
    if (!s) return
    placed.push({ s, slot: slots[i] })
    next.set(s.id, i)
  })
  return { placed, next }
}

/**
 * 옆에 세우는 우리 전술판 — **보는 곳이 아니라 누르는 곳이다.**
 *
 * 열한 명이 지금 포메이션의 실제 자리 모양대로 놓인다. 포메이션을 바꾸면
 * 카드가 새 자리로 옮겨가므로, 그동안 화면에서 잘 읽히지 않던 "4-4-2 를
 * 3-4-3 으로 바꿨다"가 눈으로 보인다.
 *
 * 문법은 하나다 — **선수 카드 1탭 → 행동 1탭.** 카드를 끌어다 놓는 방식은
 * 쓰지 않는다. 판은 그대로 남고 아래 줄만 바뀌므로, 지시하는 2초 동안
 * 가운데 경기장이 통째로 시야에 남는다.
 */
export function SquadPanel({
  state,
  locked,
  onOrder,
  onFormation,
}: {
  state: MatchState
  /** 끝난 경기에는 지시할 수 없다 */
  locked: boolean
  onOrder: (target: string, order: PlayerOrder) => string | null
  onFormation: (f: FormationId) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const seats = useRef<{ key: string; map: Map<string, number> }>({ key: '', map: new Map() })

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 2400)
    return () => clearTimeout(t)
  }, [note])

  // 지시 모드에 갇힌 채 경기를 놓치는 실패를 막는다. 4초 무입력이면 되돌아간다
  useEffect(() => {
    if (!picked) return
    const t = setTimeout(() => setPicked(null), 4000)
    return () => clearTimeout(t)
  }, [picked])

  useEffect(() => {
    if (locked) setPicked(null)
  }, [locked])

  const onPitch = state.players.filter((s) => s.onPitch && !s.out)
  const tenMen = state.homeCount < 11
  const slots = (tenMen ? slotsForTenMen(state.formation) : getFormation(state.formation).slots)
    .slice(0, onPitch.length)

  const key = `${state.formation}|${tenMen}|${onPitch.map((s) => s.id).join(',')}`
  if (seats.current.key !== key) {
    seats.current = { key, map: assign(seats.current.map, onPitch, slots).next }
  }
  const { placed } = assign(seats.current.map, onPitch, slots)

  const active = onPitch.filter((s) => s.order !== 'NONE')
  const cur = picked ? onPitch.find((s) => s.id === picked) : null
  const orders = Object.keys(ORDER_LABELS) as Array<Exclude<PlayerOrder, 'NONE'>>
  const shape = shapeOf(state.formation)

  return (
    <section className="panel squad-panel" aria-label="우리 포메이션과 선수 지시">
      <h2>
        우리 팀
        {tenMen && <span style={{ color: 'var(--away)' }}> · 10명</span>}
        <b>지시 {active.length}/{MAX_ORDERS}</b>
      </h2>

      {/*
        포메이션 고르기를 전술판 안에 둔다. 고르는 곳과 결과가 보이는 곳이
        같은 상자에 있어야 "4-4-2 를 3-4-3 으로 바꿨다"가 눈으로 읽힌다.
        칩에는 짧은 이름만 쓴다 — 아래 한 줄이 고른 것 하나만 풀어 쓴다.
      */}
      <div className="formation-row">
        {FORMATION_IDS.map((id) => (
          <button
            key={id}
            className="chip formation-choice"
            aria-pressed={id === state.formation}
            title={`${getFormation(id).label} — ${getFormation(id).hint}`}
            onClick={() => onFormation(id)}
          >
            {id}
          </button>
        ))}
      </div>

      <p className="squad-caption">
        <b>{getFormation(state.formation).label}</b> · 수비 {shape.DF} 중원 {shape.MF} 공격{' '}
        {shape.FW} · 위쪽이 상대 골문
      </p>

      <div className="squad-shape">
        <div className="squad-field">
          {placed.map(({ s, slot }) => {
            const p = getPlayer(s.id)
            const warn = alertOf(s, state.tactics.press)
            const tag = s.order !== 'NONE' ? ORDER_TAG[s.order] : (warn?.tag ?? p.pos)
            const stamina = Math.max(0, Math.min(100, s.stamina))
            const detail =
              `${p.num}번 ${p.pos} · 체력 ${Math.round(s.stamina)} · 속도 ${p.speed}` +
              (warn ? ` · ${warn.why}` : '') +
              (s.order !== 'NONE' ? ` · 지시: ${ORDER_LABELS[s.order].name}` : '')
            return (
              <button
                key={s.id}
                type="button"
                className="squad-card"
                data-order={s.order !== 'NONE' ? 'on' : undefined}
                data-warn={warn ? 'on' : undefined}
                aria-pressed={picked === s.id}
                disabled={locked || p.pos === 'GK'}
                title={p.pos === 'GK' ? `${detail} · 골키퍼에게는 지시할 수 없다` : detail}
                style={{ top: `${slotTop(slot.x)}%`, left: `${slotLeft(slot.y)}%` }}
                onClick={() => setPicked(picked === s.id ? null : s.id)}
              >
                <span className="squad-num">{p.num}</span>
                <span className="squad-tag">{tag}</span>
                <span className="squad-stamina" aria-hidden>
                  <i style={{ width: `${stamina}%` }} data-low={stamina < 35 ? 'on' : undefined} />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="squad-orders">
        {cur ? (
          <>
            <span className="squad-orders-head">
              <b>{getPlayer(cur.id).num}번</b>에게 무엇을 시킬까
            </span>
            <div className="squad-order-grid">
              {orders.map((o) => (
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
                >
                  {ORDER_LABELS[o].name}
                </button>
              ))}
              <button className="chip" onClick={() => setPicked(null)}>
                취소
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="squad-orders-head">
              {locked ? '경기가 끝났습니다' : '선수를 누르면 지시할 수 있습니다'}
            </span>
            <div className="squad-order-list">
              {active.length === 0 ? (
                <span className="squad-empty">
                  걸린 지시 없음 · 동시에 {MAX_ORDERS}명까지
                </span>
              ) : (
                active.map((s) => (
                  <span key={s.id} className="squad-active">
                    {getPlayer(s.id).num}번 {ORDER_LABELS[s.order as Exclude<PlayerOrder, 'NONE'>].name}
                  </span>
                ))
              )}
            </div>
          </>
        )}
        <span className="squad-note" role="status">
          {note}
        </span>
      </div>
    </section>
  )
}

/**
 * 상대 배치. 읽기 전용이다.
 *
 * 좌표는 `src/render/visual.ts` 의 상대 대형과 같은 자리다. 그 파일은
 * 관전 연출 소관이라 이번 화면 작업에서 건드리지 않기로 했고, 여기서
 * 쓰는 것은 화면에 그릴 좌표뿐이라 이 층에 따로 적었다. 상대 대형을
 * 옮길 일이 생기면 두 곳을 함께 고쳐야 한다.
 *
 * **상대 선수의 이름·능력치는 없다.** 등번호와 서 있는 자리만 보여준다.
 */
const AWAY_SHAPE: Array<{ pos: Position; x: number; y: number; num: number }> = [
  { pos: 'GK', x: 103, y: 34, num: 1 },
  { pos: 'DF', x: 84, y: 12, num: 2 },
  { pos: 'DF', x: 86, y: 27, num: 5 },
  { pos: 'DF', x: 86, y: 41, num: 4 },
  { pos: 'DF', x: 84, y: 56, num: 3 },
  { pos: 'MF', x: 66, y: 14, num: 7 },
  { pos: 'MF', x: 64, y: 29, num: 8 },
  { pos: 'MF', x: 64, y: 39, num: 10 },
  { pos: 'MF', x: 66, y: 54, num: 6 },
  { pos: 'FW', x: 46, y: 27, num: 9 },
  { pos: 'FW', x: 46, y: 41, num: 11 },
]

/** 상대 판도 자기 골문이 아래다. 상대 좌표를 뒤집어 같은 규칙으로 그린다 */
const awayTop = (x: number) => pct((1 - (105 - x) / 64) * 100)

export function AwayPanel({ state }: { state: MatchState }) {
  const shown = AWAY_SHAPE.slice(0, state.awayCount === 11 ? 11 : 10)
  const line = shown.filter((p) => p.pos === 'DF').length
  return (
    <section className="panel away-panel" aria-label="상대 포메이션">
      <h2>
        상대 포메이션
        {state.awayCount < 11 && <span style={{ color: 'var(--accent)' }}> · 10명</span>}
        <b>읽기 전용</b>
      </h2>

      <p className="squad-caption">위쪽이 우리 골문 · 등번호와 서 있는 자리만 보입니다</p>

      <div className="squad-shape away">
        <div className="squad-field">
          {shown.map((p) => (
            <span
              key={p.num}
              className="squad-card away"
              style={{ top: `${awayTop(p.x)}%`, left: `${slotLeft(p.y)}%` }}
            >
              <span className="squad-num">{p.num}</span>
            </span>
          ))}
        </div>
      </div>

      <p className="away-note">
        상대는 뒤로 물러나 {line}명을 뒤에 세우고 골문 앞을 채웠습니다. 개별 능력치는
        볼 수 없습니다 — 보이는 것은 서 있는 자리뿐입니다.
      </p>
    </section>
  )
}
