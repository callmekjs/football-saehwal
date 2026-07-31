import { describe, it, expect } from 'vitest'
import { FREE_POSITION } from './constants'
import {
  applyOrders,
  applyPositions,
  drainFactorOf,
  positionFactors,
  resolveCoefficients,
} from './tactics'
import type { Level, PlayerOrder, PlayerPosition, PlayerState, Tactics } from './types'

const t = (line: Level, press: Level, width: Level): Tactics => ({ line, press, width })

describe('resolveCoefficients', () => {
  it('전부 보통이면 승수가 1이다', () => {
    const c = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    expect(c.behind).toBeCloseTo(1.0)
    expect(c.steal).toBeCloseTo(1.0)
    expect(c.drain).toBeCloseTo(1.0)
    expect(c.setPiece).toBeCloseTo(1.0)
  })

  it('라인을 올리면 배후 위험과 진입 가치가 함께 오른다', () => {
    const high = resolveCoefficients(t(2, 1, 1), 'BALANCED', false)
    const mid = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    expect(high.behind).toBeGreaterThan(mid.behind * 1.5)
    expect(high.entryXg).toBeGreaterThan(mid.entryXg)
    expect(high.setPiece).toBeLessThan(mid.setPiece)
  })

  it('라인을 내리면 배후는 줄지만 세트피스가 크게 는다', () => {
    // 정확한 값이 아니라 방향과 크기를 본다. 세트피스 승수는 밸런싱에서
    // 조정되는 값이라 숫자를 박아두면 튜닝할 때마다 테스트가 깨진다.
    const low = resolveCoefficients(t(0, 1, 1), 'BALANCED', false)
    const mid = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    expect(low.behind).toBeLessThan(mid.behind * 0.6)
    expect(low.setPiece).toBeGreaterThan(mid.setPiece * 2)
  })

  it('상대가 뭉쳐 있을수록 넓게가 강해진다', () => {
    const parked = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', false)
    const open = resolveCoefficients(t(1, 1, 2), 'ALL_OUT', false)
    expect(parked.widthK).toBeGreaterThan(open.widthK)
    expect(parked.widthK).toBeGreaterThan(1.2)
  })

  it('상대가 뭉쳐 있을 때 좁게는 손해다', () => {
    const narrow = resolveCoefficients(t(1, 1, 0), 'PARK_BUS', false)
    const normal = resolveCoefficients(t(1, 1, 1), 'PARK_BUS', false)
    expect(narrow.widthK).toBeLessThan(normal.widthK * 0.85)
  })

  it('상대가 올라와 있으면 폭의 차이가 크게 줄어든다', () => {
    // 절대값이 아니라 비율로 본다. 상대가 뭉쳐 있을 때와 열려 있을 때의
    // 폭 스프레드 차이가 이 축의 존재 이유이므로, 임의의 임계값보다
    // 두 상황의 대비를 재는 것이 설계 의도에 맞다.
    const spread = (m: 'PARK_BUS' | 'ALL_OUT') =>
      resolveCoefficients(t(1, 1, 2), m, false).widthK -
      resolveCoefficients(t(1, 1, 0), m, false).widthK

    expect(spread('ALL_OUT')).toBeLessThan(spread('PARK_BUS') * 0.5)
  })

  it('상대가 10명이면 더 뭉쳐서 넓게가 더 강해진다', () => {
    const eleven = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', false)
    const ten = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', true)
    expect(ten.widthK).toBeGreaterThanOrEqual(eleven.widthK)
    expect(ten.oppOpen).toBeLessThan(eleven.oppOpen)
  })

  it('강 압박은 탈취를 올리고 체력을 크게 태운다', () => {
    const c = resolveCoefficients(t(1, 2, 1), 'BALANCED', false)
    expect(c.steal).toBeCloseTo(1.4)
    expect(c.drain).toBeCloseTo(1.8)
    expect(c.foul).toBeCloseTo(1.5)
  })

  it('폭을 벌리면 중앙이 열린다', () => {
    // 이 대가가 없으면 넓게가 공짜가 되어 전 국면에서 정답이 되고,
    // 만능 조합이 생겨 "판마다 다른 판단이 필요하다"가 무너진다.
    const wide = resolveCoefficients(t(1, 1, 2), 'BALANCED', false)
    const narrow = resolveCoefficients(t(1, 1, 0), 'BALANCED', false)
    expect(wide.oppOpen).toBeGreaterThan(narrow.oppOpen * 1.3)
  })

  it('폭은 공격 이득과 수비 대가가 같은 방향으로 움직인다', () => {
    // 넓게가 공격에 좋으면 수비에 나쁘고, 좁게는 그 반대여야 교환이 성립한다
    const wide = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', false)
    const narrow = resolveCoefficients(t(1, 1, 0), 'PARK_BUS', false)
    expect(wide.widthK).toBeGreaterThan(narrow.widthK)
    expect(wide.oppOpen).toBeGreaterThan(narrow.oppOpen)
  })

  it('우리가 열 명이면 상대의 모든 공격 경로가 살아난다', () => {
    const eleven = resolveCoefficients(t(1, 1, 1), 'ALL_OUT', false, false)
    const ten = resolveCoefficients(t(1, 1, 1), 'ALL_OUT', false, true)
    expect(ten.behind).toBeGreaterThan(eleven.behind)
    expect(ten.oppOpen).toBeGreaterThan(eleven.oppOpen)
    expect(ten.setPiece).toBeGreaterThan(eleven.setPiece)
  })
})

