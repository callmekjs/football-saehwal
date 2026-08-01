import { useEffect, useRef, useState } from 'react'
import {
  assignFormationSlots,
  FORMATION_IDS,
  formationSlotKey,
  getFormation,
  slotsForPlayers,
  type FormationId,
} from '../sim/formations'
import { awaySlots } from '../sim/awayShape'
import { effectivePos, formationRoleOf, getPlayer } from '../sim/squad'
import { MAX_ORDERS, checkPosition } from '../sim/engine'
/**
 * 배치가 확률에 주는 효과를 **엔진과 같은 함수**로 읽는다.
 *
 * 순수 함수라 난수를 쓰지 않고 경기 결과에 닿지 않는다. 화면이 자기
 * 계산을 따로 갖게 두면 언젠가 한쪽만 바뀌어 거짓말하는 숫자가 된다.
 */
import { positionFactors } from '../sim/tactics'
import { awayCaptainNumber, homeCaptainNumber } from '../captain'
import {
  POSITION_CHOICES,
  boardPointOf,
  displayDepth,
  dropHint,
  isDragMovement,
  positionZone,
  resolveDrop,
  type DropTarget,
} from './squadDrag'
import {
  OUR_ABILITY_AVERAGE,
  opponentAbilityAverage,
  opponentAbilityRatio,
} from '../analysis/opponents'
import { attributeTone, playerDataOf } from './playerData'
import type {
  Level,
  MatchState,
  PlayerOrder,
  PlayerPosition,
  PlayerState,
  Position,
} from '../sim/types'

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
  DROP_BACK: {
    name: '내려서라',
    hint: '수비 쪽으로 내려옵니다. 빠른 선수는 배후를 더 잘 지킵니다',
  },
  PUSH_UP: {
    name: '올라가라',
    hint: '공격에 가담합니다. 득점을 노릴 선수가 한 명 늘어납니다',
  },
  HOLD: { name: '골문 앞', hint: '공이 반대편에 있어도 골문 앞을 지킵니다' },
  BACK_OFF: {
    name: '물러서라',
    hint: '달려들지 않습니다. 경고를 안고 있는 선수에게만 이롭습니다',
  },
  CONSERVE: {
    name: '아껴 뛰어라',
    hint: '전력 질주를 줄입니다. 이미 지친 선수일수록 효과가 큽니다',
  },
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
  if (s.stamina < 25) return { tag: '위험', why: '체력이 바닥나 부상 위험이 큽니다' }
  if (s.booked && press === 2) {
    return { tag: '퇴장', why: '이미 경고를 받았는데 계속 세게 압박하고 있습니다. 퇴장 위험이 큽니다' }
  }
  if (s.stamina < 35) return { tag: '지침', why: '많이 지쳤습니다' }
  if (s.booked) return { tag: '경고', why: '경고를 한 장 받았습니다' }
  return null
}

const AVAILABILITY_LABEL = {
  PLAYING: '경기 중',
  BENCH: '벤치',
  OUT: '경기 이탈',
} as const

/**
 * 선수 한 명의 실제 데이터.
 *
 * 종합 평점·패스·수비처럼 엔진에 없는 값은 만들지 않는다. 체력·속도·
 * 마무리 승수와 현재 역할처럼 경기 계산이 실제로 읽는 값만 보여준다.
 */
