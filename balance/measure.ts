/**
 * 무개입 통과율 측정.
 *
 * 브라우저 없이 Node에서 돌린다. 손으로 확인하면 한 국면당 8시간이
 * 걸리는 작업이 몇 초로 끝난다. 실행: npm run sim
 */
import raw from '../src/data/problems.json' with { type: 'json' }
import { simulate } from '../src/sim/engine'
import { DIFFICULTY } from '../src/sim/constants'
import { FORMATION_IDS, type FormationId } from '../src/sim/formations'
import { getPlayer, initialPlayers } from '../src/sim/squad'
import { toProblem } from '../src/sim/problems'
import type { Decision, Difficulty, Level, PlayerOrder, Problem } from '../src/sim/types'

/** 국면 파싱은 `src/sim/problems.ts` 한 자리에만 둔다 */
export const problems = raw.map(toProblem)

/**
 * 어느 상대로 잴 것인가.
 *
 * **합격 기준은 「보통」에서만 지킨다.** 쉬움에서 무개입 통과율이 오르는
 * 것은 설계대로이고, 그것을 미달로 세면 난이도를 넣을 수가 없다. 그래서
 * 인자를 안 주면 언제나 보통이고, 저장된 기준선도 그 값이다.
 *
 * `npm run sim` — 보통만 (기존과 동일, 3~4분)
 * `npm run sim -- --difficulty=HARD` — 어려움만
 * `npm run sim -- --difficulty=ALL` — 셋 다 (10~12분)
 */
const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: '쉬움',
  NORMAL: '보통',
  HARD: '어려움',
}

function parseDifficulties(argv: string[]): Difficulty[] {
  const arg = argv.find((a) => a.startsWith('--difficulty='))?.split('=')[1]?.toUpperCase()
  if (!arg || arg === 'NORMAL') return ['NORMAL']
  if (arg === 'ALL') return ['EASY', 'NORMAL', 'HARD']
  if (arg === 'EASY' || arg === 'HARD') return [arg]
  throw new Error(`--difficulty 는 EASY·NORMAL·HARD·ALL 중 하나다 (${arg})`)
}

const DIFFICULTIES = parseDifficulties(process.argv.slice(2))

/**
 * 시드 수는 조합 간 차이를 판별할 수 있을 만큼 커야 한다.
 * 400개면 60% 근처에서 표준오차가 약 2.4%p라, 조합끼리 1~2%p 차이는
 * 노이즈와 구분되지 않는다. 1200개면 약 1.4%p 로 내려간다.
 */
const SEEDS = 1200

/** 통과율 p 의 표준오차 */
const stderr = (p: number) => Math.sqrt((p * (1 - p)) / SEEDS)

/** 합격 기준 — docs/design.md 10장 */
const NOOP_MAX = 0.5
const GAP_MIN = 0.2

function measure(base: Problem, decisions: Decision[], difficulty: Difficulty) {
  let pass = 0
  let home = 0
  let away = 0
  for (let s = 0; s < SEEDS; s++) {
    const r = simulate({ ...base, seed: base.seed + s }, decisions, difficulty)
    if (r.passed) pass++
    home += r.final.score[0] - base.score[0]
    away += r.final.score[1] - base.score[1]
  }
  return { rate: pass / SEEDS, home: home / SEEDS, away: away / SEEDS }
}

const set = (line: Level, press: Level, width: Level): Decision[] => [
  { tick: 0, type: 'LINE', value: line },
  { tick: 0, type: 'PRESS', value: press },
  { tick: 0, type: 'WIDTH', value: width },
]

/**
 * 개별 지시 조합.
 *
 * 지시 축이 게이트에 안 보이면 "효과가 있다"를 감으로 말하게 된다.
 * 포메이션과 같은 방식으로 **1위 레버 조합 위에서 지시만** 훑는다.
 * 전량 교차(27 × 지시)를 돌리면 측정이 열 배로 늘어나는데, 지시가 결과를
 * 움직이는지만 알면 충분하다.
 *
 * 대상은 국면마다 다르게 고른다. 상수로 박으면(예: "4번 수비수") 포메이션이
 * 바뀌거나 그 선수가 없는 국면에서 지시가 조용히 사라진다.
 */
