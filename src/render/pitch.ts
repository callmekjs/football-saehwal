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
 * 선수가 살아 있게 보이는 미세 움직임.
 *
 * 축구에서 공이 없는 선수도 계속 자리를 잡는다. 이게 없으면 공만 굴러가고
 * 사람은 얼어 있는 화면이 된다. 틱과 등번호로 위상을 갈라 각자 다른
 * 주기로 움직이게 한다.
 */
function jitter(tick: number, seed: number): [number, number] {
  const t = tick * 0.055
  return [
    Math.sin(t + seed * 1.7) * 2.0 + Math.sin(t * 0.41 + seed) * 1.2,
    Math.cos(t * 0.83 + seed * 2.3) * 1.7 + Math.sin(t * 0.29 + seed * 0.7) * 1.0,
  ]
}

/** 공에 끌리는 범위. 이보다 멀면 대형만 유지한다 */
const CONVERGE_RADIUS = 24

/**
 * 공 근처 선수를 공 쪽으로 끌어당긴다.
 *
 * 실제 축구에서 공 주변에는 사람이 몰린다. 전원이 대형만 유지하고 있으면
 * 볼 경합이 일어나는 것처럼 보이지 않는다.
 *
 * "가장 가까운 세 명"처럼 잘라내면 네 번째가 세 번째가 되는 순간 갑자기
 * 끌려가 순간이동처럼 보인다. 거리에 따라 연속으로 약해지게 해야 한다.
 */
function converge(dots: Dot[], bx: number, by: number, strength: number) {
  for (const d of dots) {
    if (d.num === 1) continue
    const dist = Math.hypot(d.x - bx, d.y - by)
    if (dist >= CONVERGE_RADIUS) continue
    const near = 1 - dist / CONVERGE_RADIUS
    const k = strength * near * near
    d.x += (bx - d.x) * k
    d.y += (by - d.y) * k
  }
}

/** 상대 배치. 성향에 따라 블록 전체가 앞뒤로 밀리고, 공을 따라 움직인다 */
function awayDots(state: MatchState, bx: number, by: number): Dot[] {
  const mood =
    state.opponent === 'ALL_OUT' ? -13 : state.opponent === 'PARK_BUS' ? 11 : 0
  // 경기가 기운 쪽으로 블록 전체가 옮겨간다. 상대 골대는 x = 0 쪽이다
  const push = state.ball.tilt * -12
  const slide = (by - 34) * 0.45

  const rows: Array<[number, number[]]> = [
    [98, [34]],
    [84, [12, 27, 41, 56]],
    [66, [16, 30, 44, 58]],
    [50, [28, 44]],
  ]
  const nums = [1, 2, 5, 4, 3, 7, 8, 10, 6, 9, 11]
  const limit = state.awayCount === 11 ? 11 : 10

  const dots: Dot[] = []
  let i = 0
  for (const [x, ys] of rows) {
    for (const y of ys) {
      if (i >= limit) break
      const gk = i === 0
      const [jx, jy] = jitter(state.tick, i + 40)
      dots.push({
        x: gk
          ? clamp(x + (bx - 52) * 0.06, 96, 103)
          : clamp(x + mood + push + jx, 26, 102),
        y: gk ? 34 + (by - 34) * 0.12 : clamp(y + slide + jy, 4, 64),
        num: nums[i] ?? 0,
        side: 'AWAY',
        booked: false,
        spent: false,
      })
      i += 1
    }
  }
  converge(dots, bx, by, 0.42)
  return dots
}

/**
 * 우리 배치.
 *
 * 포메이션 좌표가 뼈대이고, 그 위에 수비라인 오프셋 · 점유에 따른 전진
 * 후퇴 · 공을 따라가는 좌우 슬라이드 · 미세 움직임이 얹힌다.
 */
function homeDots(state: MatchState, bx: number, by: number): Dot[] {
  const tenMen = state.homeCount < 11
  const slots = tenMen ? slotsForTenMen(state.formation) : getFormation(state.formation).slots

  const lineShift = (state.tactics.line - 1) * 8
  const widthScale = 0.8 + state.tactics.width * 0.18
  // 밀어붙이면 전체가 올라가고 밀리면 내려온다. 폭이 작으면 축구로 안 보인다
  const push = state.ball.tilt * 13
  const slide = (by - 34) * 0.45

  const onPitch = state.players.filter((s) => s.onPitch && !s.out)

  const dots = slots.map((slot, i) => {
    const s = onPitch[i]
    const p = s ? getPlayer(s.id) : null
    const gk = slot.pos === 'GK'
    const [jx, jy] = jitter(state.tick, i)
    return {
      x: gk
        ? clamp(slot.x + (bx - 52) * 0.06, 2, 9)
        : clamp(slot.x + lineShift + push + jx, 3, 79),
      y: gk
        ? 34 + (by - 34) * 0.12
        : clamp(34 + (slot.y - 34) * widthScale + slide + jy, 4, 64),
      num: p?.num ?? 0,
      side: 'HOME' as const,
      booked: s?.booked ?? false,
      spent: (s?.stamina ?? 100) < 35,
    }
  })
  converge(dots, bx, by, 0.46)
  return dots
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
    const p = ease(`${d.side}${d.num}`, d.x, d.y, 0.12)
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
