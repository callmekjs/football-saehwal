# 엔진 코어 구현 계획 — 화요일 7/28

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 750틱을 결정론적으로 돌리는 시뮬레이션 코어를 만들어, 같은 시드로 두 번 실행하면 완전히 동일한 결과가 나오는 것을 테스트로 증명한다.

**Architecture:** `src/sim/`은 순수 함수만 담는다. 브라우저 API를 일절 참조하지 않아 Node에서 그대로 실행된다. `tick(state, inputs) → state`가 유일한 진입점이고, 난수는 매 틱 고정된 10개 슬롯 순서로만 소비한다. 화요일에는 화면을 만들지 않는다 — 콘솔에서 750틱이 돌고 스코어가 찍히면 끝이다.

**Tech Stack:** Vite · React 19 · TypeScript 5 (strict) · Vitest · Node 20+

## Global Constraints

- **`src/sim/` 안에서 `window`·`document`·`requestAnimationFrame`·`Date`·`Math.random`을 절대 참조하지 않는다.** 이걸 어기면 Node 검증 하네스가 죽고, 경기 분석 화면이 원리적으로 불가능해진다.
- **난수는 `rngMatch.next()`로만 뽑는다.** 매 틱 정확히 10개를 정해진 순서로 소비하며, 필요 없는 슬롯도 뽑아서 버린다.
- **총 틱은 750으로 고정.** 추가시간을 이유로 늘리지 않는다.
- **좌표계는 105 × 68** (실제 피치 미터). 렌더 해상도와 분리한다.
- TypeScript `strict: true`. `any` 금지.
- 커밋 메시지는 한국어. 무엇을 왜 바꿨는지 적는다.
- 확률 상수는 전부 `src/sim/constants.ts` 한 곳에만 둔다. 다른 파일에 숫자 리터럴을 흩뿌리지 않는다.

## 화요일 범위 (5시간)

| 넣는 것 | 빼는 것 (수요일로) |
|---|---|
| 프로젝트 세팅 · rng · 타입 · 상수 | 상대 성향 전환 · 예고 |
| 체력 소모 · 전술 레버 계수 | 경고 · 퇴장 · 부상 · 페널티 |
| 우리 공격 / 상대 3채널 · 득점 | 교체 카드 실행 |
| 750틱 루프 · 결정론 테스트 | 선수 좌표 이동 · 코멘터리 · 지표 바 |
| 무개입 기대 득점 측정 스크립트 | 화면 전부 |

**완료 기준:** `npm run sim` 이 무개입 750틱을 200시드 돌려 평균 스코어를 출력하고, 그 값이 양 팀 합계 0.9~1.4골 안에 들어온다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/sim/rng.ts` | mulberry32 결정론 난수. 경기용/연출용 스트림 분리 |
| `src/sim/types.ts` | `MatchState` · `Problem` · `Decision` 타입만. 로직 없음 |
| `src/sim/constants.ts` | 확률·승수 상수 전부. 여기 외에는 숫자 리터럴 금지 |
| `src/sim/tactics.ts` | 레버 3축 → 계수 묶음 변환. 순수 함수 |
| `src/sim/stamina.ts` | 체력 소모와 실효 능력 계산 |
| `src/sim/attack.ts` | 우리 공격 1채널 · 상대 공격 3채널의 틱 판정 |
| `src/sim/engine.ts` | `tick()` · `simulate()`. 위 조각들을 순서대로 호출 |
| `balance/measure.ts` | 무개입 N시드 실행해 평균 스코어 출력 |

---

## Task 1: 프로젝트 세팅과 결정론 난수

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`
- Create: `src/sim/rng.ts`
- Test: `src/sim/rng.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `createRng(seed: number): Rng` — `Rng`는 `{ next(): number }`, 0 이상 1 미만 반환. `createStreams(seed: number): { match: Rng; visual: Rng }`

- [ ] **Step 1: 프로젝트 초기화**

```bash
cd C:/football_hackerton
npm create vite@latest . -- --template react-ts
```

기존 `README.md`·`.gitignore`·`docs/`를 덮어쓰겠다고 물으면 **거부**한다. 덮어썼다면 `git checkout -- README.md .gitignore docs/`로 되돌린다.

```bash
npm install
npm install -D vitest
```

`package.json`의 `scripts`에 추가:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "sim": "npx tsx balance/measure.ts"
  }
}
```

```bash
npm install -D tsx
```

`tsconfig.app.json`에 `"strict": true`가 있는지 확인한다. 없으면 추가한다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`src/sim/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createRng, createStreams } from './rng'

describe('createRng', () => {
  it('같은 시드는 같은 수열을 낸다', () => {
    const a = createRng(40712)
    const b = createRng(40712)
    const seqA = Array.from({ length: 100 }, () => a.next())
    const seqB = Array.from({ length: 100 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('다른 시드는 다른 수열을 낸다', () => {
    const a = createRng(40712)
    const b = createRng(40713)
    expect(a.next()).not.toEqual(b.next())
  })

  it('0 이상 1 미만을 낸다', () => {
    const r = createRng(1)
    for (let i = 0; i < 1000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('충분히 고르게 분포한다', () => {
    const r = createRng(7)
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < 100_000; i++) buckets[Math.floor(r.next() * 10)]++
    for (const b of buckets) expect(b).toBeGreaterThan(9_000)
  })
})

describe('createStreams', () => {
  it('경기용과 연출용이 서로 다른 수열을 낸다', () => {
    const { match, visual } = createStreams(40712)
    expect(match.next()).not.toEqual(visual.next())
  })

  it('연출용을 아무리 소비해도 경기용이 변하지 않는다', () => {
    const s1 = createStreams(40712)
    const s2 = createStreams(40712)
    for (let i = 0; i < 500; i++) s2.visual.next()
    expect(s1.match.next()).toEqual(s2.match.next())
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `npm test -- rng`
Expected: FAIL — `Failed to resolve import "./rng"`

- [ ] **Step 4: 구현한다**

`src/sim/rng.ts`:

```ts
export interface Rng {
  next(): number
}

