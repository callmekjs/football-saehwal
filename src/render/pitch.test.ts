import { describe, it, expect } from 'vitest'
import { drawPitch, COLORS } from './pitch'
import { VisualMatch, PITCH_H, flagTipY } from './visual'
import { createState } from '../sim/engine'
import type { Problem } from '../sim/types'
import { awayCaptainNumber, homeCaptainNumber } from '../captain'

/**
 * 그리기 자체를 검사한다.
 *
 * 왜 필요한가: 부심 깃발이 **화면 밖에 그려져 아예 안 보이는** 결함이
 * 있었는데, 자동검사 342개가 전부 통과했다. 좌표 계산은 다 맞았고 문제는
 * 그 좌표를 캔버스에 옮기는 마지막 한 걸음이었다.
 *
 * 브라우저 픽셀을 눈으로 세는 방법도 못 미더웠다. 깃발 색이 경고 카드
 * 색과 같아서, 터치라인 근처에 경고를 안은 선수가 서 있으면 그 배지를
 * 깃발로 잘못 세었다. 실제로 두 번 속았다.
 *
 * 그래서 진짜 캔버스 대신 **그리기 명령을 받아 적는 가짜 캔버스**를
 * 넘긴다. 무엇을 어디에 어떤 색으로 그렸는지가 그대로 남으므로 색이
 * 겹치든 선수가 가리든 상관이 없다.
 */
type Op =
  | { op: 'fill'; style: string; pts: Array<[number, number]> }
  | { op: 'stroke'; style: string; width: number; pts: Array<[number, number]> }
  | { op: 'fillRect'; style: string; x: number; y: number; w: number; h: number }
  | { op: 'text'; style: string; text: string; x: number; y: number }

