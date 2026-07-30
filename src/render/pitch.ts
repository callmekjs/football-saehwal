import {
  GOAL_HALF,
  GOAL_MID,
  PITCH_H,
  PITCH_W,
  type Downed,
  type Leaving,
  flagTipY,
  type Official,
  type Whistle,
  type VisualMatch,
  type VPlayer,
} from './visual'
import type { MatchState } from '../sim/types'
import { awayCaptainNumber, homeCaptainNumber } from '../captain'

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
  /** 오프사이드 실선의 어두운 테두리. 다른 세로선과 붙어도 경계를 남긴다 */
  offsideHalo: 'rgba(4,16,12,0.88)',
  holder: '#ffffff',
  /**
   * 심판 옷. 두 팀 어느 색과도 겹치지 않아야 한다 — 실제 축구 규정이다.
   * 우리 팀은 초록, 상대는 붉은색이라 검정이 남는다.
   */
  official: '#15171c',
  officialTrim: 'rgba(255,255,255,0.72)',
  /** 부심 깃발. 실제 깃발과 같은 노랑-빨강 계열 */
  flag: '#f5c518',
  /** 주장 배지. 어느 팀 유니폼 위에서도 읽히는 중계 그래픽용 짙은 바탕 */
  captain: '#101828',
  captainText: '#ffffff',
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

/**
 * 주장 완장.
 *
 * 등번호 안에 C를 넣으면 한 자리 번호도 못 읽고, 공 소유 링과도 겹친다.
 * 그래서 선수 원 왼쪽 아래 바깥에 별도 배지로 둔다. 경고·피로 표시는
 * 위쪽에 있으므로 세 상태가 동시에 떠도 서로 가리지 않는다.
 *
 * 터치라인 끝까지 간 선수는 배지가 화면 밖으로 잘리지 않도록 경기장
 * 안쪽 방향으로 뒤집는다. 위치만 읽어 결정하며 난수나 경기 계산에는
 * 닿지 않는다.
 */
function drawCaptain(
  ctx: CanvasRenderingContext2D,
  p: VPlayer,
  cx: number,
  cy: number,
  r: number,
) {
  const s = badgeSize(r)
  const d = badgeOffset(r, s) * 1.08
  const bx = cx + (p.x < 7 ? d : -d)
  const by = cy + (p.y > PITCH_H - 5 ? -d * 0.55 : d * 0.55)
  const br = s * 0.72

  ctx.save()
  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.captain
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.88)'
  ctx.lineWidth = Math.max(1.2, s * 0.16)
  ctx.stroke()
  ctx.fillStyle = COLORS.captainText
  ctx.font = `700 ${Math.max(8, Math.round(s * 1.02))}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('C', bx, by + 0.3)
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
  captain: boolean,
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

  if (captain) drawCaptain(ctx, p, cx, cy, r)

  // 상태 배지는 등번호를 가리지 않게 원 바깥에 붙인다.
  // 경고는 오른쪽 위(카드), 체력 고갈은 왼쪽 위(지친 얼굴)
  const s = badgeSize(r)
  const o = badgeOffset(r, s) * 0.78
  if (p.booked) drawCard(ctx, cx + o, cy - o, s, false)
  if (p.stamina < TIRED_AT) drawTired(ctx, cx - o, cy - o, s)
}

/**
 * 교체 화살표.
 *
 * 나가는 선수는 아래로 향한 빨간 삼각형, 들어오는 선수는 위로 향한 초록
 * 삼각형이다. 축구 중계가 쓰는 그 기호다.
 */
function drawSubArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  going: boolean,
) {
  const w = s * 0.85
  const h = s * 1.1
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, s, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(10,14,24,0.82)'
  ctx.fill()
  ctx.beginPath()
  if (going) {
    ctx.moveTo(cx - w / 2, cy - h / 2)
    ctx.lineTo(cx + w / 2, cy - h / 2)
    ctx.lineTo(cx, cy + h / 2)
  } else {
    ctx.moveTo(cx - w / 2, cy + h / 2)
    ctx.lineTo(cx + w / 2, cy + h / 2)
    ctx.lineTo(cx, cy - h / 2)
  }
  ctx.closePath()
  ctx.fillStyle = going ? COLORS.cardRed : COLORS.home
  ctx.fill()
  ctx.restore()
}

/** 교체로 걸어 나가는 선수 */
function drawLeaving(
  ctx: CanvasRenderingContext2D,
  l: Leaving,
  r: number,
  X: (v: number) => number,
  Y: (v: number) => number,
) {
  const cx = X(l.x)
  const cy = Y(l.y)
  const fade = Math.min(1, l.life / 0.7)

  ctx.save()
  ctx.globalAlpha = 0.7 * fade
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.home
  ctx.fill()
  ctx.fillStyle = COLORS.homeText
  ctx.font = `500 ${Math.round(r * 1.05)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(l.num), cx, cy + 0.5)
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = fade
  const s = badgeSize(r)
  drawSubArrow(ctx, cx + badgeOffset(r, s) * 0.78, cy - badgeOffset(r, s) * 0.78, s, true)
  ctx.restore()
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

