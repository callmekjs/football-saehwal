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
}

/** 상대 배치. 성향에 따라 전체가 앞뒤로 밀린다 */
function awayDots(state: MatchState): Dot[] {
  const shift =
    state.opponent === 'ALL_OUT' ? -14 : state.opponent === 'PARK_BUS' ? 12 : 0
  const rows: Array<[number, number[]]> = [
    [96, [34]],
    [82, [12, 27, 41, 56]],
    [64, [16, 30, 44, 58]],
    [48, [28, 44]],
  ]
  const nums = [1, 2, 5, 4, 3, 7, 8, 10, 6, 9, 11]
  const dots: Dot[] = []
  let i = 0
  for (const [x, ys] of rows) {
    for (const y of ys) {
      if (i >= (state.awayCount === 11 ? 11 : 10)) break
      dots.push({
        x: Math.min(101, Math.max(52, x + shift)),
        y,
        num: nums[i] ?? 0,
        side: 'AWAY',
        booked: false,
        spent: false,
      })
      i += 1
    }
  }
  return dots
}

/** 우리 배치. 포메이션 좌표에 수비라인 오프셋과 볼 쏠림을 더한다 */
function homeDots(state: MatchState): Dot[] {
  const tenMen = state.homeCount < 11
  const slots = tenMen ? slotsForTenMen(state.formation) : getFormation(state.formation).slots

  const lineShift = (state.tactics.line - 1) * 9
  const widthScale = 0.82 + state.tactics.width * 0.16
  const ballPull = (state.ball.x - 0.5) * 10

  const onPitch = state.players.filter((s) => s.onPitch && !s.out)

  return slots.map((slot, i) => {
    const s = onPitch[i]
    const p = s ? getPlayer(s.id) : null
    const isGk = slot.pos === 'GK'
    return {
      x: isGk ? slot.x : Math.min(100, Math.max(8, slot.x + lineShift + ballPull)),
      y: isGk ? slot.y : 34 + (slot.y - 34) * widthScale + (state.ball.y - 0.5) * 6,
      num: p?.num ?? 0,
      side: 'HOME' as const,
      booked: s?.booked ?? false,
      spent: (s?.stamina ?? 100) < 35,
    }
  })
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

  for (const d of [...awayDots(state), ...homeDots(state)]) {
    const cx = X(d.x)
    const cy = Y(d.y)
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

  // 볼
  ctx.beginPath()
  ctx.arc(X(state.ball.x * PITCH_W), Y(state.ball.y * PITCH_H), Math.max(3, r * 0.42), 0, Math.PI * 2)
  ctx.fillStyle = COLORS.ball
  ctx.fill()
}