function orderPlans(base: Problem): Array<{ label: string; picks: Array<[string, PlayerOrder]> }> {
  const onPitch = initialPlayers(base).filter((s) => s.onPitch && !s.out)
  const defs = onPitch.filter((s) => getPlayer(s.id).pos === 'DF').map((s) => s.id)
  const mids = onPitch.filter((s) => getPlayer(s.id).pos === 'MF').map((s) => s.id)
  // 물러설 1순위는 경고를 안고 있는 선수다. 두 번째 경고가 곧 퇴장이다
  const risky = onPitch.find((s) => s.booked)?.id ?? mids[0]
  /**
   * 아껴 뛸 1순위는 체력이 가장 낮은 선수다. 부상 임계(25)에 가장 가깝다.
   *
   * **물러설 선수와 겹치면 안 된다.** 한 사람에게 두 지시를 걸면 뒤엣것만
   * 남아 조합 측정이 통째로 사라진다 — 실제로 세 국면 모두 경고 보유자가
   * 곧 최저 체력자여서, 조합 행이 조용히 비어 있었다
   */
  const tired = [...onPitch]
    .sort((a, b) => a.stamina - b.stamina)
    .find((s) => s.id !== risky)?.id
  const hold: Array<[string, PlayerOrder]> = defs.slice(0, 2).map((id) => [id, 'HOLD'])

  const plans: Array<{ label: string; picks: Array<[string, PlayerOrder]> }> = [
    { label: '지시 없음', picks: [] },
    { label: '골문앞 1', picks: hold.slice(0, 1) },
    { label: '골문앞 2', picks: hold },
  ]
  if (risky) plans.push({ label: '물러서라', picks: [[risky, 'BACK_OFF']] })
  if (tired) plans.push({ label: '아껴뛰어라', picks: [[tired, 'CONSERVE']] })
  if (risky && tired && risky !== tired) {
    plans.push({ label: '물러서라+아껴뛰어라', picks: [[risky, 'BACK_OFF'], [tired, 'CONSERVE']] })
    plans.push({
      label: '골문앞1+물러서라+아껴뛰어라',
      picks: [...hold.slice(0, 1), [risky, 'BACK_OFF'], [tired, 'CONSERVE']],
    })
  }
  return plans
}

