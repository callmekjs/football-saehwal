import { describe, expect, it } from 'vitest'
import { calloutOf, isHandball } from './callout'
import { PITCH_W, PITCH_H, type Restart, type Whistle } from './visual'

const restart = (kind: Restart['kind'], side: Restart['side'], x = 52.5, y = 34): Restart => ({
  kind,
  side,
  x,
  y,
  wait: 0.5,
  takerId: null,
  age: 0,
  wall: [],
})

const whistle = (kind: Whistle['kind'], red = false): Whistle => ({
  kind,
  x: 52.5,
  y: 34,
  red,
  life: 1,
})

describe('왜 공이 넘어갔는지 알려주는 한 줄', () => {
  it('아무 일도 없으면 아무것도 띄우지 않는다', () => {
    // 흐르는 경기에 계속 글자가 떠 있으면 그것대로 화면을 가린다
    expect(calloutOf(null, null)).toBeNull()
  })

  it('아웃 세 종류를 구분하고 누구 공인지 함께 말한다', () => {
    expect(calloutOf(restart('THROW_IN', 'HOME'), null)).toMatchObject({
      text: '스로인',
      side: '우리 공',
    })
    expect(calloutOf(restart('GOAL_KICK', 'AWAY'), null)).toMatchObject({
      text: '골킥',
      side: '상대 공',
    })
    expect(calloutOf(restart('CORNER', 'HOME'), null)).toMatchObject({
      text: '코너킥',
      side: '우리 공',
    })
  })

  it('프리킥은 어느 팀이 차는지까지 말한다', () => {
    // "파울"만 뜨면 누가 이득인지 모른다. 그게 사용자가 답답해한 지점이다
    const ours = calloutOf(restart('FREE_KICK', 'HOME'), whistle('FOUL'))
    expect(ours?.text === '파울' || ours?.text === '핸드볼').toBe(true)
    expect(ours?.side).toBe('우리 공 프리킥')
  })

  it('경기를 가르는 판정이 재개보다 먼저다', () => {
    /**
     * 휘슬과 재개는 함께 존재한다. 페널티킥인데 화면에 "파울 · 상대 공
     * 프리킥"이라고 뜨면 완전히 다른 경기가 된다.
     */
    expect(calloutOf(restart('FREE_KICK', 'AWAY'), whistle('PENALTY'))?.text).toBe('페널티킥')
    expect(calloutOf(restart('FREE_KICK', 'AWAY'), whistle('OFFSIDE'))?.text).toBe('오프사이드')
    expect(calloutOf(restart('FREE_KICK', 'AWAY'), whistle('CARD', true))?.text).toBe('퇴장')
    expect(calloutOf(restart('FREE_KICK', 'AWAY'), whistle('CARD', false))?.text).toBe('경고')
  })

  it('페널티킥과 퇴장만 가장 큰 표시를 받는다', () => {
    expect(calloutOf(null, whistle('PENALTY'))?.tone).toBe('BIG')
    expect(calloutOf(null, whistle('CARD', true))?.tone).toBe('BIG')
    expect(calloutOf(restart('THROW_IN', 'HOME'), null)?.tone).toBe('OUT')
    expect(calloutOf(restart('FREE_KICK', 'HOME'), null)?.tone).toBe('FOUL')
  })
})

describe('핸드볼', () => {
  it('페널티 지역 근처에서는 절대 핸드볼이라고 하지 않는다', () => {
    /**
     * ★ 박스 안 핸드볼은 **페널티킥**이다. 여기서 박스 안 반칙을 핸드볼로
     * 부르면 "핸드볼인데 프리킥"이라는 축구에 없는 장면이 만들어진다.
     * 시뮬이 페널티를 따로 정하므로 이쪽은 밖에서만 부른다.
     */
    for (let y = 0; y <= PITCH_H; y += 1) {
      for (let x = 0; x <= 20; x += 0.5) {
        expect(isHandball(x, y), `x=${x} y=${y}`).toBe(false)
        expect(isHandball(PITCH_W - x, y), `x=${PITCH_W - x} y=${y}`).toBe(false)
      }
    }
  })

  it('같은 자리는 언제나 같은 판정을 낸다', () => {
    // 난수를 쓰면 같은 경기를 다시 봐도 다른 판정이 나온다
    for (const [x, y] of [[40, 20], [52.5, 34], [70, 50], [63, 12]]) {
      expect(isHandball(x, y)).toBe(isHandball(x, y))
    }
  })

  it('핸드볼은 반칙 중 소수다', () => {
    // 반칙마다 핸드볼이면 그것대로 축구가 아니다
    let hand = 0
    let total = 0
    for (let x = 21; x < PITCH_W - 21; x += 0.7) {
      for (let y = 1; y < PITCH_H; y += 0.7) {
        total += 1
        if (isHandball(x, y)) hand += 1
      }
    }
    const share = hand / total
    expect(share).toBeGreaterThan(0.05)
    expect(share).toBeLessThan(0.3)
  })
})
