import { describe, it, expect } from 'vitest'
import { FREE_POSITION } from './constants'
import {
  AWAY_XI,
  BENCH,
  HOME_SQUAD,
  HOME_XI,
  bestFinishing,
  effectivePos,
  getPlayer,
  initialPlayers,
  meanStamina,
  minDefenderSpeed,
  onPitchCount,
} from './squad'
import type { Problem } from './types'

const P: Problem = {
  id: 'test',
  title: '테스트',
  order: 1,
  score: [1, 0],
  initialTactics: { line: 1, press: 1, width: 1 },
  initialFormation: '4-4-2',
  objective: { type: 'SURVIVE', bonusOnWin: false },
  seed: 1,
  subsLeft: 3,
  staminaOverrides: {},
  booked: [],
  unavailable: [],
  awayCount: 11,
}

describe('명단', () => {
  it('선발 열한 명에 벤치를 더해 스물여섯 명이다', () => {
    expect(HOME_XI).toHaveLength(11)
    expect(HOME_SQUAD).toHaveLength(26)
    expect(BENCH).toHaveLength(HOME_SQUAD.length - HOME_XI.length)
    expect(AWAY_XI).toHaveLength(11)
  })

  /**
   * 골키퍼는 골키퍼와만 교체할 수 있다(`checkSub`). 벤치에 골키퍼가 없으면
   * 그 규칙이 "골키퍼는 절대 못 바꾼다"가 되어, 다치면 손쓸 방법이 없다.
   */
  it('벤치에 바꿔 넣을 골키퍼가 있다', () => {
    expect(BENCH.filter((player) => player.pos === 'GK').length).toBeGreaterThan(0)
  })

  it('한 포지션도 비지 않는다', () => {
    for (const pos of ['GK', 'DF', 'MF', 'FW'] as const) {
      expect(BENCH.filter((player) => player.pos === pos).length, pos).toBeGreaterThan(0)
    }
  })

  it('아무도 이름을 갖지 않는다', () => {
    // 실명이 붙으면 "이 선수 때문에 졌다"가 자동으로 생산된다.
    // 이름 칸 자체가 없어야 개발 중에 슬그머니 들어오지 않는다.
    for (const p of [...HOME_SQUAD, ...AWAY_XI]) {
      expect(p).not.toHaveProperty('name')
    }
  })

  it('식별자가 겹치지 않는다', () => {
    const ids = [...HOME_SQUAD, ...AWAY_XI].map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('선발에 골키퍼가 정확히 한 명 있다', () => {
    expect(HOME_XI.filter((p) => p.pos === 'GK')).toHaveLength(1)
  })

  it('값을 비워두면 포지션 평균을 물려받는다', () => {
    // 상대 선수는 속도만 적혀 있다
    const away = AWAY_XI[1]
    expect(away.finishing).toBeGreaterThan(0)
    expect(away.stamina0).toBeGreaterThan(0)
  })

  it('마무리는 0.7~1.3 범위다', () => {
    for (const p of HOME_SQUAD) {
      expect(p.finishing).toBeGreaterThanOrEqual(0.7)
      expect(p.finishing).toBeLessThanOrEqual(1.3)
    }
  })

  it('없는 선수를 찾으면 즉시 실패한다', () => {
    expect(() => getPlayer('DF99')).toThrow()
  })
})

describe('가장 느린 수비수', () => {
  it('피치 위 수비수 중 최솟값이다', () => {
    const players = initialPlayers(P)
    const onPitchDefenders = HOME_XI.filter((p) => p.pos === 'DF').map((p) => p.speed)
    expect(minDefenderSpeed(players)).toBe(Math.min(...onPitchDefenders))
  })

  it('골키퍼는 세지 않는다', () => {
    const gk = HOME_XI.find((p) => p.pos === 'GK')!
    expect(minDefenderSpeed(initialPlayers(P))).toBeGreaterThan(gk.speed)
  })

  it('느린 수비수를 빼면 값이 올라간다', () => {
    const before = minDefenderSpeed(initialPlayers(P))
    const slowest = HOME_XI.filter((p) => p.pos === 'DF').sort((a, b) => a.speed - b.speed)[0]
    const after = minDefenderSpeed(initialPlayers({ ...P, unavailable: [slowest.id] }))
    expect(after).toBeGreaterThan(before)
  })

  it('벤치에 선발보다 빠른 수비수가 있다', () => {
    // "느린 수비수 교체"가 승부처로 성립하려면 이게 참이어야 한다
    const slowestOnPitch = Math.min(...HOME_XI.filter((p) => p.pos === 'DF').map((p) => p.speed))
    const fastestOnBench = Math.max(...BENCH.filter((p) => p.pos === 'DF').map((p) => p.speed))
    expect(fastestOnBench).toBeGreaterThan(slowestOnPitch + 10)
  })
})

describe('국면 적용', () => {
  it('시작 체력을 국면이 덮어쓴다', () => {
    const players = initialPlayers({ ...P, staminaOverrides: { DF04: 30 } })
    expect(players.find((s) => s.id === 'DF04')!.stamina).toBe(30)
  })

  it('덮어쓰지 않은 선수는 명단 기본값을 쓴다', () => {
    const players = initialPlayers(P)
    const df04 = HOME_SQUAD.find((p) => p.id === 'DF04')!
    expect(players.find((s) => s.id === 'DF04')!.stamina).toBe(df04.stamina0)
  })

  it('경고 보유가 반영된다', () => {
    const players = initialPlayers({ ...P, booked: ['MF06'] })
    expect(players.find((s) => s.id === 'MF06')!.booked).toBe(true)
  })

  it('퇴장한 선수를 빼면 열 명이 된다', () => {
    expect(onPitchCount(initialPlayers(P))).toBe(11)
    expect(onPitchCount(initialPlayers({ ...P, unavailable: ['DF03'] }))).toBe(10)
  })

  it('벤치는 피치 위로 세지 않는다', () => {
    const players = initialPlayers(P)
    for (const b of BENCH) {
      expect(players.find((s) => s.id === b.id)!.onPitch).toBe(false)
    }
  })

  it('명단에 없는 선수를 국면이 지목하면 즉시 실패한다', () => {
    // 토요일에 국면 다섯 개를 손으로 채울 때 오타를 여기서 잡는다
    expect(() => initialPlayers({ ...P, booked: ['MF99'] })).toThrow()
  })
})

describe('집계', () => {
  it('평균 체력은 피치 위 선수만 센다', () => {
    const players = initialPlayers({ ...P, staminaOverrides: { DF04: 0 } })
    const all = players.filter((s) => s.onPitch).map((s) => s.stamina)
    expect(meanStamina(players)).toBeCloseTo(all.reduce((a, b) => a + b, 0) / all.length)
  })

  it('마무리 최댓값은 피치 위 공격 자원에서 고른다', () => {
    const onPitch = HOME_XI.filter((p) => p.pos === 'FW' || p.pos === 'MF')
    expect(bestFinishing(initialPlayers(P))).toBe(Math.max(...onPitch.map((p) => p.finishing)))
  })
})

describe('자유 배치의 실제 줄', () => {
  it('x 좌표의 수비·중원·공격 구간을 읽는다', () => {
    const player = initialPlayers(P).find((state) => state.id === 'MF06')!
    const at = (x: number) => ({
      ...player,
      position: { x, y: FREE_POSITION.pitch.centreY },
    })

    expect(effectivePos(at(FREE_POSITION.pitch.minX))).toBe('DF')
    expect(effectivePos(at(FREE_POSITION.pitch.centreX))).toBe('MF')
    expect(effectivePos(at(FREE_POSITION.pitch.maxX))).toBe('FW')
  })

  it('자유 좌표가 없으면 기존 앞뒤 줄 지시를 그대로 읽는다', () => {
    const player = initialPlayers(P).find((state) => state.id === 'MF06')!
    expect(effectivePos({ ...player, order: 'DROP_BACK' })).toBe('DF')
    expect(effectivePos({ ...player, order: 'PUSH_UP' })).toBe('FW')
    expect(effectivePos(player)).toBe('MF')
  })
})

/**
 * 능력치는 화면에만 뜨는 장식이 아니다.
 *
 * 엔진이 직접 읽는 `speed` · `finishing` 과 어긋나면, 카드에는 발이 빠르다고
 * 적혀 있는데 실제로는 배후를 못 지키는 선수가 생긴다. 값을 그대로 박아두면
 * 명단을 손볼 때마다 깨지므로 **관계**만 지킨다.
 */
describe('선수 능력치', () => {
  const all = [...HOME_SQUAD, ...AWAY_XI]

  it('전부 1~20 정수다', () => {
    for (const player of all) {
      for (const [key, value] of Object.entries(player.attributes)) {
        expect(Number.isInteger(value), `${player.id} ${key}`).toBe(true)
        expect(value, `${player.id} ${key}`).toBeGreaterThanOrEqual(1)
        expect(value, `${player.id} ${key}`).toBeLessThanOrEqual(20)
      }
    }
  })

  it('순간 속도와 주력이 엔진의 속도와 같은 선수를 가리킨다', () => {
    for (const player of all) {
      const derived = ((player.attributes.pace + player.attributes.speed) / 2) * 5
      expect(Math.abs(derived - player.speed), `${player.id}`).toBeLessThanOrEqual(5)
    }
  })

  it('골 결정력이 엔진의 마무리와 같은 선수를 가리킨다', () => {
    for (const player of all) {
      const derived = 0.55 + 0.045 * player.attributes.finish
      expect(Math.abs(derived - player.finishing), `${player.id}`).toBeLessThanOrEqual(0.06)
    }
  })

  it('가장 느린 수비수와 가장 잘 마무리하는 선수를 능력치로도 같게 짚는다', () => {
    const defenders = HOME_XI.filter((player) => player.pos === 'DF')
    const slowestBySpeed = [...defenders].sort((a, b) => a.speed - b.speed)[0]
    const slowestByAttribute = [...defenders].sort(
      (a, b) => a.attributes.pace + a.attributes.speed - (b.attributes.pace + b.attributes.speed),
    )[0]
    expect(slowestByAttribute.id).toBe(slowestBySpeed.id)

    const bestByFinishing = [...HOME_XI].sort((a, b) => b.finishing - a.finishing)[0]
    const bestByAttribute = [...HOME_XI].sort(
      (a, b) => b.attributes.finish - a.attributes.finish,
    )[0]
    expect(bestByAttribute.id).toBe(bestByFinishing.id)
  })

  it('이름 칸은 여전히 없다', () => {
    for (const player of all) {
      expect(Object.keys(player)).not.toContain('name')
    }
  })
})
