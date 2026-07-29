import { createRng, type Rng } from './rng'
import { HOME_SQUAD, getPlayer } from './squad'
import type { Level, PlayerOrder, PlayerState, Problem, Tactics } from './types'

/**
 * 국면의 시작 조건을 시드에서 뽑는다.
 *
 * 전에는 국면이 매번 **완전히 같은 상태**로 시작했다. 「잠긴 문」은 늘 4번
 * 체력 62, 6번 48, 경고 보유자도 고정이었다. 한 번 풀면 두 번째부터는
 * 같은 답을 다시 입력하는 것이라, 여러 번 해 볼 값어치가 없었다.
 *
 * **흔드는 것은 세부뿐이다.** 스코어·목표·인원과 앞 감독이 걸어둔 전술의
 * 성격은 국면의 정체성이라 고정한다. 중립 상태에서 시작하면 아무것도 안
 * 해도 통과해버린다 — 실측으로 무개입 통과율이 77%까지 올라간 적이 있다.
 *
 * ## 난수 규칙
 *
 * - **`Math.random` 은 쓰지 않는다.** 여기도 `src/sim/` 이다.
 * - 경기용 스트림과 **분리된 스트림**을 국면 시드에서 파생해 쓴다.
 *   매 틱 18개를 뽑는 `drawTick()` 의 수열은 한 톨도 건드리지 않는다 —
 *   시작 조건 생성은 경기가 시작되기 전에 끝나는 별개의 일이다.
 * - **뽑는 개수가 조건에 따라 달라지면 안 된다.** 필요 없는 슬롯도 반드시
 *   뽑아서 버린다. 그래야 같은 시드가 언제나 같은 선수단을 만든다.
 */

/** 경기용·연출용 스트림과 겹치지 않게 떼어내는 상수 */
const SETUP_OFFSET = 0x85ebca6b

export function setupRngFor(seed: number): Rng {
  return createRng((seed ^ SETUP_OFFSET) >>> 0)
}

/**
 * 지시를 미리 걸어둘 수 있는 최대 인원.
 *
 * 감독이 쓸 자리를 남겨야 한다. 동시 지시 상한이 세 명(`MAX_ORDERS`)인데
 * 셋을 다 채워놓으면 감독은 무엇을 걸든 먼저 하나를 풀어야 하고, 그건
 * 선택지가 아니라 벌이다.
 */
const MAX_PRESET_ORDERS = 2

/** 흔든 뒤에도 반드시 참이어야 하는 것들을 여기서 지킨다 */
function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

/** `lo`~`hi` 사이의 정수 하나 */
function pickInt(rng: Rng, lo: number, hi: number) {
  return lo + Math.floor(rng.next() * (hi - lo + 1))
}

/**
 * 앞 감독이 걸어둔 전술.
 *
 * 레버마다 뽑을 수 있는 값을 국면이 정한다. 「잠긴 문」의 라인은 늘 낮음이되
 * 폭은 좁게일 수도 보통일 수도 있다 — 잠긴 것은 같고 **어떻게 잠겼는지**가
 * 다르다.
 *
 * 뽑을 값이 하나뿐이어도 난수를 뽑아서 버린다. 국면마다 소비 개수가
 * 달라지면 같은 시드가 국면에 따라 다른 자리에서 갈린다.
 */
function rollTactics(problem: Problem, rng: Rng): Tactics {
  const v = problem.variation?.tactics
  const pick = (choices: Level[] | undefined, fallback: Level): Level => {
    const r = rng.next()
    if (!choices || choices.length === 0) return fallback
    return choices[Math.min(choices.length - 1, Math.floor(r * choices.length))]
  }
  return {
    line: pick(v?.line, problem.initialTactics.line),
    press: pick(v?.press, problem.initialTactics.press),
    width: pick(v?.width, problem.initialTactics.width),
  }
}

/**
 * 시작 선수 상태를 뽑는다.
 *
 * 체력 → 경고 → 지시 순서로 소비한다. 이 순서를 바꾸면 저장된 모든 시드의
 * 선수단이 달라진다.
 */
