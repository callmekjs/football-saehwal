import {
  GOAL_HALF,
  GOAL_MID,
  PITCH_H,
  PITCH_W,
  type Downed,
  type VisualMatch,
  type VPlayer,
} from './visual'
import type { MatchState } from '../sim/types'

/**
 * 색은 한 가지 뜻만 가진다.
 *
 * 전에는 빨강이 "상대 팀"과 "체력 고갈" 두 뜻이었고 노랑이 "경고"와
 * "수비라인" 두 뜻이었다. 상대 팀 원이 빨간데 그 위에 빨간 호를 그리면
 * 원리적으로 안 보이고, 노란 링과 노란 점선은 서로 무관한 것을 같은 색으로
 * 말한다. 실제로 만든 사람이 자기 화면의 표시를 못 읽었다.
 *
 * 지금은 **뜻을 모양이 지고 색은 거들기만 한다.** 카드는 네모, 부상은
 * 흰 바탕에 빨간 십자, 지친 선수는 얼굴이다. 수비라인은 어느 팀 색도
 * 아닌 하늘색으로 옮겼다.
 */
export const COLORS = {
  grassA: '#2f7d4f',
  grassB: '#2a7248',
  line: 'rgba(255,255,255,0.42)',
  home: '#3ecf8e',
  homeText: '#04331f',
  away: '#e0564b',
  awayText: '#3a0f0b',
  ball: '#ffffff',
  /** 경고 카드 */
  cardYellow: '#f5c518',
  /** 지친 얼굴. 카드 노랑과 헷갈리지 않게 훨씬 옅다 */
  tiredFace: '#ffe9bd',
  /** 퇴장 카드 */
  cardRed: '#d92d20',
  /** 부상 십자 */
  medical: '#d92d20',
  /** 수비라인 안내선. 팀 색과 겹치지 않는 하늘색 */
  lineMarker: '#7cd4ec',
  holder: '#ffffff',
}

/**
 * 상태 배지의 크기.
 *
 * 선수 반지름에 그냥 비례시키면 안 된다. 폰 화면(폭 390px)에서 선수
 * 반지름이 7픽셀이라, 비례로만 잡으면 배지가 5픽셀이 되어 아무 뜻도
 * 전달하지 못한다. **최소 픽셀 크기를 보장한다.**
 */
const badgeSize = (r: number) => Math.max(7.2, r * 0.75)

/**
 * 배지를 선수 원 **바깥**에 놓는 거리.
 *
 * 원 위에 얹으면 등번호를 가린다. 등번호는 누구를 교체할지 정하는 유일한
 * 단서라 가리면 안 된다. 실제로 얹어봤더니 지친 얼굴이 번호를 통째로
 * 덮었다.
 */
const badgeOffset = (r: number, s: number) => r + s * 0.72

/**
 * 지친 얼굴이 뜨는 체력.
 *
 * 이 표시의 쓸모는 "지금 저 선수를 빼라"를 제때 알려주는 데 있다. 늦게
 * 뜨면 아무것도 아니다. 세 국면을 끝까지 돌려 재보니 35 기준으로는
 * 국면 1·2에서 **74초에 처음 떴다.** 경기는 75초에 끝나고 교체 반영에만
 * 6초가 걸리므로, 신호를 보고 나서는 손쓸 방법이 없었다.
 *
 * 45 로 올리면 각각 37초·17초·0초에 뜨고, 동시에 뜨는 선수는 최대
 * 2~4명이라 화면이 어지럽지도 않다. 이 숫자는 확률이 아니라 표시
 * 기준이므로 경기 결과에 영향이 없다.
 */
const TIRED_AT = 45

/** 카드(경고·퇴장). 네모가 곧 뜻이다 */
function drawCard(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, red: boolean) {
  const w = s * 1.3
  const h = s * 1.85
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.18)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(-w / 2 - 1.2, -h / 2 - 1.2, w + 2.4, h + 2.4)
  ctx.fillStyle = red ? COLORS.cardRed : COLORS.cardYellow
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.restore()
}

/** 부상. 흰 바탕에 빨간 십자 — 작은 크기에서도 선명하다 */
function drawMedical(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, s, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1
  ctx.stroke()

  const arm = s * 0.62
  ctx.strokeStyle = COLORS.medical
  ctx.lineWidth = Math.max(2.4, s * 0.42)
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.moveTo(cx - arm, cy)
  ctx.lineTo(cx + arm, cy)
  ctx.moveTo(cx, cy - arm)
  ctx.lineTo(cx, cy + arm)
  ctx.stroke()
  ctx.restore()
}

