import { describe, expect, it } from 'vitest'
import raw from '../data/problems.json' with { type: 'json' }
import { PROBLEMS } from './problems'
import { FORMATION_IDS } from './formations'
import { HOME_SQUAD, getPlayer } from './squad'
import { PRESETS } from '../analysis/presets'

/**
 * 국면 데이터의 계약.
 *
 * **국면 추가에 코드 수정이 없어야 한다**(AGENTS.md 1장). 그러려면 화면이
 * 필요로 하는 값이 전부 `problems.json` 안에 있어야 한다. 전에는 시작 분과
 * 한 줄 요약이 `App.tsx` 에 국면 id 별 표로 박혀 있어서, 국면을 하나 넣을
 * 때마다 화면 코드를 고쳐야 했다. 그 표를 지운 자리를 이 테스트가 지킨다.
 */
describe('국면 데이터의 계약', () => {
  it('국면마다 화면이 필요로 하는 값이 데이터 안에 다 있다', () => {
    for (const p of PROBLEMS) {
      expect(p.summary, `${p.id} 의 한 줄 요약`).toBeTruthy()
      expect(typeof p.kickoff, `${p.id} 의 시작 분`).toBe('number')
    }
  })

  it('경기는 90분을 채우고 추가시간까지 뛰고 끝난다', () => {
    for (const p of PROBLEMS) {
      // 15분 구간이므로 끝나는 시각은 kickoff + 15 다.
      const ends = p.kickoff! + 15
      const added = ends - 90
      // 90분 전에 끝나는 후반은 없다. 추가시간 0분도 없다
      expect(added, `${p.id} 의 추가시간`).toBeGreaterThanOrEqual(1)
      // 주심이 주는 추가시간의 현실적 상한. 이보다 길면 잘못 적은 것이다
      expect(added, `${p.id} 의 추가시간`).toBeLessThanOrEqual(8)
    }
  })

  it('id 와 난이도 순서는 겹치지 않는다', () => {
    expect(new Set(PROBLEMS.map((p) => p.id)).size).toBe(PROBLEMS.length)
    expect(new Set(PROBLEMS.map((p) => p.order)).size).toBe(PROBLEMS.length)
  })

  it('국면이 가리키는 선수와 포메이션이 실제로 존재한다', () => {
    for (const p of PROBLEMS) {
      expect(FORMATION_IDS, `${p.id} 시작 포메이션`).toContain(p.initialFormation)
      expect(FORMATION_IDS, `${p.id} 권장 포메이션`).toContain(p.recommendation!.formation)
      for (const id of [...p.booked, ...p.unavailable, ...Object.keys(p.staminaOverrides)]) {
        expect(() => getPlayer(id), `${p.id} 가 가리키는 ${id}`).not.toThrow()
        // 벤치에 앉은 선수에게 경고나 이탈을 걸 수는 없다
        expect(HOME_SQUAD.find((x) => x.id === id)?.onBench, `${p.id} 의 ${id}`).toBe(false)
      }
    }
  })

  it('앞 감독이 걸어둔 지시는 이름 붙은 전술이 아니다', () => {
    /**
     * 국면의 성립 조건이다. 정상 전술에서 시작하면 아무것도 안 해도
     * 통과한다. `setup.test.ts` 가 흔든 결과를 보고, 여기서는 **데이터에
     * 적힌 범위 전체**가 그런지를 본다 — 흔들어서 나올 수 있는 조합
     * 하나라도 이름 붙은 전술이면 그 판은 국면이 아니다.
     */
    for (const p of PROBLEMS) {
      const v = p.variation?.tactics
      const lines = v?.line ?? [p.initialTactics.line]
      const presses = v?.press ?? [p.initialTactics.press]
      const widths = v?.width ?? [p.initialTactics.width]
      for (const l of lines)
        for (const pr of presses)
          for (const w of widths) {
            const named = PRESETS.find((x) => x.v[0] === l && x.v[1] === pr && x.v[2] === w)
            expect(named?.name, `${p.id} 가 "${named?.name}" 으로 시작할 수 있다`).toBeUndefined()
          }
    }
  })

  it('권장 전술은 앞 감독이 걸어둔 것과 다르다', () => {
    // 같으면 "바꿀 것이 없다"가 되어 국면이 성립하지 않는다
    for (const p of PROBLEMS) {
      const r = p.recommendation!
      const same =
        r.formation === p.initialFormation &&
        r.tactics.line === p.initialTactics.line &&
        r.tactics.press === p.initialTactics.press &&
        r.tactics.width === p.initialTactics.width
      expect(same, `${p.id} 의 권장 설정이 시작 설정과 같다`).toBe(false)
    }
  })

  it('원본 JSON 의 키가 국면마다 갈리지 않는다', () => {
    // 한 국면에만 있는 키는 대개 오타이거나 옮기다 만 것이다
    const keys = raw.map((p) => Object.keys(p).sort().join(','))
    expect(new Set(keys).size, `국면마다 다른 키 구성: ${[...new Set(keys)].join(' / ')}`).toBe(1)
  })
})