describe('개별 지시 — applyOrders', () => {
  const p = (
    id: string,
    order: PlayerOrder,
    onPitch = true,
    position: PlayerPosition | null = null,
    extra: Partial<PlayerState> = {},
  ): PlayerState => ({
    id,
    onPitch,
    stamina: 70,
    booked: false,
    out: false,
    order,
    position,
    ...extra,
  })
  const base = () => resolveCoefficients(t(1, 1, 1), 'BALANCED', false)

  it('지시가 하나도 없으면 계수가 비트 단위로 그대로다', () => {
    /**
     * ★ 이 프로젝트에서 가장 중요한 항등이다.
     *
     * 이게 깨지면 저장된 모든 시드의 결과가 달라지고 밸런스 기준선
     * (무개입 11.0 / 47.0 / 38.2)을 처음부터 다시 재야 한다.
     * `toBeCloseTo` 가 아니라 **정확히 같은지**를 본다
     */
    const c = base()
    const after = applyOrders(c, [p('DF04', 'NONE'), p('MF06', 'NONE'), p('FW09', 'NONE')])
    expect(after).toEqual(c)
  })

  it('피치 밖 선수의 지시는 계수에 닿지 않는다', () => {
    // 벤치에 앉은 선수가 골문 앞을 지킬 수는 없다
    const c = base()
    expect(applyOrders(c, [p('DF04', 'HOLD', false)])).toEqual(c)
  })

  it('골문 앞은 상대 마무리를 깎고 우리 공격을 줄인다', () => {
    // 이득과 대가가 함께 걸려야 한다. 대가가 없으면 전 국면에서
    // 켜두는 것이 정답이 되어 "판마다 다른 판단"이 무너진다
    const c = base()
    const one = applyOrders(c, [p('DF04', 'HOLD')])
    expect(one.oppShotXg).toBeLessThan(c.oppShotXg)
    expect(one.widthK).toBeLessThan(c.widthK)

    // 두 명이면 더 깎인다 — 한 명일 때와 같으면 두 번째가 장식이다
    const two = applyOrders(c, [p('DF04', 'HOLD'), p('DF05', 'HOLD')])
    expect(two.oppShotXg).toBeLessThan(one.oppShotXg)
  })

  it('아껴 뛰기는 체력을 아끼고 그 자리를 연다', () => {
    const c = base()
    const one = applyOrders(c, [p('MF06', 'CONSERVE')])
    expect(one.oppOpen).toBeGreaterThan(c.oppOpen)
    expect(drainFactorOf('CONSERVE')).toBeLessThan(drainFactorOf('NONE'))
    expect(drainFactorOf('NONE')).toBe(1)
  })

  it('아껴 뛰기의 이득은 지친 선수일수록 크고 싱싱하면 없다', () => {
    /**
     * 사용자가 정한 성격이 "지친 선수일수록 이롭다"이다. 상수 하나를
     * 곱하면 싱싱한 선수에게 걸어도 똑같이 이로워 그 성격이 사라진다.
     * 체력 만땅이면 이득이 0이고 대가만 남아야 한다
     */
    const c = base()
    const fresh = applyOrders(c, [p('MF06', 'CONSERVE', true, null, { stamina: 100 })])
    const spent = applyOrders(c, [p('MF06', 'CONSERVE', true, null, { stamina: 30 })])
    expect(fresh.openness).toBe(c.openness)
    expect(spent.openness).toBeGreaterThan(fresh.openness)
    // 대가는 지친 정도와 무관하게 언제나 같다
    expect(spent.oppOpen).toBe(fresh.oppOpen)
  })

  it('물러서라는 경고를 안고 있을 때만 이득이 있고 대가는 언제나 있다', () => {
    /**
     * 전에는 계수가 하나도 없이 `events.ts` 의 반칙·퇴장 후보 집합에서만
     * 빠졌다. 실측으로 그 장치는 퇴장을 41.0%에서 17.9%까지 줄이면서도
     * 통과율을 +0.1%p 밖에 못 움직였다 — 이 엔진에서 한 명을 잃는 값이
     * 거의 없기 때문이다. 그래서 반칙이 실제로 주는 것(위험한 자리의
     * 프리킥)을 값으로 삼았다.
     *
     * **경고가 없으면 이득이 없어야 한다.** 그래야 아무에게나 걸어두는
     * 것이 손해가 되어, 앞 감독이 물려준 「물러서라」가 감독이 풀어야 할
     * 잘못된 지시로 남는다
     */
    const c = base()
    const calm = applyOrders(c, [p('MF06', 'BACK_OFF')])
    expect(calm.setPiece).toBe(c.setPiece)
    expect(calm.behind).toBe(c.behind)
    expect(calm.foul).toBe(c.foul)
    // 대가는 경고와 무관하게 언제나 치른다
    expect(calm.oppOpen).toBeGreaterThan(c.oppOpen)
    expect(calm.widthK).toBeLessThan(c.widthK)

    const booked = applyOrders(c, [p('MF06', 'BACK_OFF', true, null, { booked: true })])
    expect(booked.setPiece).toBeLessThan(c.setPiece)
    expect(booked.behind).toBeLessThan(c.behind)
    expect(booked.foul).toBeLessThan(c.foul)
    expect(booked.oppOpen).toBe(calm.oppOpen)
    expect(booked.widthK).toBe(calm.widthK)
  })

  it('내려서라와 올라가라는 서로 반대 방향의 거래다', () => {
    // 하나가 실점을 줄이고 공격을 깎으면 다른 하나는 반대여야 한다.
    // 같은 방향이면 둘 중 하나는 고를 이유가 없는 장식이다
    const c = base()
    const down = applyOrders(c, [p('MF06', 'DROP_BACK')])
    const up = applyOrders(c, [p('DF04', 'PUSH_UP')])

    expect(down.oppShotXg).toBeLessThan(c.oppShotXg)
    expect(down.behind).toBeLessThan(c.behind)
    expect(down.oppOpen).toBeLessThan(c.oppOpen)
    expect(down.widthK).toBeLessThan(c.widthK)

    expect(up.oppShotXg).toBeGreaterThan(c.oppShotXg)
    expect(up.behind).toBeGreaterThan(c.behind)
    expect(up.widthK).toBeGreaterThan(c.widthK)
  })

  it('이득만 커지지 않는다 — 지시마다 대가가 함께 걸린다', () => {
    /**
     * 이 저장소가 폭 레버에서 한 번 겪은 실패다. 이득만 있는 조작은
     * 전 국면에서 켜두는 것이 정답이 되어 "판마다 다른 판단"을 무너뜨린다.
     * 숫자를 박지 않고 **모든 지시에 반대 방향 항이 하나라도 있는지**만 본다
     */
    const c = base()
    const worse = (after: ReturnType<typeof applyOrders>) =>
      after.oppShotXg > c.oppShotXg ||
      after.oppOpen > c.oppOpen ||
      after.behind > c.behind ||
      after.setPiece > c.setPiece ||
      after.widthK < c.widthK ||
      after.openness < c.openness

    for (const order of ['HOLD', 'CONSERVE', 'DROP_BACK', 'PUSH_UP'] as const) {
      expect(worse(applyOrders(c, [p('MF06', order)])), order).toBe(true)
    }
    // 물러서라는 경고를 안고 있어야 이득이 나므로 그 상태에서 본다
    expect(
      worse(applyOrders(c, [p('MF06', 'BACK_OFF', true, null, { booked: true })])),
      'BACK_OFF',
    ).toBe(true)
  })
})