/**
 * 체력이 바닥난 선수.
 *
 * 지친 얼굴을 직접 그린다. 이모티콘은 13픽셀 밑으로 내려가면 뭉개져
 * 아무 뜻도 전달하지 못하고, 폰 기종마다 그림이 다르다. 눈은 아래로
 * 처진 획, 입은 아래로 굽은 호, 옆에 땀 한 방울이다.
 */
function drawTired(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, s, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.tiredFace
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.strokeStyle = '#3a2c05'
  ctx.lineWidth = Math.max(1.6, s * 0.22)
  ctx.lineCap = 'round'
  // 처진 눈 — 안쪽 끝이 **위**, 바깥쪽 끝이 아래다.
  //
  // 반대로 그리면 안쪽이 내려와 가운데가 V자가 되는데, 그건 지친 얼굴이
  // 아니라 찡그린 얼굴이다. 실제로 반대로 그렸다가 "저 화난 모습은
  // 뭐냐"는 말을 들었다. 눈썹의 방향 하나가 뜻을 통째로 뒤집는다.
  const ex = s * 0.44
  const ey = -s * 0.16
  ctx.beginPath()
  ctx.moveTo(cx - ex - s * 0.2, ey + cy + s * 0.12)
  ctx.lineTo(cx - ex + s * 0.22, ey + cy - s * 0.16)
  ctx.moveTo(cx + ex + s * 0.2, ey + cy + s * 0.12)
  ctx.lineTo(cx + ex - s * 0.22, ey + cy - s * 0.16)
  ctx.stroke()
  // 아래로 굽은 입
  ctx.beginPath()
  ctx.arc(cx, cy + s * 0.72, s * 0.46, Math.PI * 1.15, Math.PI * 1.85)
  ctx.stroke()
  ctx.restore()

  // 땀 한 방울
  ctx.save()
  ctx.fillStyle = '#7cd4ec'
  ctx.beginPath()
  ctx.ellipse(cx + s * 0.92, cy - s * 0.55, s * 0.26, s * 0.36, 0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
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

  ctx.fillStyle = home ? COLORS.homeText : COLORS.awayText
  ctx.font = `500 ${Math.round(r * 1.05)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(p.num), cx, cy + 0.5)

  // 상태 배지는 등번호를 가리지 않게 원 바깥에 붙인다.
  // 경고는 오른쪽 위(카드), 체력 고갈은 왼쪽 위(지친 얼굴)
  const s = badgeSize(r)
  const o = badgeOffset(r, s) * 0.78
  if (p.booked) drawCard(ctx, cx + o, cy - o, s, false)
  if (p.stamina < TIRED_AT) drawTired(ctx, cx - o, cy - o, s)
}

/**
 * 쓰러진 선수.
 *
 * 시뮬에서는 이미 빠졌지만 몇 초 동안 화면에 남는다. 이게 없으면 부상도
 * 퇴장도 사람이 소리 없이 사라지는 것으로만 보인다.
 */
function drawDowned(
  ctx: CanvasRenderingContext2D,
  d: Downed,
  r: number,
  X: (v: number) => number,
  Y: (v: number) => number,
) {
  const cx = X(d.x)
  const cy = Y(d.y)
  // 마지막 0.8초에 서서히 사라진다
  const fade = Math.min(1, d.life / 0.8)

  ctx.save()
  ctx.globalAlpha = 0.75 * fade
  // 누워 있는 몸
  ctx.beginPath()
  ctx.ellipse(cx, cy, r * 1.25, r * 0.62, 0.5, 0, Math.PI * 2)
  ctx.fillStyle = d.side === 'HOME' ? COLORS.home : COLORS.away
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = fade
  const s = badgeSize(r) * 1.15
  if (d.kind === 'INJURY') drawMedical(ctx, cx, cy - r * 1.35, s)
  else drawCard(ctx, cx, cy - r * 1.35, s, true)
  ctx.restore()
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

  // 쓰러진 선수를 먼저 그린다. 뛰는 선수가 그 위를 지나간다
  for (const d of vm.downed) {
    drawDowned(ctx, d, r, X, Y)
  }

  for (const p of vm.players) {
    drawPlayer(ctx, p, b.holder === p.id, r, X, Y)
  }

  // 공. 떠 있는 동안은 땅에 그림자를 남기고 조금 커진다.
  // b.z 는 실제 높이(미터)다 — 뜬 공은 떨어져 튄다
  const br = Math.max(3, r * 0.42) * (1 + Math.min(b.z, 6) * 0.09)
  if (b.z > 0.1) {
    ctx.save()
    ctx.globalAlpha = 0.25
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(X(b.x), Y(b.y), br * 0.9, br * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  ctx.beginPath()
  ctx.arc(X(b.x), Y(b.y) - Y(Math.min(b.z, 8)) * 0.75, br, 0, Math.PI * 2)
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
