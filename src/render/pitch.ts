import { getFormation, slotsForTenMen } from '../sim/formations'
import { getPlayer } from '../sim/squad'
import type { MatchState } from '../sim/types'

const PITCH_W = 105
const PITCH_H = 68

export const COLORS = {
  grassA: '#2f7d4f',
  grassB: '#2a7248',
  line: 'rgba(255,255,255,0.42)',
  home: '#3ecf8e',
  homeText: '#04331f',
  away: '#e0564b',
  awayText: '#3a0f0b',
  ball: '#ffffff',
  booked: '#e8c33c',
  spent: '#e0564b',
  lineMarker: '#e8c33c',
}

interface Dot {
  x: number
  y: number
  num: number
  side: 'HOME' | 'AWAY'
  booked: boolean
  spent: boolean
  /** 이 선수가 목표 지점을 따라가는 속도. 전원이 같으면 한 몸처럼 움직인다 */
  lag: number
}

/**
 * 부드럽게 이어 그리기.
 *
 * 계산은 0.1초마다 한 번인데 화면은 초당 60번 그린다. 계산 결과를 그대로
 * 그리면 초당 10번 뚝뚝 끊겨 보인다. 목표 위치로 매 프레임 조금씩 다가가게
 * 하면 같은 데이터로도 움직임이 이어진다. 화면에만 쓰이므로 경기 결과에는
 * 영향이 없다.
 */
const smoothed = new Map<string, { x: number; y: number }>()

function ease(key: string, x: number, y: number, rate: number): { x: number; y: number } {
  const prev = smoothed.get(key)
  if (!prev) {
    const init = { x, y }
    smoothed.set(key, init)
    return init
  }
  // 너무 멀면 순간이동으로 처리한다 (교체·골 후 재개)
  if (Math.abs(prev.x - x) > 40 || Math.abs(prev.y - y) > 30) {
    prev.x = x
    prev.y = y
    return prev
  }
  prev.x += (x - prev.x) * rate
  prev.y += (y - prev.y) * rate
  return prev
}