function rollPlayers(problem: Problem, base: PlayerState[], rng: Rng): PlayerState[] {
  const v = problem.variation
  const spread = v?.staminaSpread ?? 0
  const [lo, hi] = v?.staminaRange ?? [25, 100]

  // 1) 체력 — 전원에게 한 번씩. 뽑는 개수가 명단 길이로 고정된다
  let next = base.map((s) => {
    const jitter = (rng.next() * 2 - 1) * spread
    return { ...s, stamina: Math.round(clamp(s.stamina + jitter, lo, hi)) }
  })

  /**
   * 2) 경고 — 반칙이 나오는 자리에서 뽑는다.
   *
   * 골키퍼와 공격수는 후보가 아니다. 태클로 경고를 받는 것은 수비하는
   * 선수이고, 이 시뮬레이션에서 퇴장 위험이 실제로 걸리는 것도 그쪽이다.
   */
  const bookable = next
    .filter((s) => s.onPitch && !s.out)
    .filter((s) => {
      const pos = getPlayer(s.id).pos
      return pos === 'DF' || pos === 'MF'
    })
    .map((s) => s.id)
  const [bLo, bHi] = v?.booked ?? [0, 0]
  const bookCount = pickInt(rng, bLo, Math.max(bLo, bHi))
  /**
   * 뽑은 것이 **전부**다. 국면에 적힌 `booked` 에 더하지 않는다.
   * 더하면 띠가 0~2인데 실제로는 1~3이 되어, 적어둔 범위와 실제가 갈린다.
   */
  const booked = new Set<string>()
  // 상한만큼 늘 뽑고 필요 없는 것은 버린다
  for (let i = 0; i < Math.max(bLo, bHi); i++) {
    const at = Math.floor(rng.next() * Math.max(1, bookable.length))
    if (i < bookCount && bookable.length > 0) booked.add(bookable[at % bookable.length])
  }
  next = next.map((s) => ({ ...s, booked: booked.has(s.id) }))

  /**
   * 3) 앞 감독이 걸어둔 지시 — **잘못 걸린 것이어야 한다.**
   *
   * 골키퍼는 어떤 지시도 받지 않는다. `HOLD` 는 여기서 걸지 않는다 —
   * 그건 지키는 판에서 실제로 이득인 지시라, 물려받은 순간 감독의 첫
   * 과제가 "풀기"가 아니라 "그대로 두기"가 된다.
   */
  const kinds = (v?.orderKinds ?? []).filter((k) => k !== 'NONE' && k !== 'HOLD')
  const [oLo, oHi] = v?.orders ?? [0, 0]
  const cap = Math.min(Math.max(oLo, oHi), MAX_PRESET_ORDERS)
  const orderCount = clamp(pickInt(rng, oLo, Math.max(oLo, oHi)), 0, cap)
  const targets = next
    .filter((s) => s.onPitch && !s.out && getPlayer(s.id).pos !== 'GK')
    .map((s) => s.id)
  const chosen = new Map<string, PlayerOrder>()
  for (let i = 0; i < MAX_PRESET_ORDERS; i++) {
    const at = Math.floor(rng.next() * Math.max(1, targets.length))
    const kindAt = Math.floor(rng.next() * Math.max(1, kinds.length))
    if (i >= orderCount || targets.length === 0 || kinds.length === 0) continue
    const id = targets[at % targets.length]
    if (chosen.has(id)) continue
    chosen.set(id, kinds[kindAt % kinds.length])
  }
  next = next.map((s) => {
    const o = chosen.get(s.id)
    return o ? { ...s, order: o } : s
  })

  return next
}

/**
 * 국면의 시작 조건 한 벌.
 *
 * `createState` 에서 **한 번만** 부른다. 경기가 시작된 뒤로는 이 스트림을
 * 다시 건드리지 않는다.
 */
export function rollSetup(
  problem: Problem,
  base: PlayerState[],
): { tactics: Tactics; players: PlayerState[] } {
  if (!problem.variation) {
    return { tactics: { ...problem.initialTactics }, players: base }
  }
  const rng = setupRngFor(problem.seed)
  const tactics = rollTactics(problem, rng)
  const players = rollPlayers(problem, base, rng)
  return { tactics, players }
}

/** 벤치에 선발보다 이만큼 빠른 수비수가 반드시 있어야 한다 */
export const BENCH_SPEED_EDGE = 10

/**
 * 흔든 결과가 승부처를 지우지 않았는지 확인한다.
 *
 * "느린 수비수를 빠른 수비수로 교체한다"가 이 시뮬레이션의 대표 승부처다.
 * 벤치에 선발보다 확실히 빠른 수비수가 없으면 그 판단이 원리적으로
 * 사라진다. 지금은 속도를 흔들지 않아 언제나 참이지만, 능력치를 흔들게
 * 되면 여기서 걸린다.
 */
export function benchHasFasterDefender(): boolean {
  const onPitch = HOME_SQUAD.filter((p) => !p.onBench && p.pos === 'DF')
  const bench = HOME_SQUAD.filter((p) => p.onBench && p.pos === 'DF')
  if (onPitch.length === 0 || bench.length === 0) return false
  const slowest = Math.min(...onPitch.map((p) => p.speed))
  const fastest = Math.max(...bench.map((p) => p.speed))
  return fastest - slowest >= BENCH_SPEED_EDGE
}