function recorder() {
  const ops: Op[] = []
  let pts: Array<[number, number]> = []
  const st = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1 }
  const stack: Array<typeof st> = []
  const ctx = {
    get fillStyle() {
      return st.fillStyle
    },
    set fillStyle(v: string) {
      st.fillStyle = v
    },
    get strokeStyle() {
      return st.strokeStyle
    },
    set strokeStyle(v: string) {
      st.strokeStyle = v
    },
    get lineWidth() {
      return st.lineWidth
    },
    set lineWidth(v: number) {
      st.lineWidth = v
    },
    globalAlpha: 1,
    lineCap: 'butt',
    font: '',
    textAlign: '',
    textBaseline: '',
    save: () => {
      stack.push({ ...st })
    },
    restore: () => {
      const p = stack.pop()
      if (p) Object.assign(st, p)
    },
    beginPath: () => {
      pts = []
    },
    closePath: () => {},
    moveTo: (x: number, y: number) => {
      pts.push([x, y])
    },
    lineTo: (x: number, y: number) => {
      pts.push([x, y])
    },
    arc: (x: number, y: number) => {
      pts.push([x, y])
    },
    ellipse: (x: number, y: number) => {
      pts.push([x, y])
    },
    fill: () => {
      ops.push({ op: 'fill', style: st.fillStyle, pts: [...pts] })
    },
    stroke: () => {
      ops.push({ op: 'stroke', style: st.strokeStyle, width: st.lineWidth, pts: [...pts] })
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      ops.push({ op: 'fillRect', style: st.fillStyle, x, y, w, h })
    },
    strokeRect: () => {},
    // 글자도 받아 적는다. 판정 한 줄이 실제로 캔버스 안에 그려지는지 봐야 한다
    fillText: (text: string, x: number, y: number) => {
      ops.push({ op: 'text', style: st.fillStyle, text, x, y })
    },
    // 실제 캔버스에는 있고 예전 가짜 캔버스에는 없던 둘. 없으면 그리다 터진다
    measureText: (text: string) => ({ width: text.length * 8 }),
    roundRect: (x: number, y: number, w: number, h: number) => {
      pts.push([x, y], [x + w, y + h])
    },
    setLineDash: () => {},
    translate: () => {},
    rotate: () => {},
    setTransform: () => {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

const P: Problem = {
  id: 'p02',
  title: '잠긴 문',
  order: 1,
  score: [1, 0],
  initialTactics: { line: 1, press: 1, width: 1 },
  initialFormation: '4-4-2',
  objective: { type: 'SURVIVE', bonusOnWin: false },
  seed: 40712,
  subsLeft: 3,
  staminaOverrides: {},
  booked: [],
  unavailable: [],
  awayCount: 11,
}

const W = 815
const H = Math.round((W * 68) / 105)

function render(mutate: (vm: VisualMatch) => void) {
  const s = createState(P)
  const vm = new VisualMatch(s, P.seed)
  mutate(vm)
  const { ctx, ops } = recorder()
  drawPitch(ctx, vm, s, W, H)
  return ops
}

/** 깃발 색으로 칠한 도형들 */
const flagFills = (ops: Op[]) =>
  ops.filter((o): o is Extract<Op, { op: 'fill' }> => o.op === 'fill' && o.style === COLORS.flag)

describe('양 팀 주장이 경기장에서 보인다', () => {
  it('우리 팀과 상대 팀에 C를 하나씩 그린다', () => {
    const state = createState(P)
    const ops = render(() => {})
    const marks = ops.filter(
      (op): op is Extract<Op, { op: 'text' }> =>
        op.op === 'text' && op.text === 'C' && op.style === COLORS.captainText,
    )
    expect(marks).toHaveLength(2)

    const expected = [
      { num: homeCaptainNumber(state.players), style: COLORS.homeText },
      {
        num: awayCaptainNumber(state.away.formation, state.awayCount, state.opponentTeam),
        style: COLORS.awayText,
      },
    ]
    const r = Math.max(7, Math.min(W, H * 1.6) * 0.021)
    const used = new Set<Op>()

    for (const captain of expected) {
      const number = ops.find(
        (op): op is Extract<Op, { op: 'text' }> =>
          op.op === 'text' &&
          op.text === String(captain.num) &&
          op.style === captain.style,
      )
      expect(number).toBeDefined()
      const mark = marks
        .filter((candidate) => !used.has(candidate))
        .sort(
          (a, b) =>
            Math.hypot(a.x - number!.x, a.y - number!.y) -
            Math.hypot(b.x - number!.x, b.y - number!.y),
        )[0]
      expect(mark).toBeDefined()
      used.add(mark)

      const distance = Math.hypot(mark.x - number!.x, mark.y - number!.y)
      // C가 선수 원 안이나 등번호 위가 아니라 원 바깥에 붙어야 한다.
      expect(distance).toBeGreaterThan(r * 1.35)
      // 너무 멀리 떨어지면 누구의 주장 표시인지 알 수 없다.
      expect(distance).toBeLessThan(r * 2.25)
    }
  })
})

describe('부심 깃발이 실제로 그려진다', () => {
  it('깃발을 안 들었으면 깃발 색 도형이 없다', () => {
    const ops = render((vm) => {
      for (const o of vm.officials) o.flag = 0
    })
    expect(flagFills(ops)).toHaveLength(0)
  })

  it('깃발을 들면 깃발 색 삼각형이 그려진다', () => {
    const ops = render((vm) => {
      for (const o of vm.officials) o.flag = o.kind === 'REFEREE' ? 0 : 1.5
    })
    const fills = flagFills(ops)
    // 부심 둘이 각각 하나씩
    expect(fills).toHaveLength(2)
    for (const f of fills) expect(f.pts.length).toBeGreaterThanOrEqual(3)
  })

  it('그려진 깃발이 캔버스 안에 있다', () => {
    /**
     * 이 결함이 실제로 있었다. 실제 부심처럼 터치라인 바깥으로 깃발을
     * 뻗게 그렸더니 위쪽 부심 깃발 끝이 −27픽셀, 아래쪽이 555픽셀
     * (캔버스 높이 528)에 놓여 양쪽 다 통째로 잘렸다.
     */
    const ops = render((vm) => {
      for (const o of vm.officials) o.flag = o.kind === 'REFEREE' ? 0 : 1.5
    })
    for (const f of flagFills(ops)) {
      for (const [x, y] of f.pts) {
        expect(x, `깃발 x=${x}`).toBeGreaterThanOrEqual(0)
        expect(x, `깃발 x=${x}`).toBeLessThanOrEqual(W)
        expect(y, `깃발 y=${y}`).toBeGreaterThanOrEqual(0)
        expect(y, `깃발 y=${y}`).toBeLessThanOrEqual(H)
      }
    }
  })

  it('든 깃발이 내린 것보다 경기장 안쪽으로 더 들어온다', () => {
    // 화면에서 들었는지 내렸는지 구분되어야 신호가 된다
    const up = flagTipY('AR_TOP', true)
    const down = flagTipY('AR_TOP', false)
    expect(up).toBeGreaterThan(down)
    expect(flagTipY('AR_BOTTOM', true)).toBeLessThan(flagTipY('AR_BOTTOM', false))
    // 둘 다 경기장 안
    for (const y of [up, down, flagTipY('AR_BOTTOM', true), flagTipY('AR_BOTTOM', false)]) {
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(PITCH_H)
    }
  })
})

describe('주심이 판정할 때 화면에 나타난다', () => {
  it('경고를 주면 주심 손에 노란 카드가 그려진다', () => {
    const plain = render((vm) => {
      vm.whistle = null
    })
    const carded = render((vm) => {
      vm.whistle = { kind: 'CARD', x: 50, y: 34, red: false, life: 2 }
    })
    const yellowRects = (ops: Op[]) =>
      ops.filter((o) => o.op === 'fillRect' && o.style === COLORS.cardYellow).length
    expect(yellowRects(carded)).toBeGreaterThan(yellowRects(plain))
  })

  it('퇴장이면 빨간 카드다', () => {
    const red = render((vm) => {
      vm.whistle = { kind: 'CARD', x: 50, y: 34, red: true, life: 2 }
    })
    const yellow = render((vm) => {
      vm.whistle = { kind: 'CARD', x: 50, y: 34, red: false, life: 2 }
    })
    const count = (ops: Op[], c: string) =>
      ops.filter((o) => o.op === 'fillRect' && o.style === c).length
    expect(count(red, COLORS.cardRed)).toBeGreaterThan(count(yellow, COLORS.cardRed))
  })
})

/**
 * 오프사이드 라인이 실제로 그려진다.
 *
 * 부심 깃발이 화면 밖에 그려져 안 보이던 일을 겪은 뒤로, 그리기는
 * **그렸는지 · 어디에 그렸는지**를 직접 확인한다.
 */
describe('오프사이드 라인', () => {
  /** 세로로 길게 그은 선 하나를 찾는다 */
  const verticals = (ops: Op[]) =>
    ops.filter(
      (o): o is Extract<Op, { op: 'stroke' }> =>
        o.op === 'stroke' &&
        o.pts.length === 2 &&
        Math.abs(o.pts[0][0] - o.pts[1][0]) < 0.5 &&
        Math.abs(o.pts[0][1] - o.pts[1][1]) > H * 0.8,
    )

  /** 뒤에서 두 번째 수비수를 원하는 x에 세워 오프사이드 라인을 만든다 */
  const placeOffsideLine = (vm: VisualMatch, x: number) => {
    const side = vm.defendingSide()
    const own = side === 'HOME' ? 0 : 105
    const defenders = vm.players.filter((player) => player.side === side)
    for (const player of defenders) player.x = side === 'HOME' ? 104 : 1
    defenders[0].x = own === 0 ? 1 : 104
    defenders[1].x = x
  }

  it('수비하는 팀 색으로 세로 실선을 긋는다', () => {
    const ops = render(() => {})
    const side = (() => {
      const s = createState(P)
      const vm = new VisualMatch(s, P.seed)
      return vm.defendingSide()
    })()
    const want = side === 'HOME' ? COLORS.home : COLORS.away
    expect(verticals(ops).some((o) => o.style === want)).toBe(true)
  })

  it('선이 뒤에서 두 번째 수비수 자리에 있다', () => {
    const s = createState(P)
    const vm = new VisualMatch(s, P.seed)
    const side = vm.defendingSide()
    const expectedX = (vm.offsideLine(side) / 105) * W
    const { ctx, ops } = recorder()
    drawPitch(ctx, vm, s, W, H)
    const want = side === 'HOME' ? COLORS.home : COLORS.away
    const line = verticals(ops).find((o) => o.style === want)
    expect(line).toBeDefined()
    expect(line!.pts[0][0]).toBeCloseTo(expectedX, 1)
  })

  it('그 선이 캔버스 안에 있다', () => {
    const ops = render(() => {})
    for (const o of verticals(ops)) {
      for (const [x, y] of o.pts) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(W)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(H)
      }
    }
  })

  it('수비라인 점선과 색이 겹치지 않는다', () => {
    /**
     * 하늘색 점선은 감독이 **설정한** 수비라인이고, 이 실선은 선수가
     * **실제로 서 있는** 자리다. 둘 다 세로선이므로 색까지 같으면 화면이
     * 서로 다른 두 가지를 같은 것으로 말하게 된다.
     *
     * 점선 쪽도 세로선이라 목록에는 함께 잡힌다. 봐야 할 것은 **둘이
     * 서로 다른 선으로 그려졌는가**다.
     */
    const ops = render(() => {})
    const v = verticals(ops)
    const s = createState(P)
    const vm = new VisualMatch(s, P.seed)
    const side = vm.defendingSide()
    const teamColour = side === 'HOME' ? COLORS.home : COLORS.away
    // 팀 색 선과 하늘색 점선이 둘 다 있고, 색이 서로 다르다
    expect(v.some((o) => o.style === teamColour)).toBe(true)
    expect(v.some((o) => o.style === COLORS.lineMarker)).toBe(true)
    expect(teamColour).not.toBe(COLORS.lineMarker)
  })

  it('하프라인 가까이에서는 좌표를 옮기지 않고 대비 테두리를 더 굵게 긋는다', () => {
    const near = render((vm) => placeOffsideLine(vm, 52.5))
    const clear = render((vm) => placeOffsideLine(vm, 70))
    const nearLines = verticals(near)
    const clearLines = verticals(clear)
    const haloNear = nearLines.find(
      (line) => line.style === COLORS.offsideHalo && Math.abs(line.pts[0][0] - W / 2) < 0.5,
    )
    const haloClear = clearLines.find((line) => line.style === COLORS.offsideHalo)

    expect(haloNear).toBeDefined()
    expect(haloClear).toBeDefined()
    expect(haloNear!.width).toBeGreaterThan(haloClear!.width)

    // 색 테두리만 바뀌고 실제 판정선은 정확히 하프라인 좌표에 남는다
    const s = createState(P)
    const vm = new VisualMatch(s, P.seed)
    placeOffsideLine(vm, 52.5)
    const teamColour = vm.defendingSide() === 'HOME' ? COLORS.home : COLORS.away
    const teamLine = nearLines.find(
      (line) => line.style === teamColour && Math.abs(line.pts[0][0] - W / 2) < 0.5,
    )
    expect(teamLine).toBeDefined()
  })

  it('골 세리머니 중에는 그리지 않는다', () => {
    // 전원이 킥오프 자리로 돌아가는 동안에는 선이 의미 없이 튄다
    const ops = render((vm) => {
      vm.celebration = { side: 'HOME', life: 1.2, x: 100, y: 34 }
    })
    const teamColours = verticals(ops).filter(
      (o) => o.style === COLORS.home || o.style === COLORS.away,
    )
    expect(teamColours).toHaveLength(0)
  })
})

/**
 * 판정 한 줄이 실제로 경기장 안에 그려지는가.
 *
 * 좌표 계산이 맞아도 캔버스 밖에 그리면 소용없다는 것을 부심 깃발에서
 * 이미 한 번 겪었다. 그래서 글자를 받아 적는 가짜 캔버스로 직접 확인한다.
 */
const texts = (ops: Op[]) => ops.filter((o): o is Extract<Op, { op: 'text' }> => o.op === 'text')

describe('왜 공이 넘어갔는지 경기장에 뜬다', () => {
  it('아무 판정도 없으면 판정 글자가 없다', () => {
    const ops = render((vm) => {
      vm.callout = null
      vm.offside = null
    })
    const shown = texts(ops).map((t) => t.text)
    expect(shown).not.toContain('스로인')
    expect(shown).not.toContain('파울')
  })

  it('스로인이면 종류와 누구 공인지 둘 다 그린다', () => {
    const ops = render((vm) => {
      vm.offside = null
      vm.callout = { text: '스로인', side: '우리 공', tone: 'OUT', life: 1.6 }
    })
    const shown = texts(ops).map((t) => t.text)
    expect(shown).toContain('스로인')
    expect(shown).toContain('우리 공')
  })

  it('글자가 경기장 안에 있다', () => {
    // ★ 깃발이 화면 밖에 그려졌던 결함과 같은 종류를 막는다
    const ops = render((vm) => {
      vm.offside = null
      vm.callout = { text: '페널티킥', side: '', tone: 'BIG', life: 1.6 }
    })
    const drawn = texts(ops).filter((t) => t.text === '페널티킥')
    expect(drawn).toHaveLength(1)
    expect(drawn[0].x).toBeGreaterThan(0)
    expect(drawn[0].x).toBeLessThan(W)
    expect(drawn[0].y).toBeGreaterThan(0)
    expect(drawn[0].y).toBeLessThan(H)
  })

  it('페널티킥과 퇴장은 스로인과 다른 색으로 그린다', () => {
    const big = render((vm) => {
      vm.offside = null
      vm.callout = { text: '퇴장', side: '', tone: 'BIG', life: 1.6 }
    })
    const out = render((vm) => {
      vm.offside = null
      vm.callout = { text: '골킥', side: '상대 공', tone: 'OUT', life: 1.6 }
    })
    const colorOf = (ops: Op[], word: string) =>
      texts(ops).find((t) => t.text === word)?.style
    expect(colorOf(big, '퇴장')).toBe(COLORS.cardRed)
    expect(colorOf(out, '골킥')).not.toBe(COLORS.cardRed)
  })

  it('오프사이드일 때는 같은 글자를 두 번 그리지 않는다', () => {
    /**
     * 오프사이드는 위쪽에서 판정 자리에 선과 점까지 붙여 이미 더 잘
     * 설명한다. 둘 다 그리면 "오프사이드"가 화면에 두 번 뜬다.
     */
    const ops = render((vm) => {
      vm.offside = { x: 60, y: 30, by: 'AR_TOP', life: 1.8 }
      vm.callout = { text: '오프사이드', side: '', tone: 'FOUL', life: 1.6 }
    })
    expect(texts(ops).filter((t) => t.text === '오프사이드')).toHaveLength(1)
  })
})
