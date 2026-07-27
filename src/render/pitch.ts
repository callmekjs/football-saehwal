import {
  GOAL_HALF,
  GOAL_MID,
  PITCH_H,
  PITCH_W,
  type VisualMatch,
  type VPlayer,
} from './visual'
import type { MatchState } from '../sim/types'

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
  holder: '#ffffff',
}

function drawField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  X: (v: number) => number,
  Y: (v: number) => number,
  sx: number,
  sy: number,
  line: number,
) {
  // 잔디 줄무늬 — 초록 사각형을 축구장으로 읽히게 하는 가장 싼 장치
  const stripes = 9
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? COLORS.grassA : COLORS.grassB
    ctx.fillRect((w / stripes) * i, 0, w / stripes + 1, h)
  }

  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = Math.max(1, sx * 0.25)
  ctx.strokeRect(X(1), Y(1), X(PITCH_W - 2), Y(PITCH_H - 2))
  ctx.beginPath()
  ctx.moveTo(X(52.5), Y(1))
  ctx.lineTo(X(52.5), Y(67))
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(X(52.5), Y(34), X(9.15), 0, Math.PI * 2)
  ctx.stroke()

  for (const side of [0, 1]) {
    const flip = side === 0 ? 1 : -1
    const base = side === 0 ? 1 : PITCH_W - 1
    ctx.strokeRect(X(base), Y(13.85), X(16.5 * flip), Y(40.3))
    ctx.strokeRect(X(base), Y(24.85), X(5.5 * flip), Y(18.3))
  }

  // 골대와 골망. 이게 없으면 슛이 어디로 들어가는지 알 수 없다
  const depth = 2.4
  for (const side of [0, 1]) {
    const lineX = side === 0 ? 1 : PITCH_W - 1
    const dir = side === 0 ? -1 : 1
    const top = GOAL_MID - GOAL_HALF
    const bot = GOAL_MID + GOAL_HALF

    ctx.save()
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(X(lineX), Y(top), X(depth * dir), Y(GOAL_HALF * 2))

    // 골망 격자
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'
    ctx.lineWidth = 1
    for (let i = 1; i < 5; i++) {
      const yy = top + ((bot - top) / 5) * i
      ctx.beginPath()
      ctx.moveTo(X(lineX), Y(yy))
      ctx.lineTo(X(lineX + depth * dir), Y(yy))
      ctx.stroke()
    }
    for (let i = 1; i < 3; i++) {
      const xx = lineX + ((depth * dir) / 3) * i
      ctx.beginPath()
      ctx.moveTo(X(xx), Y(top))
      ctx.lineTo(X(xx), Y(bot))
      ctx.stroke()
    }

    // 골포스트
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(2, sx * 0.42)
    ctx.beginPath()
    ctx.moveTo(X(lineX), Y(top))
    ctx.lineTo(X(lineX), Y(bot))
    ctx.stroke()
    ctx.restore()
  }

  // 수비라인 표시 — 레버를 당기면 이 선이 움직인다. 개입이 즉시 보인다
  const lineX = 24 + (line - 1) * 9
  ctx.save()
  ctx.strokeStyle = COLORS.lineMarker
  ctx.globalAlpha = 0.8
  ctx.lineWidth = Math.max(1.5, sx * 0.3)
  ctx.setLineDash([sy * 2.2, sy * 1.6])
  ctx.beginPath()
  ctx.moveTo(X(lineX), Y(3))
  ctx.lineTo(X(lineX), Y(65))
  ctx.stroke()
  ctx.restore()
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  p: VPlayer,
  holder: boolean,
  r: number,
  X: (v: number) => number,
  Y: (v: number) => number,
) {
  const cx = X(p.x)
  const cy = Y(p.y)
  const home = p.side === 'HOME'
  const speed = Math.hypot(p.vx, p.vy)

  // 뛰는 방향으로 살짝 늘어난 그림자. 정지와 질주가 눈으로 구분된다
  if (speed > 1.2) {
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(cx - (p.vx / speed) * r * 0.5, cy - (p.vy / speed) * r * 0.5, r * 0.95, r * 0.8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  if (p.booked) {
    ctx.beginPath()
    ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.booked
    ctx.fill()
  }

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = home ? COLORS.home : COLORS.away
  ctx.globalAlpha = speed < 0.5 ? 0.78 : 1
  ctx.fill()
  ctx.globalAlpha = 1

  if (holder) {
    ctx.beginPath()
    ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2)
    ctx.strokeStyle = COLORS.holder
    ctx.lineWidth = 2
    ctx.stroke()
  }

  if (p.stamina < 35) {
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
  ctx.fillText(String(p.num), cx, cy + 0.5)
}

export function drawPitch(
  ctx: CanvasRenderingContext2D,
  vm: VisualMatch,
  state: MatchState,
  w: number,
  h: number,
) {
  const sx = w / PITCH_W
  const sy = h / PITCH_H
  const X = (v: number) => v * sx
  const Y = (v: number) => v * sy

  drawField(ctx, w, h, X, Y, sx, sy, state.tactics.line)

  const r = Math.max(7, Math.min(w, h * 1.6) * 0.021)
  const b = vm.ball

  // 패스·슛 경로. 공이 어디서 어디로 가는지가 보여야 축구로 읽힌다
  if (b.mode === 'PASS' || b.mode === 'SHOT') {
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.strokeStyle = b.mode === 'SHOT' ? '#ffd479' : '#ffffff'
    ctx.lineWidth = b.mode === 'SHOT' ? 2.5 : 1.5
    ctx.setLineDash([sx * 1.2, sx * 1.2])
    ctx.beginPath()
    ctx.moveTo(X(b.fromX), Y(b.fromY))
    ctx.lineTo(X(b.x), Y(b.y))
    ctx.stroke()
    ctx.restore()
  }

  for (const p of vm.players) {
    drawPlayer(ctx, p, b.holder === p.id, r, X, Y)
  }

  // 공. 날아가는 동안은 그림자를 남기고 조금 커진다
  const br = Math.max(3, r * 0.42) * (1 + b.lift * 0.35)
  if (b.lift > 0.05) {
    ctx.save()
    ctx.globalAlpha = 0.25
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(X(b.x), Y(b.y) + br * 1.4, br * 0.9, br * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  ctx.beginPath()
  ctx.arc(X(b.x), Y(b.y) - b.lift * r * 0.8, br, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.ball
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1
  ctx.stroke()

  // 골 세리머니 — 골망이 밝아지고 문구가 뜬다
  if (vm.celebration) {
    const c = vm.celebration
    const k = Math.min(1, c.life / 1.5)
    ctx.save()
    ctx.globalAlpha = k * 0.5
    ctx.fillStyle = c.side === 'HOME' ? COLORS.home : COLORS.away
    ctx.fillRect(
      X(c.side === 'HOME' ? PITCH_W - 3.4 : 1),
      Y(GOAL_MID - GOAL_HALF),
      X(2.4),
      Y(GOAL_HALF * 2),
    )
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = Math.min(1, k * 1.6)
    ctx.fillStyle = c.side === 'HOME' ? COLORS.home : COLORS.away
    ctx.font = `500 ${Math.round(h * 0.11)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(c.side === 'HOME' ? '골!' : '실점', w / 2, h * 0.42)
    ctx.font = `400 ${Math.round(h * 0.045)}px system-ui, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(c.side === 'HOME' ? '우리 팀이 넣었다' : '상대가 넣었다', w / 2, h * 0.56)
    ctx.restore()
  }

  // 태클·슛·골 순간 표시
  for (const f of vm.flashes) {
    const k = f.kind === 'GOAL' ? f.life / 1.4 : f.life / 0.55
    ctx.save()
    ctx.globalAlpha = k * 0.8
    ctx.strokeStyle =
      f.kind === 'GOAL' ? '#ffffff' : f.kind === 'TACKLE' ? '#ffd479' : '#e6f7ef'
    ctx.lineWidth = f.kind === 'GOAL' ? 4 : 2.5
    ctx.beginPath()
    ctx.arc(X(f.x), Y(f.y), r * (1.6 + (1 - k) * (f.kind === 'GOAL' ? 6 : 2.2)), 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}
