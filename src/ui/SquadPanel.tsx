import { useEffect, useRef, useState } from 'react'
import {
  FORMATION_IDS,
  getFormation,
  shapeOf,
  slotsForTenMen,
  type FormationId,
  type Slot,
} from '../sim/formations'
import { effectivePos, getPlayer } from '../sim/squad'
import { MAX_ORDERS, checkOrder } from '../sim/engine'
import {
  DRAG_START,
  ZONE_RATIO,
  displayDepth,
  dropHint,
  openLane,
  resolveDrop,
  swapSeats,
  type CardPoint,
  type DropTarget,
} from './squadDrag'
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

/** 드래그가 진행 중인 동안만 존재하는 화면 상태 */
interface DragView {
  id: string
  /** 카드가 원래 자리에서 옮겨진 만큼(px) */
  dx: number
  dy: number
  target: DropTarget
  /** 놓아도 안 되는 이유. 놓기 **전에** 보여준다 */
  blocked: string | null
}

/** 마우스를 누르고 있는 동안 유지하는 것. 화면을 다시 그리지 않는다 */
interface Press {
  id: string
  pointerId: number
  startX: number
  startY: number
  /** 손 떨림을 넘어 실제로 끌었는가 */
  moved: boolean
  /**
   * `Esc` 로 물렀는가.
   *
   * 물렀다고 `Press` 를 통째로 버리지 않는다. 사람은 아직 버튼을 누르고
   * 있고, 손을 떼면 클릭이 따라온다. 그 클릭을 삼키려면 놓는 순간까지
   * 이 누름을 기억하고 있어야 한다.
   */
  cancelled: boolean
  drop: { target: DropTarget; blocked: string | null } | null
}