/**
 * 심판 한 명.
 *
 * 선수와 **섞이면 안 된다.** 색이 같은 계열이면 스물세 번째 선수로
 * 읽히고, 크기가 같으면 등번호 없는 선수로 읽힌다. 그래서 셋 다
 * 검정에 가깝고 선수보다 작다. 실제 중계에서도 심판은 두 팀 어느
 * 색과도 겹치지 않는 옷을 입는다 — 그게 규정이다.
 *
 * 부심은 깃발을 든다. 내려져 있을 때는 몸을 따라 아래로 늘어뜨리고,
 * 판정할 때만 위로 올린다. **깃발이 올라가는 것이 판정 그 자체다** —
 * 축구에서 부심은 말이 아니라 깃발로 말한다.
 */
function drawOfficial(
  ctx: CanvasRenderingContext2D,
  o: Official,
  r: number,
  X: (v: number) => number,
  Y: (v: number) => number,
  whistle: Whistle | null,
) {
  const cx = X(o.x)
  const cy = Y(o.y)
  // 선수보다 확실히 작다. 같은 크기면 등번호 없는 선수로 보인다
  const rr = r * 0.62

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, rr, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.official
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = COLORS.officialTrim
  ctx.stroke()
  ctx.restore()

  if (o.kind === 'REFEREE') {
    // 판정 중인 주심은 팔을 든다. 카드면 손에 카드가 들려 있다
    if (whistle) {
      ctx.save()
      const k = Math.min(1, whistle.life / 1.2)
      ctx.globalAlpha = k
      // 든 팔
      ctx.strokeStyle = COLORS.officialTrim
      ctx.lineWidth = Math.max(1.2, rr * 0.3)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + rr * 1.1, cy - rr * 1.9)
      ctx.stroke()
      if (whistle.kind === 'CARD') {
        drawCard(ctx, cx + rr * 1.3, cy - rr * 2.6, rr * 1.7, whistle.red)
      } else {
        // 휘슬이 울린 표시 — 주심에서 퍼지는 고리
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.globalAlpha = k * 0.75
        ctx.beginPath()
        ctx.arc(cx, cy, rr * (1.8 + (1 - k) * 3), 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }
    return
  }

  /**
   * 깃발은 **경기장 안쪽으로** 뻗는다.
   *
   * 바깥쪽으로 그렸더니 화면 밖에 나가 통째로 안 보였다. 자세한 이유는
   * `flagTipY` 의 주석에 있다 — 여기서는 그 함수가 준 좌표를 그대로 쓴다.
   * 길이를 픽셀이 아니라 미터로 받으므로 화면 크기가 바뀌어도 잘리지
   * 않는다.
   */
  const raised = o.flag > 0
  const tipY = Y(flagTipY(o.kind, raised))
  const dir = Math.sign(tipY - cy) || 1
  ctx.save()
  ctx.strokeStyle = COLORS.officialTrim
  ctx.lineWidth = Math.max(1.2, rr * 0.28)
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, tipY)
  ctx.stroke()
  if (raised) {
    // 노랑 깃발. 실제 부심 깃발의 색이다
    const s = rr * 1.5
    ctx.beginPath()
    ctx.moveTo(cx, tipY)
    ctx.lineTo(cx + s, tipY - dir * s * 0.2)
    ctx.lineTo(cx, tipY - dir * s * 0.85)
    ctx.closePath()
    ctx.fillStyle = COLORS.flag
    ctx.fill()
  }
  ctx.restore()
}