/** 국면을 새로 시작할 때 잔상을 지운다 */
export function resetSmoothing() {
  smoothed.clear()
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/**
 * 포지션별 행동 규칙.
 *
 * 전원에게 같은 오프셋을 더하면 열한 개 점이 강체처럼 통째로 미끄러진다.
 * 축구는 각자 자기 구역을 맡고 서로 다른 정도로 반응한다. 수비수는 좁게
 * 움직이고 공을 따라 옆으로 크게 밀린다. 미드필더는 가장 넓게 돌아다닌다.
 * 공격수는 앞에 남아 있으려 해서 뒤로는 잘 안 내려온다.
 */
interface Role {
  /** 자기 자리에서 앞뒤·좌우로 벗어날 수 있는 한계 (미터) */
  roamX: number
  roamY: number
  /** 공의 앞뒤 위치를 얼마나 따라가나 */
  followX: number
  /** 공의 좌우 위치를 얼마나 따라가나 */
  followY: number
  /** 밀어붙일 때 전진하는 정도 / 밀릴 때 후퇴하는 정도 */
  pushUp: number
  pushBack: number
  /** 공에 달려붙는 정도 */
  chase: number
  /** 가만히 있을 때의 흔들림 */
  wobble: number
  /** 반응 속도. 낮을수록 굼뜨다 */
  lag: number
}

const ROLES: Record<string, Role> = {
  GK: { roamX: 5, roamY: 7, followX: 0.05, followY: 0.14, pushUp: 3, pushBack: 2, chase: 0, wobble: 0.5, lag: 0.06 },
  DF: { roamX: 15, roamY: 11, followX: 0.30, followY: 0.62, pushUp: 13, pushBack: 9, chase: 0.30, wobble: 1.1, lag: 0.11 },
  MF: { roamX: 23, roamY: 17, followX: 0.46, followY: 0.68, pushUp: 12, pushBack: 13, chase: 0.42, wobble: 2.0, lag: 0.15 },
  FW: { roamX: 19, roamY: 15, followX: 0.38, followY: 0.42, pushUp: 11, pushBack: 6, chase: 0.34, wobble: 1.7, lag: 0.13 },
}

/**
 * 공이 없을 때의 흔들림. 선수마다 주기와 진폭이 다르다.
 *
 * 같은 식에 위상만 다르게 주면 열한 명이 한 몸처럼 흔들린다.
 */
function wobbleOf(tick: number, seed: number, amp: number): [number, number] {
  const a = tick * (0.035 + (seed % 5) * 0.009)
  const b = tick * (0.022 + (seed % 7) * 0.006)
  return [
    (Math.sin(a + seed * 1.7) + Math.sin(b * 1.6 + seed)) * amp,
    (Math.cos(b + seed * 2.3) + Math.sin(a * 0.7 + seed * 0.9)) * amp * 0.8,
  ]
}

/**
 * 한 선수가 이 틱에 있어야 할 자리.
 *
 * 자기 자리(포메이션 좌표)를 기준으로 삼고, 공의 위치와 경기 기울기에
 * 포지션별로 다르게 반응한 뒤, 자기 활동 반경 안으로 묶는다. 반경으로
 * 묶기 때문에 아무리 공을 따라가도 대형이 무너지지 않는다.
 */
function place(
  home: { x: number; y: number },
  role: Role,
  tilt: number,
  bx: number,
  by: number,
  tick: number,
  seed: number,
  attackingRight: boolean,
): { x: number; y: number } {
  const dir = attackingRight ? 1 : -1
  const push = tilt * dir > 0 ? role.pushUp : -role.pushBack
  const [wx, wy] = wobbleOf(tick, seed, role.wobble)

  let x = home.x + Math.abs(tilt) * push * dir + (bx - home.x) * role.followX * 0.4 + wx
  let y = home.y + (by - home.y) * role.followY + wy

  // 공이 자기 구역 가까이 오면 달려나간다. 멀면 자기 자리를 지킨다
  const dist = Math.hypot(x - bx, y - by)
  if (dist < 26 && role.chase > 0) {
    const near = 1 - dist / 26
    const k = role.chase * near * near
    x += (bx - x) * k
    y += (by - y) * k
  }

  return {
    x: clamp(x, home.x - role.roamX, home.x + role.roamX),
    y: clamp(y, home.y - role.roamY, home.y + role.roamY),
  }
}

/** 상대 배치. 성향에 따라 자기 자리 자체가 앞뒤로 옮겨간다 */
function awayDots(state: MatchState, bx: number, by: number): Dot[] {
  const mood =
    state.opponent === 'ALL_OUT' ? -13 : state.opponent === 'PARK_BUS' ? 11 : 0

  const rows: Array<[number, number[], string]> = [
    [98, [34], 'GK'],
    [84, [12, 27, 41, 56], 'DF'],
    [66, [16, 30, 44, 58], 'MF'],
    [50, [28, 44], 'FW'],
  ]
  const nums = [1, 2, 5, 4, 3, 7, 8, 10, 6, 9, 11]
  const limit = state.awayCount === 11 ? 11 : 10

  const dots: Dot[] = []
  let i = 0
  for (const [rowX, ys, pos] of rows) {
    for (const y of ys) {
      if (i >= limit) break
      const role = ROLES[pos]
      const home = { x: pos === 'GK' ? rowX : rowX + mood, y }
      // 상대는 x = 0 쪽을 공격한다
      const p = place(home, role, state.ball.tilt, bx, by, state.tick, i + 41, false)
      dots.push({
        x: clamp(p.x, 24, 103),
        y: clamp(p.y, 4, 64),
        num: nums[i] ?? 0,
        side: 'AWAY',
        booked: false,
        spent: false,
        lag: role.lag * (0.85 + ((i * 37) % 11) / 36),
      })
      i += 1
    }
  }
  return dots
}

/**
 * 우리 배치.
 *
 * 포메이션 좌표가 각자의 자기 자리이고, 그 위에 수비라인 오프셋과 폭
 * 설정이 자리 자체를 옮긴다. 그다음 각 선수가 포지션별 규칙에 따라
 * 따로 반응하되 자기 활동 반경을 벗어나지 않는다.
 */
function homeDots(state: MatchState, bx: number, by: number): Dot[] {
  const tenMen = state.homeCount < 11
  const slots = tenMen ? slotsForTenMen(state.formation) : getFormation(state.formation).slots

  const lineShift = (state.tactics.line - 1) * 8
  const widthScale = 0.8 + state.tactics.width * 0.18
  const onPitch = state.players.filter((s) => s.onPitch && !s.out)

  return slots.map((slot, i) => {
    const s = onPitch[i]
    const info = s ? getPlayer(s.id) : null
    const role = ROLES[slot.pos]
    const gk = slot.pos === 'GK'

    const home = gk
      ? { x: slot.x, y: slot.y }
      : { x: slot.x + lineShift, y: 34 + (slot.y - 34) * widthScale }

    const p = place(home, role, state.ball.tilt, bx, by, state.tick, i, true)
    return {
      x: clamp(p.x, 2, 81),
      y: clamp(p.y, 4, 64),
      num: info?.num ?? 0,
      side: 'HOME' as const,
      booked: s?.booked ?? false,
      spent: (s?.stamina ?? 100) < 35,
      // 지친 선수는 굼뜨게 따라간다
      lag: role.lag * (0.85 + ((i * 53) % 13) / 42) * ((s?.stamina ?? 100) < 35 ? 0.7 : 1),
    }
  })
}

/**
 * 이 틱에 선수들이 서 있어야 할 자리.
 *
 * 그리기와 분리해 두면 캔버스 없이도 움직임을 검증할 수 있다. 브라우저가
 * 화면에 없으면 캔버스가 아예 그려지지 않아 눈으로 확인할 수 없다.
 */
export function computeDots(state: MatchState): Dot[] {
  const bx = state.ball.x * PITCH_W
  const by = state.ball.y * PITCH_H
  return [...awayDots(state, bx, by), ...homeDots(state, bx, by)]
}

export function drawPitch(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  w: number,
  h: number,
) {
  const sx = w / PITCH_W
  const sy = h / PITCH_H
  const X = (v: number) => v * sx
  const Y = (v: number) => v * sy

  // 잔디 줄무늬 — 초록 사각형을 축구장으로 읽히게 하는 가장 싼 장치
  const stripes = 9
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? COLORS.grassA : COLORS.grassB
    ctx.fillRect((w / stripes) * i, 0, w / stripes + 1, h)
  }

  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = Math.max(1, sx * 0.25)

  // 외곽선 · 하프라인 · 센터서클
  ctx.strokeRect(X(1), Y(1), X(PITCH_W - 2), Y(PITCH_H - 2))
  ctx.beginPath()
  ctx.moveTo(X(52.5), Y(1))
  ctx.lineTo(X(52.5), Y(67))
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(X(52.5), Y(34), X(9.15), 0, Math.PI * 2)
  ctx.stroke()

  // 페널티 박스와 골 에어리어 양쪽
  for (const side of [0, 1]) {
    const flip = side === 0 ? 1 : -1
    const base = side === 0 ? 1 : PITCH_W - 1
    ctx.strokeRect(X(base), Y(13.85), X(16.5 * flip), Y(40.3))
    ctx.strokeRect(X(base), Y(24.85), X(5.5 * flip), Y(18.3))
  }

  // 수비라인 표시 — 레버를 당기면 이 선이 움직인다. FM 2D뷰의 상징
  const lineX = 24 + (state.tactics.line - 1) * 9
  ctx.save()
  ctx.strokeStyle = COLORS.lineMarker
  ctx.globalAlpha = 0.85
  ctx.lineWidth = Math.max(1.5, sx * 0.3)
  ctx.setLineDash([sy * 2.2, sy * 1.6])
  ctx.beginPath()
  ctx.moveTo(X(lineX), Y(3))
  ctx.lineTo(X(lineX), Y(65))
  ctx.stroke()
  ctx.restore()

  const r = Math.max(7, Math.min(w, h * 1.6) * 0.021)
  const bx = state.ball.x * PITCH_W
  const by = state.ball.y * PITCH_H

  for (const d of [...awayDots(state, bx, by), ...homeDots(state, bx, by)]) {
    const p = ease(`${d.side}${d.num}`, d.x, d.y, d.lag)
    const cx = X(p.x)
    const cy = Y(p.y)
    const home = d.side === 'HOME'

    if (d.booked) {
      ctx.beginPath()
      ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
      ctx.fillStyle = COLORS.booked
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = home ? COLORS.home : COLORS.away
    ctx.fill()

    if (d.spent) {
      ctx.beginPath()
      ctx.arc(cx, cy, r + 1.5, Math.PI * 0.15, Math.PI * 0.85)
      ctx.strokeStyle = COLORS.spent
      ctx.lineWidth = 2.5
      ctx.stroke()
    }

    ctx.fillStyle = home ? COLORS.homeText : COLORS.awayText
    ctx.font = `500 ${Math.round(r * 1.05)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(d.num), cx, cy + 0.5)
  }

  // 볼. 선수보다 빠르게 따라붙어야 패스가 흐르는 것처럼 보인다
  const b = ease('ball', bx, by, 0.3)
  ctx.beginPath()
  ctx.arc(X(b.x), Y(b.y), Math.max(3, r * 0.42), 0, Math.PI * 2)
  ctx.fillStyle = COLORS.ball
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1
  ctx.stroke()
}