export function PlayerDataCard({
  state,
  isCaptain = false,
}: {
  state: PlayerState
  isCaptain?: boolean
}) {
  const data = playerDataOf(state)
  const moved = data.basePosition !== data.currentPosition
  const position = state.position ? positionZone(state.position) : null

  return (
    <section className="player-data-card" aria-label={`${data.number}번 선수 데이터`}>
      <header>
        <strong>
          <b>{data.number}</b>번
          <span>{data.basePosition}</span>
        </strong>
        <div className="player-data-status">
          {isCaptain && <span data-captain="on">주장</span>}
          {data.star && <span data-star="on">스타</span>}
          <span>{AVAILABILITY_LABEL[data.availability]}</span>
          {moved && <span>현재 {data.currentPosition}</span>}
          {data.booked && <span data-alert="on">경고</span>}
          {state.order !== 'NONE' && <span>{ORDER_LABELS[state.order].name}</span>}
          {position && <span>{position.depth} · {position.lane}</span>}
        </div>
      </header>

      <dl className="player-data-metrics">
        <div>
          <dt>현재 체력</dt>
          <dd>{Math.round(data.stamina)}</dd>
        </div>
        <div>
          <dt>명단 기준 체력</dt>
          <dd>{data.rosterStamina}</dd>
        </div>
        <div>
          <dt>속도</dt>
          <dd>{data.speed}</dd>
        </div>
        <div>
          <dt>마무리 영향</dt>
          <dd>{data.finishing.toFixed(2)}×</dd>
        </div>
      </dl>

      {/*
        능력치는 판마다 주인이 바뀐다. 같은 6번이라도 오늘은 발이 가장
        빠르고 다음 판에는 가장 느릴 수 있다. 그래서 명단이 아니라 이
        경기의 상태에서 읽는다.
      */}
      <div className="player-attributes">
        {data.attributeGroups.map((group) => (
          <section key={group.title}>
            <h4>{group.title}</h4>
            <dl>
              {group.rows.map((row) => (
                <div key={row.key} data-used={row.used ? 'on' : 'off'}>
                  <dt>
                    {row.label}
                    {row.used && (
                      <i aria-label="경기 계산에 쓰이는 값" title="경기 계산에 쓰이는 값">
                        ●
                      </i>
                    )}
                  </dt>
                  <dd data-tone={attributeTone(row.value)}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <dl className="player-profile">
        <div><dt>잘 쓰는 발</dt><dd>{data.profile.foot}</dd></div>
        <div><dt>신장</dt><dd>{data.profile.height} cm</dd></div>
        <div><dt>체중</dt><dd>{data.profile.weight} kg</dd></div>
        <div><dt>골키퍼 등급</dt><dd>{data.profile.goalkeeping}</dd></div>
      </dl>

      <p>
        능력치는 1~20이며 전부 창작입니다. <b>●</b> 표시가 이번 경기 계산에
        실제로 들어가는 값이고, 누가 어떤 능력을 갖는지는 판마다 다시 정해집니다.
      </p>
    </section>
  )
}

/** 드래그가 진행 중인 동안만 존재하는 화면 상태 */
interface DragView {
  id: string
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
  /** 지원하는 브라우저에서는 카드가 포인터를 끝까지 붙잡는다 */
  capture: HTMLButtonElement | null
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
 * - **카드를 끌어다 놓기.** 마우스가 있을 때의 빠른 길이다. 빈 공간,
 *   같은 줄, 가로·세로·대각선 어디든 놓은 실제 지점이 선수 자리가 된다.
 *
 * 드래그는 **마우스일 때만** 잡는다. 손가락에도 열어두려면 카드 위에서
 * 페이지 스크롤을 막아야 하는데, 카드 열한 장이 판을 덮고 있어서 좁은
 * 화면에서 페이지가 안 내려가게 된다. 되던 조작을 망가뜨리면서 얻는
 * 빠른 길은 손해다.
 *
 * **중앙 경기장 캔버스 위의 선수 원은 여전히 끌 수 없다.** 반지름이 7픽셀이라
 * 마우스로 겨냥할 수 있는 표적이 아니다. 카드는 44px 이라 잡힌다.
 */
export function SquadPanel({
  state,
  locked,
  onOrder,
  onPosition,
  onFormation,
  subIn = null,
  onSubOut,
}: {
  state: MatchState
  /** 끝난 경기에는 지시할 수 없다 */
  locked: boolean
  onOrder: (target: string, order: PlayerOrder) => string | null
  onPosition: (target: string, position: PlayerPosition | null) => string | null
  onFormation: (f: FormationId) => void
  /**
   * 벤치에서 이미 고른 **들어올 선수**. 없으면 `null`.
   *
   * 값이 있는 동안 이 판의 카드는 「나갈 선수」를 고르는 곳이 된다.
   * 「나갈 선수 선택」이라는 문구가 이 판 바로 위에 뜨는데, 처음 보는
   * 사람은 화면에서 가장 크고 위에 있는 이 카드를 먼저 누른다. 그때
   * 선수 상세만 열리면 눌러도 아무 일이 없는 화면이 된다.
   */
  subIn?: string | null
  /** 나갈 선수를 골랐다. 막히면 사유를 돌려준다 */
  onSubOut?: (out: string) => string | null
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const seats = useRef<{
    key: string
    formation: FormationId | ''
    slotKey: string
    map: Map<string, number>
  }>({
    key: '',
    formation: '',
    slotKey: '',
    map: new Map(),
  })
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

  // 선수 데이터를 읽을 시간은 주되 지시 모드에 갇히지는 않게 한다.
  useEffect(() => {
    if (!picked) return
    const t = setTimeout(() => setPicked(null), 7000)
    return () => clearTimeout(t)
  }, [picked])

  // 교체할 선수를 고르는 중에는 열려 있던 선수 상세를 닫는다. 지금 이 판은
  // 「누구를 뺄 것인가」를 묻는 곳이고, 두 물음이 한 자리에 겹치면 안 된다
  useEffect(() => {
    if (subIn) setPicked(null)
  }, [subIn])

  useEffect(() => {
    if (!locked) return
    setPicked(null)
    pointerCleanupRef.current?.()
    pointerCleanupRef.current = null
    const pr = pressRef.current
    try {
      if (pr?.capture?.hasPointerCapture(pr.pointerId)) {
        pr.capture.releasePointerCapture(pr.pointerId)
      }
    } catch {
      // 잠기는 순간 브라우저가 이미 캡처를 놓았을 수 있다
    }
    pressRef.current = null
    setDrag(null)
  }, [locked])

  useEffect(
    () => () => {
      pointerCleanupRef.current?.()
      const pr = pressRef.current
      try {
        if (pr?.capture?.hasPointerCapture(pr.pointerId)) {
          pr.capture.releasePointerCapture(pr.pointerId)
        }
      } catch {
        // 닫히는 중에는 DOM 이 먼저 사라질 수 있다
      }
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
  const captain = homeCaptainNumber(state.players)
  const tenMen = state.homeCount < 11
  const slots = slotsForPlayers(
    state.formation,
    onPitch.map((s) => getPlayer(s.id).pos),
  )
  const currentSlotKey = formationSlotKey(slots)

  const key = `${state.formation}|${onPitch.map((s) => s.id).join(',')}`
  if (seats.current.key !== key) {
    // 교체처럼 자리 모양이 그대로일 때만 뛰던 자리를 보존한다. 포메이션
    // 또는 결원 줄이 바뀌면 raw 자리 번호는 뜻이 달라지므로 역할부터 다시 맞춘다.
    const before =
      seats.current.formation === state.formation && seats.current.slotKey === currentSlotKey
        ? seats.current.map
        : new Map()
    const assigned = assignFormationSlots(onPitch, slots, formationRoleOf, before)
    seats.current = {
      key,
      formation: state.formation,
      slotKey: currentSlotKey,
      map: assigned.seats,
    }
  }
  const placed = assignFormationSlots(
    onPitch,
    slots,
    formationRoleOf,
    seats.current.map,
  ).placed.map(({ player: s, slot }) => ({ s, slot }))

  const active = onPitch.filter((s) => s.order !== 'NONE')
  const cur = picked ? onPitch.find((s) => s.id === picked) : null
  const orders = Object.keys(ORDER_LABELS) as Array<Exclude<PlayerOrder, 'NONE'>>
  const shape: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const slot of slots) shape[slot.pos] += 1

  /**
   * 카드가 실제로 보이는 자리.
   *
   * 자유 위치는 피치 미터를 그대로 판에 투영한다. 포메이션 기본 자리는
   * 기존의 넓게 편 좌표를 유지해 44px 카드가 겹치지 않게 한다. 충돌
   * 검사에는 둘 모두 현재 화면과 같은 지점을 실제 피치 좌표로 환산해
   * 넘기므로, 보이는 카드와 비켜 가는 기준이 다르지 않다.
   */
  const displayPositions = new Map(
    placed.map(({ s, slot }) => {
      if (s.position) {
        const point = boardPointOf(s.position, { width: 100, height: 100 })
        return [
          s.id,
          {
            top: point.y,
            left: point.x,
            collision: s.position,
          },
        ]
      }
      const top = slotTop(displayDepth(slot.x, s.order))
      const left = slotLeft(slot.y)
      return [
        s.id,
        {
          top,
          left,
          // 자유 위치와 같은 0~105 × 0~68 좌표로 바꾸되, 화면상 카드
          // 중심은 한 픽셀도 움직이지 않는다.
          collision: { x: (1 - top / 100) * 105, y: (left / 100) * 68 },
        },
      ]
    }),
  )

  const numOf = (id: string) => getPlayer(id).num

  /**
   * 놓아도 되는가. **엔진의 `checkPosition` 을 그대로 쓴다.**
   *
   * "뒤에 수비가 셋은 남아야 한다"와 골키퍼 제한을 화면에 다시 쓰지
   * 않는다. 드래그와 3×3 버튼이 엔진과 같은 한국어 사유를 보여준다.
   */
  const blockedFor = (id: string, target: DropTarget): string | null => {
    if (target.kind !== 'PLACE') return null
    return checkPosition(state, id, target.position)
  }

  const applyDrop = (id: string, target: DropTarget) => {
    if (target.kind !== 'PLACE') return
    const err = onPosition(id, target.position)
    const zone = positionZone(target.position)
    setNote(err ?? `${numOf(id)}번 — ${zone.depth} · ${zone.lane}`)
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
    if (!pr.moved && !isDragMovement(dx, dy)) return
    pr.moved = true

    const box = field.getBoundingClientRect()
    const target = resolveDrop(
      { x: e.clientX - box.left, y: e.clientY - box.top },
      { width: box.width, height: box.height },
      placed
        .filter(({ s }) => s.id !== pr.id)
        .map(({ s }) => displayPositions.get(s.id)!.collision),
    )
    const blocked = blockedFor(pr.id, target)
    pr.drop = { target, blocked }
    setDrag({ id: pr.id, target, blocked })
  }

  const endPress = (e: Pick<PointerEvent, 'pointerId'>) => {
    const pr = pressRef.current
    if (!pr || pr.pointerId !== e.pointerId) return
    pressRef.current = null
    try {
      if (pr.capture?.hasPointerCapture(pr.pointerId)) {
        pr.capture.releasePointerCapture(pr.pointerId)
      }
    } catch {
      // 포인터가 이미 취소된 브라우저는 놓을 캡처가 없다
    }
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
    const pr = pressRef.current
    try {
      if (pr?.capture?.hasPointerCapture(pr.pointerId)) {
        pr.capture.releasePointerCapture(pr.pointerId)
      }
    } catch {
      // pointercancel 뒤에는 브라우저가 먼저 캡처를 놓을 수 있다
    }
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
    // 교체할 선수를 고르는 중에는 끌지 않는다. 손이 조금만 흔들려도 클릭이
    // 자리 옮기기로 바뀌어 삼켜지므로, 그러면 눌러도 교체가 안 된다
    if (
      e.pointerType !== 'mouse' ||
      e.button !== 0 ||
      locked ||
      subIn !== null ||
      getPlayer(id).pos === 'GK'
    ) return
    clearPointerListeners()
    clickGuard.current = false
    pressRef.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      cancelled: false,
      capture: e.currentTarget,
      drop: null,
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 창 단위 추적도 함께 걸어 캡처가 없는 브라우저에서 같은 동작을 한다
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
  const liveHint = drag ? dropHint(drag.target, drag.blocked, numOf(drag.id)) : null

  /**
   * 지금 배치가 **확률에 실제로 주는 효과.**
   *
   * 사용자가 물었다 — *"포지션을 바꾸면 이게 실제로 어떤 영향을 준다
   * 이런게 실제로 나오나?"* 나오지 않았다. 계산에는 들어가는데
   * (`applyPositions` 가 상대 배후 침투·오픈플레이와 우리 공격 폭에
   * 곱한다) 화면에는 「7번 — 중원 · 오른쪽」이라는 자리 이름만 떴다.
   * 효과가 있는데 감독이 그걸 알 방법이 없었다.
   *
   * ★ **엔진이 쓰는 그 함수를 그대로 부른다.** 화면에 숫자를 따로 적으면
   * 언젠가 한쪽만 바뀌어 「+7.8%」라고 써 놓고 실제로는 다르게 계산되는
   * 화면이 된다. 여기서 보이는 값은 정의상 실제 값이다.
   *
   * **난수를 한 톨도 쓰지 않는다.** 이미 정해진 상태를 읽어 보여줄 뿐이라
   * 경기 결과·확률·저장된 시드에 닿지 않는다.
   */
  const effectOf = (override?: { id: string; position: PlayerPosition | null }) => {
    const players = override
      ? state.players.map((p) =>
          p.id === override.id ? { ...p, position: override.position } : p,
        )
      : state.players
    return positionFactors(players)
  }

  /** 끌고 있으면 **놓을 자리로** 미리 계산한다. 놓기 전에 대가가 보여야 한다 */
  const liveEffect =
    drag && drag.target.kind === 'PLACE' && !drag.blocked
      ? effectOf({ id: drag.id, position: drag.target.position })
      : effectOf()

  /** `+7.8%` · `-9.0%` · `0.0%` */
  const asPercent = (multiplier: number) => {
    const pct = (multiplier - 1) * 100
    const shown = Math.abs(pct) < 0.05 ? 0 : pct
    return `${shown > 0 ? '+' : shown < 0 ? '−' : ''}${Math.abs(shown).toFixed(1)}%`
  }

  const liveZone =
    drag?.target.kind === 'PLACE' ? positionZone(drag.target.position) : null

  /**
   * 3×3 버튼도 드래그와 같은 충돌 보정을 거친다.
   *
   * 같은 구역을 여러 번 누르면 카드가 정확히 포개지지 않고 그 구역 안의
   * 가장 가까운 빈자리로만 조금 비켜 선다.
   */
  const placeFromButton = (id: string, position: PlayerPosition) => {
    const field = fieldRef.current
    let next = position
    if (field) {
      const box = field.getBoundingClientRect()
      const point = boardPointOf(position, { width: box.width, height: box.height })
      const target = resolveDrop(
        point,
        { width: box.width, height: box.height },
        placed
          .filter(({ s }) => s.id !== id)
          .map(({ s }) => displayPositions.get(s.id)!.collision),
      )
      if (target.kind === 'PLACE') next = target.position
    }
    const err = onPosition(id, next)
    const zone = positionZone(next)
    setNote(err ?? `${numOf(id)}번 — ${zone.depth} · ${zone.lane}`)
    if (!err) setPicked(null)
  }

  return (
    <section className="panel squad-panel" aria-label="우리 포메이션과 선수 지시">
      <h2>
        우리 팀
        {tenMen && <span style={{ color: 'var(--away)' }}> · {state.homeCount}명</span>}
        <b>
          배치 {onPitch.filter((s) => s.position !== null).length} · 지시 {active.length}/
          {MAX_ORDERS}
        </b>
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
            disabled={locked}
            title={`${getFormation(id).label} — ${getFormation(id).hint}`}
            onClick={() => onFormation(id)}
          >
            {id}
          </button>
        ))}
      </div>

      <p className="squad-caption">
        <b>{getFormation(state.formation).label}</b> · 수비 {shape.DF}명 · 중원 {shape.MF}명
        · 공격 {shape.FW}명 · 누르면 데이터·지시, 원하는 곳에 놓기
      </p>

      {/*
        배치가 확률에 주는 효과. **끌고 있는 동안에는 놓을 자리로 미리 본다.**

        올리면 공격만 느는 것이 아니라 뒤도 같이 열린다는 것이 이 게임의
        핵심 거래인데, 숫자가 없으면 그 거래가 화면에서 사라진다. 두 값을
        나란히 두어 **공짜가 아니라는 것**이 한눈에 보이게 한다.
      */}
      {liveEffect && (
        <p
          className="squad-effect"
          data-live={drag && !drag.blocked ? 'on' : undefined}
          role="status"
        >
          <span>{drag && !drag.blocked ? '여기 놓으면' : '지금 배치'}</span>
          <b data-tone={liveEffect.attack >= 1 ? 'up' : 'down'}>
            우리 공격 {asPercent(liveEffect.attack)}
          </b>
          <b data-tone={liveEffect.risk >= 1 ? 'bad' : 'good'}>
            상대 역습 위험 {asPercent(liveEffect.risk)}
          </b>
        </p>
      )}

      <div className="squad-shape" data-dragging={drag ? 'on' : undefined}>
        <div className="squad-field" ref={fieldRef}>
          {/*
            끄는 동안 3×3 구역을 보여준다. 텍스트가 수비/중원/공격과
            왼쪽/중앙/오른쪽을 함께 말하므로 색을 못 보아도 목표를 읽는다.
          */}
          {drag && (
            <div className="squad-placement-guide" aria-hidden>
              {(['ATTACK', 'MIDFIELD', 'DEFENCE'] as const).flatMap((depth) =>
                POSITION_CHOICES.filter((choice) => choice.depth === depth).map((choice) => (
                  <span
                    key={`${choice.depth}-${choice.lane}`}
                    data-on={
                      liveZone?.depth === choice.depthLabel &&
                      liveZone?.lane === choice.laneLabel
                        ? drag.blocked
                          ? 'bad'
                          : 'on'
                        : undefined
                    }
                  >
                    {choice.depthLabel} · {choice.laneLabel}
                  </span>
                )),
              )}
            </div>
          )}

          {placed.map(({ s }) => {
            const p = getPlayer(s.id)
            const currentRole = effectivePos(s)
            const isCaptain = p.num === captain
            const warn = alertOf(s, state.tactics.press)
            const tag =
              s.order !== 'NONE'
                ? ORDER_TAG[s.order]
                : s.position
                  ? positionZone(s.position).depth
                  : (warn?.tag ?? currentRole)
            const stamina = Math.max(0, Math.min(100, s.stamina))
            const held = drag?.id === s.id
            const baseDisplay = displayPositions.get(s.id)!
            const preview =
              held && drag.target.kind === 'PLACE'
                ? boardPointOf(drag.target.position, { width: 100, height: 100 })
                : null
            const detail =
              `${p.num}번 ${currentRole} · 체력 ${Math.round(s.stamina)} · 속도 ${p.speed}` +
              (warn ? ` · ${warn.why}` : '') +
              (s.order !== 'NONE' ? ` · 지시: ${ORDER_LABELS[s.order].name}` : '') +
              (s.position ? ` · 자유 위치: ${positionZone(s.position).depth} ${positionZone(s.position).lane}` : '')
            return (
              <button
                key={s.id}
                type="button"
                className="squad-card"
                data-order={s.order !== 'NONE' ? 'on' : undefined}
                data-position={s.position ? 'on' : undefined}
                data-warn={warn ? 'on' : undefined}
                data-captain={isCaptain ? 'on' : undefined}
                data-immovable={p.pos === 'GK' ? 'on' : undefined}
                data-drag={held ? (drag.blocked ? 'bad' : 'on') : undefined}
                aria-pressed={picked === s.id}
                aria-label={
                  isCaptain
                    ? `${p.num}번 주장, ${currentRole}, 체력 ${Math.round(s.stamina)}`
                    : undefined
                }
                disabled={locked}
                title={
                  p.pos === 'GK'
                    ? `${detail} · 골키퍼는 자리를 옮길 수 없습니다 · 누르면 선수 데이터를 봅니다`
                    : `${detail}${isCaptain ? ' · 주장' : ''} · 누르거나 원하는 곳으로 끌어 놓으세요`
                }
                style={{
                  top: `${preview?.y ?? baseDisplay.top}%`,
                  left: `${preview?.x ?? baseDisplay.left}%`,
                  ...(held
                    ? {
                        transform: 'translate(-50%, -50%) scale(1.1)',
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
                  // 들어올 선수를 이미 골랐으면 이 클릭은 **나갈 선수**다.
                  // 골키퍼도 여기서 걸린다 — 자리는 못 옮겨도 교체는 된다
                  if (subIn) {
                    const err = onSubOut?.(s.id) ?? '교체할 수 없습니다'
                    setNote(err ?? `${p.num}번 → ${numOf(subIn)}번`)
                    return
                  }
                  setPicked(picked === s.id ? null : s.id)
                }}
              >
                {isCaptain && (
                  <span className="captain-marker" aria-hidden>
                    C
                  </span>
                )}
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
        ) : subIn ? (
          // 지금 이 판이 무엇을 묻고 있는지 판 아래에서도 한 번 말한다
          <span className="squad-orders-head sub-wait">
            {numOf(subIn)}번이 들어옵니다 · 나갈 선수를 누르세요
          </span>
        ) : cur ? (
          <>
            <PlayerDataCard
              state={cur}
              isCaptain={getPlayer(cur.id).num === captain}
            />
            {getPlayer(cur.id).pos === 'GK' ? (
              <div className="player-data-only">
                <span>골키퍼는 위치·행동 지시를 바꿀 수 없습니다.</span>
                <button className="chip" onClick={() => setPicked(null)}>
                  닫기
                </button>
              </div>
            ) : (
              <>
                <span className="squad-orders-head">
                  <b>{getPlayer(cur.id).num}번</b> · 원하는 곳에 놓기
                </span>
                <div className="squad-position-grid" aria-label={`${getPlayer(cur.id).num}번 위치`}>
                  {POSITION_CHOICES.map((choice) => {
                    const currentZone = cur.position ? positionZone(cur.position) : null
                    return (
                      <button
                        key={`${choice.depth}-${choice.lane}`}
                        className="chip"
                        aria-pressed={
                          currentZone?.depth === choice.depthLabel &&
                          currentZone?.lane === choice.laneLabel
                        }
                        onClick={() => placeFromButton(cur.id, choice.position)}
                      >
                        <strong>{choice.depthLabel}</strong>
                        <small>{choice.laneLabel}</small>
                      </button>
                    )
                  })}
                  <button
                    className="chip position-default"
                    aria-pressed={cur.position === null}
                    onClick={() => {
                      const err = onPosition(cur.id, null)
                      setNote(err ?? `${getPlayer(cur.id).num}번 — 기본 자리`)
                      if (!err) setPicked(null)
                    }}
                  >
                    기본 자리
                  </button>
                </div>
                <span className="squad-orders-head action">행동 지시</span>
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
            )}
          </>
        ) : (
          <>
            <span className="squad-orders-head">
              {locked
                ? '경기가 끝났습니다'
                : '선수를 누르거나 원하는 곳으로 끌어 놓으세요'}
            </span>
            <div className="squad-order-list">
              {active.length === 0 ? (
                <span className="squad-empty">
                  개별 지시 없음 · 동시에 {MAX_ORDERS}명까지
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

/** 상대 판도 자기 골문이 아래다. 상대 좌표를 뒤집어 같은 규칙으로 그린다 */
const awayTop = (x: number) => pct((1 - (105 - x) / 64) * 100)

export function awaySummary(state: MatchState): string {
  const shown = awaySlots(state.away.formation, state.awayCount)
  const counts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const [pos] of shown) counts[pos] += 1
  const shape =
    `${state.away.formation} 대형이며 수비 ${counts.DF}명·중원 ${counts.MF}명·` +
    `공격 ${counts.FW}명입니다.`

  if (state.opponent === 'ALL_OUT') {
    return `상대가 전부 올라와 강하게 압박합니다. ${shape}`
  }
  if (state.opponent === 'PARK_BUS') {
    return `상대가 뒤로 물러나 골문 앞을 채웁니다. ${shape}`
  }
  return `상대가 균형을 유지합니다. ${shape}`
}

export function AwayPanel({ state }: { state: MatchState }) {
  const shown = awaySlots(state.away.formation, state.awayCount)
  // 주장은 팀마다 다르다. 오늘 만난 상대를 넘겨 리더십으로 고르게 한다
  const captain = awayCaptainNumber(state.away.formation, state.awayCount, state.opponentTeam)
  /**
   * 상대 체력은 **팀 하나의 값**이다(`state.awayStamina`).
   *
   * 사용자가 정했다 — *"상대도 부상 지침 그리고 체력바가 우리랑 비슷하게
   * 닮아야 해"*. 다만 상대는 개별 선수를 추적하지 않으므로 선수마다 다른
   * 막대를 만들면 그건 지어낸 값이다. 팀 막대 하나로 보여준다.
   */
  const stamina = Math.max(0, Math.min(100, state.awayStamina))
  const awayAbility = opponentAbilityAverage(state.opponentTeam)
  const abilityRatio = opponentAbilityRatio(state.opponentTeam)
  return (
    <section className="panel away-panel" aria-label="상대 포메이션">
      <h2>
        상대 포메이션
        <span style={{ color: 'var(--muted)' }}> · {state.away.formation}</span>
        {state.awayCount < 11 && (
          <span style={{ color: 'var(--accent)' }}> · {state.awayCount}명</span>
        )}
        <b>읽기 전용</b>
      </h2>

      <p className="squad-caption">위쪽이 우리 골문입니다 · 등번호와 위치만 보입니다</p>

      <div className="away-vitals">
        <span className="away-vitals-label">상대 체력</span>
        <span className="squad-stamina" aria-hidden>
          <i style={{ width: `${stamina}%` }} data-low={stamina < 60 ? 'on' : undefined} />
        </span>
        <b aria-label={`상대 팀 체력 ${Math.round(stamina)}`}>{Math.round(stamina)}</b>
      </div>

      {/*
        상대 개별 능력치는 지어내지 않는다. 엔진이 상대를 선수 단위로
        추적하지 않기 때문이다. 대신 **팀 평균**을 보여준다 — 이 값은
        상대 세기 계수에서 그대로 유도하므로 화면과 실제가 어긋나지 않는다.
      */}
      <div className="away-ability" aria-label={`상대 평균 능력치 ${awayAbility.toFixed(1)}, 우리 ${OUR_ABILITY_AVERAGE.toFixed(1)}`}>
        <span className="away-vitals-label">평균 능력치</span>
        <b data-side={awayAbility > OUR_ABILITY_AVERAGE ? 'over' : 'under'}>
          {awayAbility.toFixed(1)}
        </b>
        <small>
          우리 {OUR_ABILITY_AVERAGE.toFixed(1)} · {abilityRatio.toFixed(2)}배
        </small>
      </div>

      <div className="squad-shape away">
        <div className="squad-field">
          {shown.map(([pos, x, y, num]) => {
            const booked = state.away.booked.includes(num)
            const hurt = state.away.injured === num
            const isCaptain = num === captain
            const mark = booked ? ' · 경고' : ''
            return (
              <span
                key={num}
                className="squad-card away"
                data-booked={booked ? 'on' : undefined}
                data-hurt={hurt ? 'on' : undefined}
                data-captain={isCaptain ? 'on' : undefined}
                role="img"
                aria-label={`${num}번${isCaptain ? ' 주장' : ''}, ${pos}${booked ? ', 경고' : ''}${hurt ? ', 무릎이 좋지 않음' : ''}`}
                title={`${num}번 ${pos}${isCaptain ? ' · 주장' : ''}${mark}${hurt ? ' · 무릎이 좋지 않습니다' : ''}`}
                style={{ top: `${awayTop(x)}%`, left: `${slotLeft(y)}%` }}
              >
                {isCaptain && (
                  <span className="captain-marker" aria-hidden>
                    C
                  </span>
                )}
                <span className="squad-num">{num}</span>
                {booked && <i className="away-card-mark" aria-hidden />}
                {hurt && <i className="away-hurt-mark" aria-hidden />}
              </span>
            )
          })}
        </div>
      </div>

      <p className="away-note">
        {awaySummary(state)}
        {state.away.booked.length > 0 &&
          ` 경고를 받은 선수는 ${state.away.booked.map((n) => `${n}번`).join(' · ')}입니다.`}
        {state.away.injured !== null &&
          ` ${state.away.injured}번은 무릎 상태가 좋지 않습니다.`}
        {' '}개별 능력치는 확인할 수 없습니다. 등번호와 위치만 보입니다.
      </p>
    </section>
  )
}