/**
 * 오프사이드 라인 — 뒤에서 두 번째 수비수를 지나는 실선.
 *
 * 중계 화면의 그 선이다. 부심이 이미 이 선 위에 서 있으므로, 선을 그으면
 * **부심이 왜 거기 서 있는지가 저절로 설명된다.** 둘은 같은 것을 가리키는
 * 두 표시다.
 *
 * **수비하는 팀 것 하나만 그린다.** 양쪽을 다 그리면 하프라인·수비라인
 * 표시까지 세로선이 넷이 되어 어느 것이 무슨 뜻인지 못 읽는다.
 *
 * **실선이다.** 수비라인 표시(하늘색)는 점선이고 그건 감독이 **설정한**
 * 값이다. 이 선은 선수들이 **실제로 서 있는** 자리다. 둘은 다른 것이므로
 * 모양으로 갈라놓는다 — 이 프로젝트에서 색이 두 가지 뜻을 가졌다가 아무도
 * 화면을 못 읽게 된 적이 있다.
 *
 * 색은 **수비하는 팀의 색**이다. 초록 선이면 우리가 지키는 중이고, 붉은
 * 선이면 상대가 지키는 중이다. 팀 색은 이미 그 팀을 뜻하므로 새 뜻을
 * 만들지 않는다.
 */