describe('자유 배치 — 연속 계수', () => {
  const p = (
    id: string,
    position: PlayerPosition | null,
    onPitch = true,
  ): PlayerState => ({
    id,
    onPitch,
    stamina: 70,
    booked: false,
    out: false,
    order: 'NONE',
    position,
  })
  const base = () => resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
  const pitch = FREE_POSITION.pitch

  it('직접 놓은 선수가 없으면 기존 계수 객체를 그대로 돌려준다', () => {
    const c = base()
    const after = applyPositions(c, [
      p('DF04', null),
      p('MF06', null),
      p('FW09', null),
    ])
    expect(after).toBe(c)
    expect(positionFactors([p('DF04', null)])).toBeNull()
  })

  it('전진·측면 배치는 공격 이득과 수비 대가를 함께 키운다', () => {
    const frontWide = positionFactors([
      p('MF06', { x: pitch.maxX, y: pitch.maxY }),
    ])!
    const backCentre = positionFactors([
      p('MF06', { x: pitch.minX, y: pitch.centreY }),
    ])!

    expect(frontWide.attack).toBeGreaterThan(backCentre.attack)
    expect(frontWide.risk).toBeGreaterThan(backCentre.risk)

    const c = base()
    const advanced = applyPositions(c, [
      p('MF06', { x: pitch.maxX, y: pitch.maxY }),
    ])
    expect(advanced.widthK).toBeGreaterThan(c.widthK)
    expect(advanced.oppOpen).toBeGreaterThan(c.oppOpen)
    expect(advanced.behind).toBeGreaterThan(c.behind)
    expect(advanced.setPiece).toBe(c.setPiece)
  })

  it('앞뒤와 좌우의 정확한 좌표가 각각 연속적으로 계수를 움직인다', () => {
    const back = positionFactors([
      p('MF06', { x: FREE_POSITION.zones.defenceMaxX, y: pitch.maxY }),
    ])!
    const front = positionFactors([
      p('MF06', { x: FREE_POSITION.zones.midfieldMaxX, y: pitch.maxY }),
    ])!
    expect(front.attack).toBeGreaterThan(back.attack)

    const centre = positionFactors([
      p('MF06', { x: pitch.centreX, y: pitch.centreY }),
    ])!
    const wide = positionFactors([
      p('MF06', { x: pitch.centreX, y: pitch.maxY }),
    ])!
    expect(wide.attack).toBeGreaterThan(centre.attack)
  })

  it('여러 명을 극단에 놓아도 정해진 상한에서 멈춘다', () => {
    const enough =
      Math.ceil(FREE_POSITION.effect.maxDelta / FREE_POSITION.effect.perPlayerDelta) + 1
    const placed = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        p(`MF${i}`, { x: pitch.maxX, y: pitch.maxY }),
      )

    expect(positionFactors(placed(enough))).toEqual(positionFactors(placed(enough * 2)))
  })
})