const VISUAL_OFFSET = 0x9e3779b9

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

export function createStreams(seed: number): { match: Rng; visual: Rng } {
  return {
    match: createRng(seed),
    visual: createRng((seed ^ VISUAL_OFFSET) >>> 0),
  }
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `npm test -- rng`
Expected: PASS — 6 tests

- [ ] **Step 6: 커밋한다**

```bash
git add -A
git commit -m "결정론 난수와 프로젝트 세팅

경기 분석 화면은 같은 경기를 두 번 돌려 비교하므로 난수가 재현
가능해야 한다. mulberry32로 시드에서 수열을 완전히 결정한다.

연출용 스트림을 경기용과 분리한다. 하나만 쓰면 연출을 고칠 때마다
난수 소비가 밀려 경기 결과 전체가 바뀐다."
```

---

## Task 2: 타입과 상수

**Files:**
- Create: `src/sim/types.ts`
- Create: `src/sim/constants.ts`
- Test: `src/sim/constants.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type Level = 0 | 1 | 2`
  - `interface Tactics { line: Level; press: Level; width: Level }`
  - `interface MatchState { tick: number; score: [number, number]; tactics: Tactics; stamina: Record<string, number>; opponent: Mentality; homeCount: number; awayCount: number }`
  - `type Mentality = 'PARK_BUS' | 'BALANCED' | 'ALL_OUT'`
  - `interface Problem { id: string; title: string; score: [number, number]; initialTactics: Tactics; homeCount: number; awayCount: number; seed: number; objective: Objective }`
  - `interface Objective { type: 'SURVIVE' | 'EQUALIZE'; bonusOnWin: boolean }`
  - `const BASE`, `const LINE`, `const PRESS`, `const WIDTH`, `const MENTALITY`, `const XG`, `const STAMINA`

- [ ] **Step 1: 타입을 쓴다**

`src/sim/types.ts`:

```ts
export type Level = 0 | 1 | 2

export interface Tactics {
  line: Level
  press: Level
  width: Level
}

export type Mentality = 'PARK_BUS' | 'BALANCED' | 'ALL_OUT'

export interface Objective {
  type: 'SURVIVE' | 'EQUALIZE'
  bonusOnWin: boolean
}

export interface MatchState {
  tick: number
  score: [number, number]
  tactics: Tactics
  stamina: Record<string, number>
  opponent: Mentality
  homeCount: number
  awayCount: number
}

export interface Problem {
  id: string
  title: string
  order: number
  score: [number, number]
  initialTactics: Tactics
  homeCount: number
  awayCount: number
  seed: number
  objective: Objective
  minDefenderSpeed: number
  startStamina: Record<string, number>
}

export type Decision =
  | { tick: number; type: 'LINE' | 'PRESS' | 'WIDTH'; value: Level }
```

- [ ] **Step 2: 상수를 쓴다**

`src/sim/constants.ts`. 값은 전부 `docs/design.md` 4장에서 가져온다.

```ts
export const TOTAL_TICKS = 750

export const BASE = {
  A0: 0.0180,
  O0: 0.0110,
  B0: 0.0020,
  S0: 0.0060,
  P_ENTER: 0.35,
  P_ENTER_OPP: 0.35,
} as const

export const LINE = [
  { behind: 0.45, steal: 0.80, drain: 0.90, entryXg: 0.70, setPiece: 2.80 },
  { behind: 1.00, steal: 1.00, drain: 1.00, entryXg: 1.00, setPiece: 1.00 },
  { behind: 2.20, steal: 1.25, drain: 1.15, entryXg: 1.30, setPiece: 0.60 },
] as const

export const PRESS = [
  { steal: 0.70, drain: 0.65, oppOpen: 1.25, foul: 0.80 },
  { steal: 1.00, drain: 1.00, oppOpen: 1.00, foul: 1.00 },
  { steal: 1.40, drain: 1.80, oppOpen: 0.80, foul: 1.50 },
] as const

export const WIDTH = {
  wide:   { base: 1.05, congestion: 0.30 },
  normal: { base: 1.00, congestion: 0.00 },
  narrow: { base: 0.95, congestion: -0.20 },
} as const

export const MENTALITY = {
  ALL_OUT:  { oppVolume: 1.35, behind: 1.30, openness: 1.40, congestion: 0.10 },
  BALANCED: { oppVolume: 1.00, behind: 1.00, openness: 1.00, congestion: 0.50 },
  PARK_BUS: { oppVolume: 0.70, behind: 0.55, openness: 0.60, congestion: 1.00 },
} as const

export const XG = {
  boxCentre: 0.120,
  boxSide: 0.052,
  outsideBox: 0.031,
  oneOnOne: 0.185,
  setPiece: 0.035,
  penalty: 0.760,
  shotSelectCentre: 0.42,
  shotSelectOneOnOne: 0.75,
} as const

export const STAMINA = {
  drainBase: 0.030,
  cliff: 35,
  cliffPenalty: 0.85,
  floorFactor: 0.55,
  rangeFactor: 0.45,
} as const

export const COUNT_PENALTY = {
  tenManCover: 1.22,
  oppTenManVolume: 0.75,
  oppTenManCongestion: 0.30,
} as const
```

- [ ] **Step 3: 상수를 지키는 테스트를 쓴다**

이 테스트의 목적은 값이 맞는지가 아니라 **누가 실수로 값을 바꿨을 때 알아채는 것**이다. 8/1 동결 이후 특히 중요하다.

`src/sim/constants.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { LINE, BASE, TOTAL_TICKS } from './constants'

describe('동결 대상 상수', () => {
  it('총 틱은 750이다', () => {
    expect(TOTAL_TICKS).toBe(750)
  })

  it('라인 낮음의 세트피스 증가가 배후 감소를 압도한다', () => {
    // 이 부등식이 깨지면 "잠글수록 맞는다"가 성립하지 않고
    // 라인 낮음이 전 국면 지배 전략이 되어 국면 2·4가 죽는다.
    const low = LINE[0]
    const behindSaved = BASE.B0 * (1 - low.behind)
    const setPieceAdded = BASE.S0 * (low.setPiece - 1)
    expect(setPieceAdded).toBeGreaterThan(behindSaved)
  })

  it('라인 3단계의 배후 승수가 단조 증가한다', () => {
    expect(LINE[0].behind).toBeLessThan(LINE[1].behind)
    expect(LINE[1].behind).toBeLessThan(LINE[2].behind)
  })
})
```

- [ ] **Step 4: 테스트를 돌린다**

Run: `npm test -- constants`
Expected: PASS — 3 tests

부등식 테스트가 실패하면 `LINE[0].setPiece`를 올린다. 이 테스트가 통과할 때까지 다음으로 가지 않는다.

- [ ] **Step 5: 커밋한다**

```bash
git add -A
git commit -m "상태 타입과 확률 상수 정의

확률 상수를 constants.ts 한 곳에 모은다. 여러 파일에 숫자가 흩어지면
8월 1일 동결 이후 어디를 손댔는지 추적할 수 없다.

라인 낮음의 세트피스 승수가 배후 침투 감소를 압도하는지 테스트로
박는다. 이 부등식이 깨지면 잠그는 것이 전 국면 지배 전략이 되어
국면 2와 4의 반전이 원리적으로 성립하지 않는다."
```

---

## Task 3: 전술 레버 계수 변환

**Files:**
- Create: `src/sim/tactics.ts`
- Test: `src/sim/tactics.test.ts`

**Interfaces:**
- Consumes: `Tactics`, `Mentality` (types.ts), `LINE`/`PRESS`/`WIDTH`/`MENTALITY` (constants.ts)
- Produces: `resolveCoefficients(tactics: Tactics, mentality: Mentality, oppTenMan: boolean): Coefficients`
  여기서 `Coefficients`는 `{ behind: number; steal: number; drain: number; entryXg: number; setPiece: number; oppOpen: number; foul: number; widthK: number; openness: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/sim/tactics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveCoefficients } from './tactics'
import type { Tactics } from './types'

const t = (line: 0|1|2, press: 0|1|2, width: 0|1|2): Tactics => ({ line, press, width })

describe('resolveCoefficients', () => {
  it('전부 보통이면 승수가 1이다', () => {
    const c = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    expect(c.behind).toBeCloseTo(1.0)
    expect(c.steal).toBeCloseTo(1.0)
    expect(c.drain).toBeCloseTo(1.0)
    expect(c.setPiece).toBeCloseTo(1.0)
  })

  it('라인을 올리면 배후 위험과 진입 가치가 함께 오른다', () => {
    const c = resolveCoefficients(t(2, 1, 1), 'BALANCED', false)
    expect(c.behind).toBeCloseTo(2.20)
    expect(c.entryXg).toBeCloseTo(1.30)
    expect(c.setPiece).toBeCloseTo(0.60)
  })

  it('라인을 내리면 배후는 줄지만 세트피스가 크게 는다', () => {
    const c = resolveCoefficients(t(0, 1, 1), 'BALANCED', false)
    expect(c.behind).toBeCloseTo(0.45)
    expect(c.setPiece).toBeCloseTo(2.80)
  })

  it('상대가 뭉쳐 있을수록 넓게가 강해진다', () => {
    const parked = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', false)
    const open   = resolveCoefficients(t(1, 1, 2), 'ALL_OUT', false)
    expect(parked.widthK).toBeGreaterThan(open.widthK)
    expect(parked.widthK).toBeCloseTo(1.35)
  })

  it('상대가 뭉쳐 있을 때 좁게는 손해다', () => {
    const c = resolveCoefficients(t(1, 1, 0), 'PARK_BUS', false)
    expect(c.widthK).toBeCloseTo(0.75)
  })

  it('상대가 올라와 있으면 폭의 차이가 거의 사라진다', () => {
    const wide   = resolveCoefficients(t(1, 1, 2), 'ALL_OUT', false)
    const narrow = resolveCoefficients(t(1, 1, 0), 'ALL_OUT', false)
    expect(Math.abs(wide.widthK - narrow.widthK)).toBeLessThan(0.15)
  })

  it('상대가 10명이면 더 뭉쳐서 넓게가 더 강해진다', () => {
    const eleven = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', false)
    const ten    = resolveCoefficients(t(1, 1, 2), 'PARK_BUS', true)
    expect(ten.widthK).toBeGreaterThanOrEqual(eleven.widthK)
    expect(ten.oppOpen).toBeLessThan(eleven.oppOpen)
  })

  it('강 압박은 탈취를 올리고 체력을 크게 태운다', () => {
    const c = resolveCoefficients(t(1, 2, 1), 'BALANCED', false)
    expect(c.steal).toBeCloseTo(1.40)
    expect(c.drain).toBeCloseTo(1.80)
    expect(c.foul).toBeCloseTo(1.50)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- tactics`
Expected: FAIL — `Failed to resolve import "./tactics"`

- [ ] **Step 3: 구현한다**

`src/sim/tactics.ts`:

```ts
import { LINE, PRESS, WIDTH, MENTALITY, COUNT_PENALTY } from './constants'
import type { Mentality, Tactics } from './types'

export interface Coefficients {
  behind: number
  steal: number
  drain: number
  entryXg: number
  setPiece: number
  oppOpen: number
  foul: number
  widthK: number
  openness: number
}

const WIDTH_BY_LEVEL = [WIDTH.narrow, WIDTH.normal, WIDTH.wide] as const

export function resolveCoefficients(
  tactics: Tactics,
  mentality: Mentality,
  oppTenMan: boolean,
): Coefficients {
  const line = LINE[tactics.line]
  const press = PRESS[tactics.press]
  const width = WIDTH_BY_LEVEL[tactics.width]
  const ment = MENTALITY[mentality]

  const congestion = Math.min(
    1,
    ment.congestion + (oppTenMan ? COUNT_PENALTY.oppTenManCongestion : 0),
  )

  return {
    behind: line.behind * ment.behind,
    steal: line.steal * press.steal,
    drain: line.drain * press.drain,
    entryXg: line.entryXg,
    setPiece: line.setPiece,
    oppOpen: press.oppOpen * ment.oppVolume * (oppTenMan ? COUNT_PENALTY.oppTenManVolume : 1),
    foul: press.foul,
    widthK: width.base + width.congestion * congestion,
    openness: ment.openness,
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test -- tactics`
Expected: PASS — 8 tests

- [ ] **Step 5: 커밋한다**

```bash
git add -A
git commit -m "전술 레버 3축을 계수로 변환

폭을 상대 밀집도에 연동한다. 넓게가 항상 좋으면 축이 죽고, 항상
나쁘면 국면 1과 5의 정답이 사라진다. 상대가 뭉쳐 있을 때만 강하게
만들면 하나의 계수로 지키는 판과 쫓는 판의 정답이 반대가 된다.

상대 10명 보정을 밀집도에 더한다. 사람이 줄면 더 촘촘히 서므로
국면 5에서 폭의 효과가 최대가 된다."
```

---

## Task 4: 체력과 실효 능력

**Files:**
- Create: `src/sim/stamina.ts`
- Test: `src/sim/stamina.test.ts`

**Interfaces:**
- Consumes: `STAMINA` (constants.ts)
- Produces:
  - `drainTick(current: number, drainCoefficient: number): number`
  - `effectiveFactor(stamina: number): number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/sim/stamina.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { drainTick, effectiveFactor } from './stamina'
import { STAMINA, TOTAL_TICKS } from './constants'

describe('drainTick', () => {
  it('기준 계수로 750틱 돌면 약 22.5 소모한다', () => {
    let s = 100
    for (let i = 0; i < TOTAL_TICKS; i++) s = drainTick(s, 1.0)
    expect(100 - s).toBeCloseTo(22.5, 1)
  })

  it('강 압박이면 소모가 1.8배다', () => {
    let normal = 100, hard = 100
    for (let i = 0; i < TOTAL_TICKS; i++) {
      normal = drainTick(normal, 1.0)
      hard = drainTick(hard, 1.8)
    }
    expect(100 - hard).toBeCloseTo((100 - normal) * 1.8, 1)
  })

  it('0 아래로 내려가지 않는다', () => {
    let s = 5
    for (let i = 0; i < TOTAL_TICKS; i++) s = drainTick(s, 3.0)
    expect(s).toBe(0)
  })
})

describe('effectiveFactor', () => {
  it('체력 100이면 능력이 온전하다', () => {
    expect(effectiveFactor(100)).toBeCloseTo(1.0)
  })

  it('체력 0이면 0.55로 떨어진다', () => {
    // 절벽까지 함께 걸리므로 0.55 * 0.85
    expect(effectiveFactor(0)).toBeCloseTo(0.55 * STAMINA.cliffPenalty)
  })

  it('절벽 아래에서 추가 페널티가 붙는다', () => {
    const above = effectiveFactor(STAMINA.cliff + 1)
    const below = effectiveFactor(STAMINA.cliff - 1)
    // 1 차이인데 감소폭이 선형 기울기보다 훨씬 크다
    const linearStep = STAMINA.rangeFactor / 100
    expect(above - below).toBeGreaterThan(linearStep * 5)
  })

  it('절벽 위에서는 단조 증가한다', () => {
    for (let s = 36; s < 100; s++) {
      expect(effectiveFactor(s + 1)).toBeGreaterThan(effectiveFactor(s))
    }
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- stamina`
Expected: FAIL — `Failed to resolve import "./stamina"`

- [ ] **Step 3: 구현한다**

`src/sim/stamina.ts`:

```ts
import { STAMINA } from './constants'

export function drainTick(current: number, drainCoefficient: number): number {
  const next = current - STAMINA.drainBase * drainCoefficient
  return next < 0 ? 0 : next
}

export function effectiveFactor(stamina: number): number {
  const base = STAMINA.floorFactor + STAMINA.rangeFactor * (stamina / 100)
  return stamina < STAMINA.cliff ? base * STAMINA.cliffPenalty : base
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test -- stamina`
Expected: PASS — 7 tests

- [ ] **Step 5: 커밋한다**

```bash
git add -A
git commit -m "체력 소모와 실효 능력 계산

체력 35 아래에 절벽을 둔다. 소모가 선형이면 강 압박의 이득과 비용이
정확히 상쇄되어 압박 축이 평평해지고 고를 이유가 사라진다. 절벽을
붙여야 비용이 볼록해지고 언제 압박을 풀지가 판단이 된다.

국면 3은 주전 3명이 절벽 직전에서 시작하므로 이 함수가 그 국면의
난이도를 직접 결정한다."
```

---

## Task 5: 공격 판정 4채널

**Files:**
- Create: `src/sim/attack.ts`
- Test: `src/sim/attack.test.ts`

**Interfaces:**
- Consumes: `Coefficients` (tactics.ts), `Rng` (rng.ts), `BASE`/`XG` (constants.ts)
- Produces:
  - `interface TickDraws { homeAttempt: number; homeEnter: number; homeShot: number; awayAttempt: number; awayEnter: number; awayShot: number; behind: number; behindShot: number; setPiece: number; setPieceShot: number }`
  - `drawTick(rng: Rng): TickDraws` — 매 틱 정확히 10개를 고정 순서로 뽑는다
  - `resolveAttacks(draws: TickDraws, c: Coefficients, homeFactor: number, minDefenderSpeed: number): { homeGoals: number; awayGoals: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/sim/attack.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { drawTick, resolveAttacks } from './attack'
import { resolveCoefficients } from './tactics'
import { createRng } from './rng'
import { TOTAL_TICKS } from './constants'
import type { Tactics } from './types'

const t = (line: 0|1|2, press: 0|1|2, width: 0|1|2): Tactics => ({ line, press, width })

function runNoop(tactics: Tactics, mentality: 'PARK_BUS'|'BALANCED'|'ALL_OUT', seed: number) {
  const rng = createRng(seed)
  const c = resolveCoefficients(tactics, mentality, false)
  let home = 0, away = 0
  for (let i = 0; i < TOTAL_TICKS; i++) {
    const r = resolveAttacks(drawTick(rng), c, 1.0, 58)
    home += r.homeGoals
    away += r.awayGoals
  }
  return { home, away }
}

function average(tactics: Tactics, mentality: 'PARK_BUS'|'BALANCED'|'ALL_OUT', n = 400) {
  let home = 0, away = 0
  for (let s = 0; s < n; s++) {
    const r = runNoop(tactics, mentality, 1000 + s)
    home += r.home
    away += r.away
  }
  return { home: home / n, away: away / n }
}

describe('drawTick', () => {
  it('매 틱 정확히 10개를 소비한다', () => {
    const a = createRng(1)
    drawTick(a)
    const afterOne = a.next()

    const b = createRng(1)
    for (let i = 0; i < 10; i++) b.next()
    expect(afterOne).toEqual(b.next())
  })
})

describe('resolveAttacks — 무개입 기준', () => {
  it('양 팀 합계가 15분에 0.9~1.4골이다', () => {
    const { home, away } = average(t(1, 1, 1), 'BALANCED')
    expect(home + away).toBeGreaterThan(0.9)
    expect(home + away).toBeLessThan(1.4)
  })

  it('라인을 내리면 실점이 오히려 는다', () => {
    // "잠글수록 맞는다" — 국면 2와 4의 반전이 여기 걸려 있다
    const normal = average(t(1, 1, 1), 'ALL_OUT')
    const low    = average(t(0, 1, 1), 'ALL_OUT')
    expect(low.away).toBeGreaterThan(normal.away)
  })

  it('라인을 내리면 우리 득점도 준다', () => {
    const normal = average(t(1, 1, 1), 'ALL_OUT')
    const low    = average(t(0, 1, 1), 'ALL_OUT')
    expect(low.home).toBeLessThan(normal.home)
  })

  it('상대가 뭉쳐 있으면 넓게가 좁게보다 많이 넣는다', () => {
    // "모을수록 좁아진다" — 국면 1과 5의 반전
    const wide   = average(t(1, 1, 2), 'PARK_BUS')
    const narrow = average(t(1, 1, 0), 'PARK_BUS')
    expect(wide.home).toBeGreaterThan(narrow.home * 1.3)
  })

  it('느린 수비수일수록 배후 실점이 는다', () => {
    const rngA = createRng(5), rngB = createRng(5)
    const c = resolveCoefficients(t(2, 1, 1), 'ALL_OUT', false)
    let slow = 0, fast = 0
    for (let i = 0; i < TOTAL_TICKS; i++) {
      slow += resolveAttacks(drawTick(rngA), c, 1.0, 58).awayGoals
      fast += resolveAttacks(drawTick(rngB), c, 1.0, 81).awayGoals
    }
    expect(slow).toBeGreaterThanOrEqual(fast)
  })

  it('체력이 떨어지면 우리 득점이 준다', () => {
    const rngA = createRng(9), rngB = createRng(9)
    const c = resolveCoefficients(t(1, 1, 1), 'BALANCED', false)
    let full = 0, tired = 0
    for (let i = 0; i < TOTAL_TICKS; i++) {
      full  += resolveAttacks(drawTick(rngA), c, 1.00, 70).homeGoals
      tired += resolveAttacks(drawTick(rngB), c, 0.60, 70).homeGoals
    }
    expect(tired).toBeLessThanOrEqual(full)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- attack`
Expected: FAIL — `Failed to resolve import "./attack"`

- [ ] **Step 3: 구현한다**

`src/sim/attack.ts`:

```ts
import { BASE, XG } from './constants'
import type { Rng } from './rng'
import type { Coefficients } from './tactics'

export interface TickDraws {
  homeAttempt: number
  homeEnter: number
  homeShot: number
  awayAttempt: number
  awayEnter: number
  awayShot: number
  behind: number
  behindShot: number
  setPiece: number
  setPieceShot: number
}

// 순서를 절대 바꾸지 않는다. 바꾸면 저장된 모든 시드의 결과가 달라진다.
export function drawTick(rng: Rng): TickDraws {
  return {
    behind: rng.next(),
    behindShot: rng.next(),
    homeAttempt: rng.next(),
    homeEnter: rng.next(),
    homeShot: rng.next(),
    awayAttempt: rng.next(),
    awayEnter: rng.next(),
    awayShot: rng.next(),
    setPiece: rng.next(),
    setPieceShot: rng.next(),
  }
}

export function resolveAttacks(
  d: TickDraws,
  c: Coefficients,
  homeFactor: number,
  minDefenderSpeed: number,
): { homeGoals: number; awayGoals: number } {
  let homeGoals = 0
  let awayGoals = 0

  // 상대 배후 침투 — 느린 수비수가 확률을 직접 올린다
  const speedPenalty = 1 + (75 - minDefenderSpeed) / 100
  const pBehind = BASE.B0 * c.behind * speedPenalty
  if (d.behind < pBehind) {
    // 일대일이 되면 슛까지 갈 확률 0.75, 그 슛의 xG 0.185 → 합쳐서 0.139
    if (d.behindShot < XG.oneOnOne * XG.shotSelectOneOnOne) awayGoals += 1
  }

  // 우리 공격 — 폭이 시도 횟수에 곱해진다
  if (d.homeAttempt < BASE.A0 * c.widthK) {
    if (d.homeEnter < BASE.P_ENTER * c.openness) {
      if (d.homeShot < XG.boxCentre * c.entryXg * homeFactor) homeGoals += 1
    }
  }

  // 상대 오픈플레이
  if (d.awayAttempt < BASE.O0 * c.oppOpen) {
    if (d.awayEnter < BASE.P_ENTER_OPP) {
      if (d.awayShot < XG.boxCentre) awayGoals += 1
    }
  }

  // 세트피스 — 라인을 내릴수록 늘어난다
  if (d.setPiece < BASE.S0 * c.setPiece) {
    if (d.setPieceShot < XG.setPiece) awayGoals += 1
  }

  return { homeGoals, awayGoals }
}
```

- [ ] **Step 4: 테스트를 돌린다**

Run: `npm test -- attack`
Expected: PASS — 7 tests

실패하면 **상수를 조정한다. 구조를 바꾸지 않는다.** 조정 순서:
1. 합계 골이 낮으면 `BASE.A0`·`BASE.O0`를 올린다
2. "라인 내리면 실점 는다"가 실패하면 `LINE[0].setPiece`를 올린다
3. "넓게가 1.3배" 가 실패하면 `WIDTH.wide.congestion`을 올리고 `WIDTH.narrow.congestion`을 더 음수로 내린다

- [ ] **Step 5: 커밋한다**

```bash
git add -A
git commit -m "공격 판정 4채널 구현

우리 공격 1개와 상대 3개(배후·오픈플레이·세트피스) 채널을 만든다.
세트피스를 별도 채널로 두는 이유는 라인을 내릴 때 늘어나는 실점
경로가 여기뿐이기 때문이다. 이것이 없으면 라인 낮음이 지배 전략이
된다.

폭은 슛 구역이 아니라 전진 시도 횟수에 곱한다. 구역으로 표현하면
골문 앞 중앙이 측면보다 세 배 값비싸서 좁게가 오히려 이겨버린다.

난수를 매 틱 10개 고정 순서로 뽑는다. 조건 분기 안에서 뽑으면
분기가 갈릴 때마다 이후 수열이 밀려 재현이 조용히 깨진다."
```

---

## Task 6: 750틱 루프와 결정론 증명

**Files:**
- Create: `src/sim/engine.ts`
- Test: `src/sim/engine.test.ts`

**Interfaces:**
- Consumes: 위 전부
- Produces:
  - `createState(problem: Problem): MatchState`
  - `tick(state: MatchState, problem: Problem, rng: Rng): MatchState`
  - `simulate(problem: Problem, decisions: Decision[]): { final: MatchState; passed: boolean }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/sim/engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { simulate, createState } from './engine'
import { TOTAL_TICKS } from './constants'
import type { Problem, Decision } from './types'

const P: Problem = {
  id: 'p02',
  title: '잠긴 문',
  score: [1, 0],
  initialTactics: { line: 0, press: 0, width: 0 },
  homeCount: 11,
  awayCount: 11,
  seed: 40712,
  objective: { type: 'SURVIVE', bonusOnWin: false },
  minDefenderSpeed: 62,
  startStamina: { DF04: 62, MF06: 48, FW09: 71 },
}

describe('simulate — 결정론', () => {
  it('같은 시드와 같은 결정이면 완전히 같은 결과가 나온다', () => {
    const d: Decision[] = [{ tick: 100, type: 'LINE', value: 1 }]
    const a = simulate(P, d)
    const b = simulate(P, d)
    expect(a.final).toEqual(b.final)
  })

  it('결정 하나만 달라도 결과가 갈린다', () => {
    const withMove = simulate(P, [{ tick: 100, type: 'LINE', value: 1 }])
    const without  = simulate(P, [])
    expect(withMove.final.score).not.toEqual(without.final.score)
  })

  it('시드가 다르면 결과가 갈린다', () => {
    const a = simulate(P, [])
    const b = simulate({ ...P, seed: 40713 }, [])
    expect(a.final.score).not.toEqual(b.final.score)
  })
})

describe('simulate — 루프', () => {
  it('정확히 750틱 돈다', () => {
    expect(simulate(P, []).final.tick).toBe(TOTAL_TICKS)
  })

  it('물려받은 지시로 시작한다', () => {
    expect(createState(P).tactics).toEqual({ line: 0, press: 0, width: 0 })
  })

  it('결정이 지정한 틱에 반영된다', () => {
    const r = simulate(P, [{ tick: 300, type: 'PRESS', value: 2 }])
    expect(r.final.tactics.press).toBe(2)
  })

  it('상대 성향이 스코어에서 도출된다', () => {
    // 1-0으로 우리가 이기고 있으니 상대는 지고 있어 올라온다
    expect(createState(P).opponent).toBe('ALL_OUT')
  })

  it('SURVIVE는 리드를 지키면 통과다', () => {
    const r = simulate(P, [])
    expect(r.passed).toBe(r.final.score[0] >= r.final.score[1])
  })
})

describe('simulate — 국면 2의 반전', () => {
  function passRate(decisions: Decision[], n = 300): number {
    let pass = 0
    for (let s = 0; s < n; s++) {
      if (simulate({ ...P, seed: 40000 + s }, decisions).passed) pass++
    }
    return pass / n
  }

  it('잠금을 푸는 쪽이 방치보다 확실히 낫다', () => {
    const noop = passRate([])
    const fix  = passRate([
      { tick: 0, type: 'LINE',  value: 1 },
      { tick: 0, type: 'PRESS', value: 1 },
    ])
    expect(fix - noop).toBeGreaterThan(0.15)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- engine`
Expected: FAIL — `Failed to resolve import "./engine"`

- [ ] **Step 3: 구현한다**

`src/sim/engine.ts`:

```ts
import { createRng, type Rng } from './rng'
import { resolveCoefficients } from './tactics'
import { drawTick, resolveAttacks } from './attack'
import { drainTick, effectiveFactor } from './stamina'
import { TOTAL_TICKS } from './constants'
import type { Decision, MatchState, Mentality, Problem } from './types'

export function mentalityOf(score: [number, number]): Mentality {
  const diff = score[1] - score[0]
  if (diff < 0) return 'ALL_OUT'
  if (diff > 0) return 'PARK_BUS'
  return 'BALANCED'
}

export function createState(problem: Problem): MatchState {
  return {
    tick: 0,
    score: [...problem.score] as [number, number],
    tactics: { ...problem.initialTactics },
    stamina: { ...problem.startStamina },
    opponent: mentalityOf(problem.score),
    homeCount: problem.homeCount,
    awayCount: problem.awayCount,
  }
}

function meanStamina(stamina: Record<string, number>): number {
  const values = Object.values(stamina)
  if (values.length === 0) return 100
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function tick(state: MatchState, problem: Problem, rng: Rng): MatchState {
  const c = resolveCoefficients(state.tactics, state.opponent, state.awayCount < 11)
  const next: MatchState = {
    ...state,
    score: [...state.score] as [number, number],
    stamina: { ...state.stamina },
  }

  for (const id of Object.keys(next.stamina)) {
    next.stamina[id] = drainTick(next.stamina[id], c.drain)
  }

  const homeFactor = effectiveFactor(meanStamina(next.stamina))
  const { homeGoals, awayGoals } = resolveAttacks(
    drawTick(rng), c, homeFactor, problem.minDefenderSpeed,
  )

  next.score[0] += homeGoals
  next.score[1] += awayGoals
  if (homeGoals || awayGoals) next.opponent = mentalityOf(next.score)
  next.tick = state.tick + 1
  return next
}

// SURVIVE(리드 지키기)와 EQUALIZE(동점 이상) 모두 종료 시 조건은 같다 —
// 지지만 않으면 통과. 둘을 나눠 둔 이유는 화면에 다른 목표 문구를 띄우고,
// EQUALIZE에서 승리 시 평점 가산(bonusOnWin)을 주기 위해서다.
function judge(state: MatchState): boolean {
  const [home, away] = state.score
  return home >= away
}

export function simulate(
  problem: Problem,
  decisions: Decision[],
): { final: MatchState; passed: boolean } {
  const rng = createRng(problem.seed)
  let state = createState(problem)

  const byTick = new Map<number, Decision[]>()
  for (const d of decisions) {
    const list = byTick.get(d.tick) ?? []
    list.push(d)
    byTick.set(d.tick, list)
  }

  for (let i = 0; i < TOTAL_TICKS; i++) {
    for (const d of byTick.get(i) ?? []) {
      if (d.type === 'LINE') state.tactics.line = d.value
      else if (d.type === 'PRESS') state.tactics.press = d.value
      else state.tactics.width = d.value
    }
    state = tick(state, problem, rng)
  }

  return { final: state, passed: judge(state) }
}
```

- [ ] **Step 4: 테스트를 돌린다**

Run: `npm test -- engine`
Expected: PASS — 9 tests

마지막 테스트("잠금을 푸는 쪽이 15%p 이상 낫다")가 실패하면 **국면 2가 아직 퍼즐이 아니라는 뜻**이다. `LINE[0].setPiece`를 올리거나 `BASE.S0`를 올린다. 이 테스트를 통과할 때까지 Task 7로 가지 않는다.

- [ ] **Step 5: 커밋한다**

```bash
git add -A
git commit -m "750틱 루프와 결정론 보장

같은 시드와 같은 결정 이력이면 완전히 동일한 상태가 나오는 것을
테스트로 박는다. 이것이 깨지면 경기 분석 화면의 병렬 재생이 조용히
어긋나고, 증상이 눈에 띄지 않아 마감 직전에 발견된다.

상대 성향을 국면 데이터가 아니라 스코어에서 매 틱 도출한다.
고정값으로 두면 경기 중 스코어가 바뀌어도 상대가 그대로여서
이기고 있던 팀이 동점을 허용하고도 계속 내려앉아 있게 된다.

국면 2의 반전이 성립하는지를 테스트로 확인한다. 잠금을 푸는 쪽이
방치보다 15%p 이상 나아야 퍼즐이다."
```

---

## Task 7: 무개입 측정 스크립트

**Files:**
- Create: `balance/measure.ts`
- Create: `src/data/problems.json`

**Interfaces:**
- Consumes: `simulate` (engine.ts), `Problem` (types.ts)
- Produces: `npm run sim` 이 국면별 무개입 통과율과 평균 스코어를 표로 출력

- [ ] **Step 1: 국면 데이터를 쓴다**

화요일에는 5개 중 **국면 2와 4만** 넣는다. 나머지는 토요일에 추가한다.

`src/data/problems.json`:

```json
[
  {
    "id": "p02",
    "title": "잠긴 문",
    "order": 1,
    "score": [1, 0],
    "initialTactics": { "line": 0, "press": 0, "width": 0 },
    "homeCount": 11,
    "awayCount": 11,
    "seed": 40712,
    "objective": { "type": "SURVIVE", "bonusOnWin": false },
    "minDefenderSpeed": 62,
    "startStamina": { "DF04": 62, "MF06": 48, "FW09": 71, "DF02": 70, "MF08": 66 }
  },
  {
    "id": "p04",
    "title": "한 명이 없다",
    "order": 4,
    "score": [1, 0],
    "initialTactics": { "line": 0, "press": 0, "width": 0 },
    "homeCount": 10,
    "awayCount": 11,
    "seed": 51823,
    "objective": { "type": "SURVIVE", "bonusOnWin": false },
    "minDefenderSpeed": 58,
    "startStamina": { "DF04": 55, "MF06": 41, "FW09": 60, "DF02": 63, "MF08": 58 }
  }
]
```

- [ ] **Step 2: 측정 스크립트를 쓴다**

`balance/measure.ts`:

```ts
import problems from '../src/data/problems.json'
import { simulate } from '../src/sim/engine'
import type { Problem, Decision } from '../src/sim/types'

const SEEDS = 400

function measure(base: Problem, decisions: Decision[]) {
  let pass = 0, home = 0, away = 0
  for (let s = 0; s < SEEDS; s++) {
    const r = simulate({ ...base, seed: base.seed + s }, decisions)
    if (r.passed) pass++
    home += r.final.score[0]
    away += r.final.score[1]
  }
  return {
    rate: pass / SEEDS,
    home: home / SEEDS,
    away: away / SEEDS,
  }
}

const UNLOCK: Decision[] = [
  { tick: 0, type: 'LINE', value: 1 },
  { tick: 0, type: 'PRESS', value: 1 },
]

console.log('국면        무개입    잠금해제   격차     평균 스코어')
console.log('─'.repeat(58))

for (const p of problems as Problem[]) {
  const noop = measure(p, [])
  const fix = measure(p, UNLOCK)
  const gap = fix.rate - noop.rate
  const flag = gap >= 0.20 ? '합격' : '미달'
  console.log(
    `${p.title.padEnd(10)} ${(noop.rate * 100).toFixed(1).padStart(6)}% ` +
    `${(fix.rate * 100).toFixed(1).padStart(8)}% ` +
    `${(gap * 100).toFixed(1).padStart(6)}%p ${flag}  ` +
    `${noop.home.toFixed(2)} - ${noop.away.toFixed(2)}`,
  )
}
```

- [ ] **Step 3: 돌린다**

Run: `npm run sim`

Expected: 이런 표가 나온다.

```
국면        무개입    잠금해제   격차     평균 스코어
──────────────────────────────────────────────────────────
잠긴 문       47.5%     76.4%    28.9%p 합격  1.42 - 1.08
한 명이 없다   32.0%     58.3%    26.4%p 합격  1.31 - 1.44
```

**확인할 것 3개:**
1. 평균 스코어의 합(우리 + 상대 − 시작 스코어)이 **0.9 ~ 1.4** 안인가
2. 무개입 통과율이 **50% 이하**인가
3. 격차가 **20%p 이상**인가

미달이면 `src/sim/constants.ts`만 고친다. 다른 파일은 건드리지 않는다.

- [ ] **Step 4: 커밋한다**

```bash
git add -A
git commit -m "무개입 측정 스크립트와 국면 2·4 데이터

브라우저 없이 Node에서 400시드를 돌려 통과율을 숫자로 뽑는다.
손으로 확인하면 한 국면당 8시간이 걸리는 작업이 몇 초로 끝난다.

국면 두 개만 먼저 넣는다. 나머지 세 개는 엔진에 경고·퇴장·교체가
들어간 뒤에 추가해야 다시 손대지 않는다."
```

---

## Task 8: 화요일 마무리 점검

**Files:**
- Modify: `README.md` (개발 현황 체크박스)

- [ ] **Step 1: 전체 테스트를 돌린다**

Run: `npm test`
Expected: 모든 테스트 PASS. 실패가 하나라도 있으면 수요일로 넘기지 않는다.

- [ ] **Step 2: sim 이 브라우저 API를 참조하지 않는지 확인한다**

Run:
```bash
npx tsx -e "import('./src/sim/engine.ts').then(() => console.log('OK: Node에서 로드됨'))"
```
Expected: `OK: Node에서 로드됨`

에러가 나면 `src/sim/` 안 어딘가가 브라우저 API를 참조하고 있다. 찾아서 제거한다. **이걸 넘기면 목요일에 검증 하네스 전체가 죽는다.**

- [ ] **Step 3: README 갱신**

`README.md`의 개발 현황에서 시뮬레이션 엔진 줄을 진행 중으로 바꾼다.

```markdown
- [x] 설계 명세 확정
- [x] 국면 5종 정의
- [x] 시뮬레이션 엔진 — 틱 루프 · 확률 모델 · 결정론
- [ ] Canvas 렌더러 · 전술 레버
- [ ] 자동 검증 하네스
- [ ] 경기 분석 화면
- [ ] 배포
```

- [ ] **Step 4: 커밋하고 푸시한다**

```bash
git add -A
git commit -m "화요일 작업 마무리 — 엔진 코어 완료

750틱이 결정론적으로 돌고, 무개입 통과율이 숫자로 나온다.
수요일은 경고·퇴장·부상·교체 카드와 상대 성향 전환을 붙인다."
git push
```

---

## 수요일 이후 (참고)

| 날 | 내용 |
|---|---|
| 수 7/29 | 경고·퇴장·부상·페널티 · 상대 성향 전환과 예고 · 교체 카드 실행과 반영 지연 · 봇 A/C/E · 27조합 스윕 |
| 목 7/30 | Canvas 피치 · 레버 UI · 2단계 탭 교체 · **최소 배포** |
| 금 7/31 | 경기 분석 화면 · 기대값 델타 · 평점 · 병렬 재생 |
| 토 8/1 | 국면 5종 완성 · 밸런싱 · **저녁 파라미터 동결** |
| 일 8/2 | 최초 15초 · 모바일 실기기 · 코멘터리 · 안정화 · **최종 커밋** |