function drawOffsideLine(
  ctx: CanvasRenderingContext2D,
  vm: VisualMatch,
  X: (v: number) => number,
  Y: (v: number) => number,
  sx: number,
  defensiveLine: number,
) {
  // 골 세리머니 중에는 전원이 킥오프 자리로 돌아가 선이 의미 없이 튄다
  if (vm.celebration) return
  const side = vm.defendingSide()
  const x = vm.offsideLine(side)
  // 골라인에 딱 붙으면 골대 선과 겹쳐 읽히지 않는다
  if (x < 1.5 || x > PITCH_W - 1.5) return
  const guideX = 24 + (defensiveLine - 1) * 9
  const nearAnotherLine = Math.min(Math.abs(x - PITCH_W / 2), Math.abs(x - guideX)) <= 3

  ctx.save()
  /**
   * 먼저 어두운 테두리를 긋고 그 위에 팀 색 실선을 올린다.
   *
   * 오프사이드 계산 좌표를 옮기면 부심과 실제 판정선이 갈린다. 좌표는
   * 그대로 두고, 하프라인이나 수비라인 안내선 3m 안에서는 테두리만 더
   * 굵게 해서 정확성과 가독성을 함께 지킨다.
   */
  ctx.strokeStyle = COLORS.offsideHalo
  ctx.globalAlpha = nearAnotherLine ? 0.92 : 0.68
  ctx.lineWidth = Math.max(nearAnotherLine ? 4.8 : 3.4, sx * (nearAnotherLine ? 0.88 : 0.66))
  ctx.beginPath()
  ctx.moveTo(X(x), Y(1))
  ctx.lineTo(X(x), Y(PITCH_H - 1))
  ctx.stroke()

  ctx.strokeStyle = side === 'HOME' ? COLORS.home : COLORS.away
  ctx.globalAlpha = nearAnotherLine ? 0.88 : 0.72
  ctx.lineWidth = Math.max(1.6, sx * 0.34)
  ctx.beginPath()
  ctx.moveTo(X(x), Y(1))
  ctx.lineTo(X(x), Y(PITCH_H - 1))
  ctx.stroke()

  // 양 끝의 짧은 가로 눈금. 중계 그래픽처럼 "이건 그어놓은 선"으로 읽힌다
  ctx.globalAlpha = 0.85
  const tick = 2.2
  for (const y of [1, PITCH_H - 1]) {
    ctx.beginPath()
    ctx.moveTo(X(x - tick), Y(y))
    ctx.lineTo(X(x + tick), Y(y))
    ctx.stroke()
  }
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

  /**
   * 패스·슛 경로. 공이 어디서 어디로 가는지가 보여야 축구로 읽힌다.
   *
   * **흘린 공에는 그리지 않는다.** 뺏긴 공은 `mode` 가 `'PASS'` 라(궤적
   * 계산을 같이 쓴다) 여기까지 흘러들어와, 우리 선수에서 상대 선수로
   * 향하는 하얀 점선이 판당 4.7번 그려지고 있었다. 그건 "건네줬다"는
   * 뜻이 되어버린다. 실수로 흘린 공에는 의도한 경로가 없다.
   */
  if ((b.mode === 'PASS' && b.kick !== 'SPILL') || b.mode === 'SHOT') {
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

  // 오프사이드 라인은 잔디 바로 위, 선수 밑이다. 선이 선수를 가리면
  // 누가 앞서 있는지가 오히려 안 보인다
  drawOffsideLine(ctx, vm, X, Y, sx, state.tactics.line)

  // 심판을 선수보다 먼저 그린다. 겹치면 선수가 위로 지나가야 한다 —
  // 심판이 선수를 가리면 그 순간 화면의 주인공이 바뀐다
  for (const o of vm.officials) {
    drawOfficial(ctx, o, r, X, Y, vm.whistle)
  }

  // 쓰러진 선수와 나가는 선수를 먼저 그린다. 뛰는 선수가 그 위를 지나간다
  for (const d of vm.downed) {
    drawDowned(ctx, d, r, X, Y)
  }
  for (const l of vm.leaving) {
    drawLeaving(ctx, l, r, X, Y)
  }

  const homeCaptain = homeCaptainNumber(state.players)
  const awayCaptain = awayCaptainNumber(state.away.formation, state.awayCount)
  for (const p of vm.players) {
    const captain = p.num === (p.side === 'HOME' ? homeCaptain : awayCaptain)
    drawPlayer(ctx, p, b.holder === p.id, captain, r, X, Y)
    // 방금 들어온 선수에게는 초록 화살표가 붙는다
    if (p.side === 'HOME' && vm.entering.includes(p.num)) {
      const s = badgeSize(r)
      const o = badgeOffset(r, s) * 0.78
      drawSubArrow(ctx, X(p.x) + o, Y(p.y) - o, s, false)
    }
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
    // 사용자가 정한 말이다 — "득점, 실점 글자 나오게 하고"
    ctx.fillText(c.side === 'HOME' ? '득점' : '실점', w / 2, h * 0.42)
    ctx.font = `400 ${Math.round(h * 0.045)}px system-ui, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(c.side === 'HOME' ? '우리 팀이 넣었다' : '상대가 넣었다', w / 2, h * 0.56)
    ctx.restore()
  }

  /**
   * 오프사이드 — 깃발만으로는 못 읽는다.
   *
   * 부심 깃발은 화면 가장자리의 작은 삼각형이라, 처음 보는 사람은 그게
   * 올라간 것을 알아채지 못한다. 판정이 난 자리에 점을 찍고 글자를
   * 붙여서, 왜 공이 갑자기 저기 놓였는지가 설명되게 한다.
   */
  if (vm.offside) {
    const off = vm.offside
    const k = Math.min(1, off.life / 1.8)
    ctx.save()
    ctx.globalAlpha = k
    ctx.strokeStyle = COLORS.flag
    ctx.lineWidth = 2
    ctx.setLineDash([sx * 1.1, sx * 1.1])
    // 판정이 난 자리를 가로지르는 세로선. 여기가 오프사이드 라인이었다
    ctx.beginPath()
    ctx.moveTo(X(off.x), Y(0))
    ctx.lineTo(X(off.x), Y(PITCH_H))
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = COLORS.flag
    ctx.beginPath()
    ctx.arc(X(off.x), Y(off.y), r * 0.5, 0, Math.PI * 2)
    ctx.fill()

    ctx.font = `600 ${Math.max(12, Math.round(h * 0.05))}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('오프사이드', w / 2, h * 0.16)
    ctx.restore()
  }

  /**
   * 왜 공이 넘어갔는지 — 경기장 위 한 줄.
   *
   * 사용자 지적이다 — *"반칙을 하면 파울, 핸드볼, 아웃 표시를 해줘 왜
   * 갑자기 공을 주는 지 모르잖아"*. 위 오프사이드 글자와 **정확히 같은
   * 이유**다. 깃발은 화면 가장자리의 작은 삼각형이고 휘슬은 소리라, 축구
   * 규칙을 아는 사람이 아니면 공이 왜 저쪽 것이 됐는지 알 수 없다.
   *
   * 오른쪽 `경기 이벤트` 목록으로는 대신할 수 없다. 그쪽은 시뮬 기록만
   * 실어서 스로인·코너킥·골킥이 **원리적으로 뜰 수 없고**, 파울은 아예
   * 걸러낸다. 무엇보다 눈이 경기장에 가 있는 동안 옆 목록을 읽지 않는다.
   *
   * **오프사이드일 때는 그리지 않는다.** 바로 위에서 판정 자리에 선과
   * 점까지 붙여 이미 더 잘 설명하고 있다. 둘 다 그리면 같은 글자가 두 번
   * 뜬다.
   */
  if (vm.callout && !vm.offside) {
    const call = vm.callout
    const k = Math.min(1, call.life / 0.4)
    const big = call.tone === 'BIG'
    const size = Math.max(13, Math.round(h * (big ? 0.075 : 0.055)))
    const sub = Math.max(10, Math.round(h * 0.036))
    const midY = h * 0.115

    ctx.save()
    ctx.globalAlpha = k
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // 잔디 위 글자는 그냥 얹으면 초록에 묻힌다. 어두운 띠를 깔아 읽히게 한다
    ctx.font = `700 ${size}px system-ui, sans-serif`
    const textW = ctx.measureText(call.text).width
    const subW = call.side ? ctx.measureText(call.side).width * 0.72 : 0
    const boxW = Math.max(textW, subW) + size * 1.5
    const boxH = size * (call.side ? 2.25 : 1.5)
    ctx.fillStyle = 'rgba(6,20,14,0.76)'
    ctx.beginPath()
    ctx.roundRect(w / 2 - boxW / 2, midY - boxH / 2, boxW, boxH, size * 0.35)
    ctx.fill()

    // 판정의 무게를 색으로도 나눈다. 페널티킥·퇴장이 스로인과 같아 보이면 안 된다
    ctx.fillStyle = big ? COLORS.cardRed : call.tone === 'FOUL' ? COLORS.cardYellow : '#ffffff'
    ctx.fillText(call.text, w / 2, midY - (call.side ? size * 0.42 : 0))

    if (call.side) {
      ctx.font = `500 ${sub}px system-ui, sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.86)'
      ctx.fillText(call.side, w / 2, midY + size * 0.62)
    }
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