/** 27조합을 전부 돌려 순위를 낸다. 정답 경로를 손으로 적지 않아도 된다 */
function sweep(base: Problem, difficulty: Difficulty) {
  const rows: Array<{ label: string; rate: number }> = []
  for (let l = 0; l <= 2; l++) {
    for (let p = 0; p <= 2; p++) {
      for (let w = 0; w <= 2; w++) {
        const { rate } = measure(base, set(l as Level, p as Level, w as Level), difficulty)
        rows.push({ label: `${l}/${p}/${w}`, rate })
      }
    }
  }
  rows.sort((a, b) => b.rate - a.rate)
  return rows
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/**
 * 한 난이도를 전부 잰다.
 *
 * **합격 판정은 「보통」에서만 한다.** 쉬움에서 무개입 통과율이 오르는 것은
 * 설계대로다 — 약한 상대를 골랐으니 더 자주 버텨야 맞다. 그것을 미달로
 * 세면 난이도라는 기능 자체를 넣을 수가 없다. 대신 세 난이도 모두에서
 * **격차**(무개입 → 최선)를 찍어, 어느 난이도에서도 "아무것도 안 해도
 * 되는 판"이 되지 않았는지 눈으로 확인한다.
 */
function runDifficulty(difficulty: Difficulty): boolean {
  let allPassed = true
  const winners: Array<{ title: string; top: string }> = []
  const formationWinners: Array<{ title: string; top: FormationId }> = []
  /** 국면마다 지시가 노이즈 바닥을 넘어 움직인 조합 수 */
  const orderMoved: Array<{ title: string; moved: number }> = []
  const gated = difficulty === 'NORMAL'

  console.log(
    `\n${'═'.repeat(72)}\n` +
      `상대 난이도 ${DIFFICULTY_LABEL[difficulty]} — 우리 ${DIFFICULTY.ourRank}위 대 상대 ` +
      `${DIFFICULTY.levels[difficulty].rank}위` +
      (gated ? '   ← 합격 기준을 재는 자리' : '   (합격 판정 없음 · 참고용)') +
      `\n${'═'.repeat(72)}`,
  )

  for (const p of problems) {
    const noop = measure(p, [], difficulty)
    const rows = sweep(p, difficulty)
    const top = rows[0]
    const bottom = rows[rows.length - 1]
    const gap = top.rate - noop.rate
    const ok = noop.rate <= NOOP_MAX && gap >= GAP_MIN
    if (!ok && gated) allPassed = false
    winners.push({ title: p.title, top: top.label })

    // 1위와 통계적으로 구분되지 않는 조합은 공동 1위로 본다
    const margin = 2 * Math.sqrt(stderr(top.rate) ** 2 + stderr(rows[1].rate) ** 2)
    const tied = rows.filter((r) => top.rate - r.rate < margin)

    console.log(`■ ${p.title}  ${gated ? (ok ? '합격' : '미달') : `격차 ${(gap * 100).toFixed(1)}%p`}`)
    console.log(
      `   무개입 ${pct(noop.rate)} → 최선 ${pct(top.rate)} (${top.label})   ` +
        `격차 ${(gap * 100).toFixed(1)}%p   스프레드 ${((top.rate - bottom.rate) * 100).toFixed(1)}%p`,
    )
    console.log(
      `   평균 득점 ${noop.home.toFixed(2)} · 실점 ${noop.away.toFixed(2)} ` +
        `(합계 ${(noop.home + noop.away).toFixed(2)}골 / 15분)`,
    )
    console.log(
      `   상위 5: ${rows
        .slice(0, 5)
        .map((r) => `${r.label} ${pct(r.rate)}`)
        .join('  ')}`,
    )
    console.log(
      `   최하위: ${bottom.label} ${pct(bottom.rate)}   ` +
        `1위와 구분 안 되는 조합 ${tied.length}개 (오차 ±${(margin * 100).toFixed(1)}%p)`,
    )

    // 포메이션은 레버와 별도로 훑는다. 27 x 5 = 135조합을 다 돌리면 느리고,
    // 형태가 결과를 바꾸는지만 알면 충분하다
    const [l, pr, w] = top.label.split('/').map(Number) as [Level, Level, Level]
    const byFormation = FORMATION_IDS.map((f) => ({
      id: f,
      rate: measure({ ...p, initialFormation: f }, set(l, pr, w), difficulty).rate,
    })).sort((a, b) => b.rate - a.rate)

    console.log(
      `   포메이션: ${byFormation.map((f) => `${f.id} ${pct(f.rate)}`).join('  ')}`,
    )
    console.log(
      `   포메이션 스프레드 ${((byFormation[0].rate - byFormation[byFormation.length - 1].rate) * 100).toFixed(1)}%p`,
    )

    /**
     * 개별 지시 — 1위 레버 조합 위에서만 훑는다.
     *
     * **노이즈 바닥을 지킨다.** 시드 1200개면 통과율 표준오차가 약 1.4%p라
     * 두 조건을 비교할 때 판별 가능한 최소 차이가 4%p 안팎이다. 그보다 작은
     * 효과는 있으나 마나이므로, 그런 지시는 계수를 키우거나 버려야 한다
     */
    const lever = set(l, pr, w)
    const orderRows = orderPlans(p).map((plan) => ({
      label: plan.label,
      rate: measure(
        p,
        [...lever, ...plan.picks.map(([target, order]) => ({ tick: 0, type: 'ORDER' as const, target, order }))],
        difficulty,
      ).rate,
    }))
    const noOrders = orderRows[0].rate
    const floor = 2 * Math.sqrt(2) * stderr(noOrders)
    console.log(
      `   지시(${top.label} 위에서): ${orderRows
        .slice(1)
        .map((r) => `${r.label} ${((r.rate - noOrders) * 100 >= 0 ? '+' : '') + ((r.rate - noOrders) * 100).toFixed(1)}%p`)
        .join('  ')}`,
    )
    const moved = orderRows.slice(1).filter((r) => Math.abs(r.rate - noOrders) >= floor)
    console.log(
      `   지시 노이즈 바닥 ±${(floor * 100).toFixed(1)}%p — 바닥을 넘은 조합 ${moved.length}/${orderRows.length - 1}`,
    )
    orderMoved.push({ title: p.title, moved: moved.length })
    console.log()
    formationWinners.push({ title: p.title, top: byFormation[0].id })
  }

  console.log('─'.repeat(72))
  if (gated) {
    console.log(`기준: 무개입 ${pct(NOOP_MAX)} 이하 · 격차 ${pct(GAP_MIN)} 이상`)
    console.log(allPassed ? '전 국면 합격' : '미달 국면 있음 — src/sim/constants.ts 를 조정한다')
  } else {
    console.log(
      `${DIFFICULTY_LABEL[difficulty]}은 합격 판정 대상이 아니다. ` +
        `기준은 보통에서만 재고, 여기서는 격차가 살아 있는지만 본다`,
    )
  }

  // 국면마다 정답이 달라야 "판마다 다른 판단이 필요하다"가 성립한다
  const distinct = new Set(winners.map((w) => w.top))
  console.log(
    distinct.size === 1
      ? `주의: 전 국면의 최선 조합이 ${[...distinct][0]} 로 동일하다 — 만능 조합이 존재한다`
      : `국면별 최선 레버: ${winners.map((w) => `${w.title} ${w.top}`).join(' · ')}`,
  )

  const distinctForm = new Set(formationWinners.map((w) => w.top))
  console.log(
    distinctForm.size === 1
      ? `주의: 전 국면의 최선 포메이션이 ${[...distinctForm][0]} 로 동일하다`
      : `국면별 최선 포메이션: ${formationWinners.map((w) => `${w.title} ${w.top}`).join(' · ')}`,
  )

  // 지시가 어느 국면에서도 노이즈 바닥을 못 넘으면 그건 조작이 아니라 장식이다
  const totalMoved = orderMoved.reduce((n, x) => n + x.moved, 0)
  console.log(
    totalMoved === 0
      ? '주의: 개별 지시가 어느 국면에서도 노이즈 바닥을 넘지 못했다 — 계수를 키우거나 버린다'
      : `개별 지시가 바닥을 넘은 조합: ${orderMoved.map((x) => `${x.title} ${x.moved}개`).join(' · ')}`,
  )

  return allPassed
}

console.log(`시드 ${SEEDS}개 × 국면 ${problems.length}개 × 27조합`)
console.log(`조합은 라인/압박/폭. 0=낮음·약·좁게, 1=보통·중, 2=높음·강·넓게`)
console.log(
  `난이도: ${DIFFICULTIES.map((d) => DIFFICULTY_LABEL[d]).join(' · ')}` +
    (DIFFICULTIES.length === 1 ? '   (--difficulty=ALL 로 셋 다 잰다)' : ''),
)

let everythingPassed = true
for (const difficulty of DIFFICULTIES) {
  if (!runDifficulty(difficulty)) everythingPassed = false
}

if (!everythingPassed) process.exitCode = 1