/**
 * 옆에 세우는 우리 전술판 — **보는 곳이 아니라 누르는 곳이다.**
 *
 * 열한 명이 지금 포메이션의 실제 자리 모양대로 놓인다. 포메이션을 바꾸면
 * 카드가 새 자리로 옮겨가므로, 그동안 화면에서 잘 읽히지 않던 "4-4-2 를
 * 3-4-3 으로 바꿨다"가 눈으로 보인다.
 *
 * 조작은 **두 가지 길**이고 둘 다 같은 곳에 도착한다.
 *
 * - **선수 카드 1탭 → 행동 1탭.** 어디서나 되는 길이다. 마우스가 없어도,
 *   손가락이어도, 키보드만 있어도 된다.
 * - **카드를 끌어다 놓기.** 마우스가 있을 때의 빠른 길이다. 위로 끌면
 *   올라가라, 아래로 끌면 내려서라 — 판이 세로로 서 있고 아래가 우리
 *   골문이라 방향을 설명할 필요가 없다.
 *
 * 드래그는 **마우스일 때만** 잡는다. 손가락에도 열어두려면 카드 위에서
 * 페이지 스크롤을 막아야 하는데, 카드 열한 장이 판을 덮고 있어서 좁은
 * 화면에서 페이지가 안 내려가게 된다. 되던 조작을 망가뜨리면서 얻는
 * 빠른 길은 손해다.
 *
 * **경기장 캔버스 위의 선수 원은 여전히 끌 수 없다.** 반지름이 7픽셀이라
 * 마우스로 겨냥할 수 있는 표적이 아니다. 카드는 44px 이라 잡힌다.
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
  /** 자리를 바꿨다고 화면에 알리는 신호. `seats` 는 ref 라 저 혼자로는 안 그려진다 */
  const [, bumpSeats] = useState(0)

  const fieldRef = useRef<HTMLDivElement>(null)
  const pressRef = useRef<Press | null>(null)
  /** 카드 밖으로 나간 포인터도 끝까지 받는 창 단위 추적을 해제한다 */
  const pointerCleanupRef = useRef<(() => void) | null>(null)
  /** 끌고 난 뒤에 따라오는 click 을 한 번 삼킨다. 안 그러면 지시창이 같이 열린다 */
  const clickGuard = useRef(false)
  const [drag, setDrag] = useState<DragView | null>(null)

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
    if (!locked) return
    setPicked(null)
    pointerCleanupRef.current?.()
    pointerCleanupRef.current = null
    pressRef.current = null
    setDrag(null)
  }, [locked])

  useEffect(
    () => () => {
      pointerCleanupRef.current?.()
    },
    [],
  )

  /**
   * `Esc` 로 취소.
   *
   * 끌다 보면 "아니다" 싶은 순간이 온다. 그때 손을 뗄 데를 찾아 헤매게
   * 하지 않는다. 아무 데나 놓아도 되돌아가지만, 손이 이미 키보드 쪽에
   * 있는 사람에게는 이쪽이 빠르다.
   */
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const pr = pressRef.current
      if (pr) {
        pr.cancelled = true
        pr.drop = null
      }
      setDrag(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dragging])

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

  /**
   * 앞뒤 줄을 옮긴 카드는 새 줄의 가장 넓은 빈칸에 세운다.
   *
   * `PUSH_UP`·`DROP_BACK`은 경기장에서도 선수를 실제로 앞뒤로 옮긴다.
   * 전술판 카드도 같은 방향으로 남되, 이미 그 줄에 있는 카드를 가리지
   * 않도록 좌우 빈칸만 화면에서 자동으로 잡는다.
   */
  const displayPositions = new Map(
    placed.map(({ s, slot }) => [
      s.id,
      { depth: displayDepth(slot.x, s.order), lane: slotLeft(slot.y) },
    ]),
  )
  for (const { s } of placed) {
    if (s.order !== 'PUSH_UP' && s.order !== 'DROP_BACK') continue
    const mine = displayPositions.get(s.id)!
    const line = effectivePos(s)
    const occupied = placed
      .filter(({ s: other }) => other.id !== s.id && effectivePos(other) === line)
      .map(({ s: other }) => displayPositions.get(other.id)!.lane)
    displayPositions.set(s.id, { ...mine, lane: openLane(mine.lane, occupied) })
  }

  /**
   * 카드 중심의 실제 픽셀 좌표.
   *
   * 카드 열한 장을 DOM 에서 재지 않고 자리 좌표에서 바로 계산한다. 화면에
   * 그릴 때 쓰는 것과 **같은 식**이라 둘이 어긋날 수 없다.
   *
   * **골키퍼는 뺀다.** 지시를 받을 수도 자리를 바꿀 수도 없으므로 표적이
   * 아니다. 빼두면 골키퍼 쪽으로 끌었을 때 "골키퍼는 안 됩니다"가 아니라
   * 아래 수비 구역으로 읽힌다 — 그게 사람이 뜻한 바다.
   */
  const pointsOf = (box: DOMRect): CardPoint[] =>
    placed
      .filter(({ slot }) => slot.pos !== 'GK')
      .map(({ s }) => {
        const { depth, lane } = displayPositions.get(s.id)!
        return {
          id: s.id,
          x: (lane / 100) * box.width,
          y: (slotTop(depth) / 100) * box.height,
          depth,
          line: effectivePos(s),
        }
      })

  const numOf = (id: string) => getPlayer(id).num

  /**
   * 놓아도 되는가. **엔진의 `checkOrder` 를 그대로 쓴다.**
   *
   * 검증을 여기 따로 적으면 드래그로 되는 것과 탭으로 되는 것이 조용히
   * 갈린다. "뒤에 수비가 셋은 남아야 한다" 같은 사유 문자열도 같은 곳에서
   * 나오므로 두 길이 같은 말을 한다.
   */
  const blockedFor = (id: string, target: DropTarget): string | null => {
    if (target.kind !== 'ORDER') return null
    const mine = onPitch.find((s) => s.id === id)
    if (mine?.order === target.order) {
      return `${numOf(id)}번은 이미 ${ORDER_LABELS[target.order].name} 입니다`
    }
    return checkOrder(state, id, target.order)
  }

  const applyDrop = (id: string, target: DropTarget) => {
    if (target.kind === 'SWAP') {
      seats.current = {
        key: seats.current.key,
        map: swapSeats(seats.current.map, id, target.id),
      }
      bumpSeats((v) => v + 1)
      setNote(`${numOf(id)}번 ↔ ${numOf(target.id)}번 자리 바꿈 · 배치만 바뀝니다`)
      return
    }
    if (target.kind === 'ORDER') {
      const err = onOrder(id, target.order)
      setNote(err ?? `${numOf(id)}번 — ${ORDER_LABELS[target.order].name}`)
    }
  }

  /**
   * 끌고 난 뒤에 따라오는 클릭을 **한 번만** 삼킨다.
   *
   * 브라우저는 마우스를 떼면 `pointerup` 바로 뒤에 `click` 을 보낸다.
   * 그걸 그냥 두면 카드를 끌어다 놓은 순간 지시창까지 같이 열린다.
   *
   * **다음 차례에 빗장을 반드시 푼다.** 켜둔 채로 두면 그 다음에 오는
   * 진짜 클릭이 먹힌다. 특히 키보드로 `Enter` 를 누르는 사람은 `click`
   * 만 보내고 `pointerdown` 을 보내지 않으므로, 빗장이 남아 있으면
   * 카드를 아예 누를 수 없게 된다.
   */
  const guardNextClick = () => {
    clickGuard.current = true
    window.setTimeout(() => {
      clickGuard.current = false
    }, 0)
  }

  const movePress = (e: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>) => {
    const pr = pressRef.current
    if (!pr || pr.pointerId !== e.pointerId || pr.cancelled) return
    const field = fieldRef.current
    if (!field) return

    const dx = e.clientX - pr.startX
    const dy = e.clientY - pr.startY
    if (!pr.moved && Math.hypot(dx, dy) < DRAG_START) return
    pr.moved = true

    const box = field.getBoundingClientRect()
    const points = pointsOf(box)
    const from = points.find((p) => p.id === pr.id)
    if (!from) return

    const target = resolveDrop(
      from,
      { x: e.clientX - box.left, y: e.clientY - box.top },
      box.height,
      points,
    )
    const blocked = blockedFor(pr.id, target)
    pr.drop = { target, blocked }
    setDrag({ id: pr.id, dx, dy, target, blocked })
  }

  const endPress = (e: Pick<PointerEvent, 'pointerId'>) => {
    const pr = pressRef.current
    if (!pr || pr.pointerId !== e.pointerId) return
    pressRef.current = null
    setDrag(null)
    // 끌지 않았으면 그냥 탭이다. 아래 onClick 이 그대로 받는다
    if (!pr.moved) return
    guardNextClick()
    if (pr.cancelled || !pr.drop) return
    if (pr.drop.blocked) {
      setNote(pr.drop.blocked)
      return
    }
    applyDrop(pr.id, pr.drop.target)
  }

  const cancelPress = () => {
    pressRef.current = null
    setDrag(null)
  }

  const clearPointerListeners = () => {
    pointerCleanupRef.current?.()
    pointerCleanupRef.current = null
  }

  const startPress = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    // 손가락은 지금 그대로 탭 두 단계를 쓴다. 카드 위에서 페이지가 안
    // 내려가면 좁은 화면에서 되던 것이 안 되게 된다
    if (e.pointerType !== 'mouse' || e.button !== 0 || locked) return
    clearPointerListeners()
    clickGuard.current = false
    pressRef.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      cancelled: false,
      drop: null,
    }

    /**
     * 카드에만 `pointermove`를 붙이면 포인터 캡처를 지원하지 않거나 놓친
     * 브라우저에서 카드 경계를 벗어난 순간 추적이 끝난다. 위아래 구역은
     * 카드 밖에 있으므로 그 환경에서는 드래그가 원리적으로 성립하지 않았다.
     * 창에서 끝까지 받아 캡처 지원 여부와 무관하게 같은 동작을 보장한다.
     */
    const onMove = (event: PointerEvent) => movePress(event)
    const onUp = (event: PointerEvent) => {
      clearPointerListeners()
      endPress(event)
    }
    const onCancel = () => {
      clearPointerListeners()
      cancelPress()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    pointerCleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }

  /** 드래그 중에는 지시 줄이 지금 무슨 일이 일어날지 말한다 */
  const liveHint = drag ? dropHint(drag.target, drag.blocked, numOf, numOf(drag.id)) : null

  /** 위아래 구역이 지금 켜져 있는가 */
  const zoneState = (order: 'PUSH_UP' | 'DROP_BACK') => {
    if (!drag || drag.target.kind !== 'ORDER' || drag.target.order !== order) return undefined
    return drag.blocked ? 'bad' : 'on'
  }

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

      <div className="squad-shape" data-dragging={drag ? 'on' : undefined}>
        <div className="squad-field" ref={fieldRef}>
          {/*
            놓을 수 있는 자리는 **끌기 시작할 때 보인다.** 어디까지 가면
            되는지 모른 채 끌면 아무 데나 놓고 아무 일도 일어나지 않는다.

            구역은 판 좌표 그대로다. `resolveDrop` 이 세는 것과 화면에
            그리는 것이 같은 비율이라 "저기 놓았는데 안 걸렸다"가 없다.
          */}
          {drag && (
            <>
              <div
                className="squad-zone up"
                data-on={zoneState('PUSH_UP')}
                style={{ height: `${ZONE_RATIO * 100}%` }}
                aria-hidden
              >
                <span>↑ 올라가라 · 공격으로</span>
              </div>
              <div
                className="squad-zone down"
                data-on={zoneState('DROP_BACK')}
                style={{ height: `${ZONE_RATIO * 100}%` }}
                aria-hidden
              >
                <span>↓ 내려서라 · 수비로</span>
              </div>
            </>
          )}

          {placed.map(({ s }) => {
            const p = getPlayer(s.id)
            const warn = alertOf(s, state.tactics.press)
            const tag = s.order !== 'NONE' ? ORDER_TAG[s.order] : (warn?.tag ?? p.pos)
            const stamina = Math.max(0, Math.min(100, s.stamina))
            const held = drag?.id === s.id
            const isSwapTarget = drag?.target.kind === 'SWAP' && drag.target.id === s.id
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
                data-drag={held ? (drag.blocked ? 'bad' : 'on') : undefined}
                data-drop={isSwapTarget ? 'on' : undefined}
                aria-pressed={picked === s.id}
                disabled={locked || p.pos === 'GK'}
                title={
                  p.pos === 'GK'
                    ? `${detail} · 골키퍼에게는 지시할 수 없다`
                    : `${detail} · 눌러서 지시하거나 위아래로 끌어 옮긴다`
                }
                style={{
                  top: `${slotTop(displayPositions.get(s.id)!.depth)}%`,
                  left: `${displayPositions.get(s.id)!.lane}%`,
                  ...(held
                    ? {
                        transform: `translate(-50%, -50%) translate(${drag.dx}px, ${drag.dy}px) scale(1.1)`,
                      }
                    : null),
                }}
                onPointerDown={(e) => startPress(e, s.id)}
                onClick={() => {
                  // 방금 끌어서 놓은 것이면 지시창까지 같이 열지 않는다
                  if (clickGuard.current) {
                    clickGuard.current = false
                    return
                  }
                  setPicked(picked === s.id ? null : s.id)
                }}
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
        {/*
          끌고 있는 동안에는 이 줄이 **놓기 전에** 결과를 말한다.
          놓은 다음에 "안 됩니다"라고 하면 사람은 이미 손을 뗀 뒤라
          무엇을 다시 해야 하는지 알 수 없다.
        */}
        {liveHint ? (
          <span className="squad-orders-head drag" data-bad={drag?.blocked ? 'on' : undefined}>
            {liveHint}
          </span>
        ) : cur ? (
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
              {locked
                ? '경기가 끝났습니다'
                : '이 배치판의 선수를 누르거나 위아래로 끌어 위치를 바꿉니다'}
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
