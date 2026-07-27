/**
 * 무개입 통과율 측정.
 *
 * 브라우저 없이 Node에서 돌린다. 손으로 확인하면 한 국면당 8시간이
 * 걸리는 작업이 몇 초로 끝난다. 실행: npm run sim
 */
import raw from '../src/data/problems.json' with { type: 'json' }
import { simulate } from '../src/sim/engine'
import type { Decision, Level, Objective, Problem } from '../src/sim/types'

/**
 * JSON 을 Problem 으로 좁힌다.
 *
 * JSON 모듈은 score 를 number[] 로, line 을 number 로 읽으므로 그대로는
 * 튜플과 Level 에 맞지 않는다. 통째로 캐스팅하면 국면 데이터에 오타가
 * 있어도 조용히 통과하므로, 필드마다 명시적으로 옮기면서 검사한다.
 */
export function toProblem(p: (typeof raw)[number]): Problem {
  const level = (v: number, field: string): Level => {
    if (v !== 0 && v !== 1 && v !== 2) {
      throw new Error(`${p.id}: ${field} 는 0·1·2 중 하나여야 하는데 ${v} 다`)
    }
    return v
  }
  if (p.score.length !== 2) throw new Error(`${p.id}: score 는 두 개여야 한다`)
  if (p.objective.type !== 'SURVIVE' && p.objective.type !== 'EQUALIZE') {
    throw new Error(`${p.id}: objective.type 이 ${p.objective.type} 다`)
  }

  return {
    id: p.id,
    title: p.title,
    order: p.order,
    seed: p.seed,
    subsLeft: p.subsLeft,
    awayCount: p.awayCount,
    booked: [...p.booked],
    unavailable: [...p.unavailable],
    // JSON 은 국면마다 키가 달라 유니온으로 읽힌다. 명시적으로 좁힌다
    staminaOverrides: { ...p.staminaOverrides } as Record<string, number>,
    score: [p.score[0], p.score[1]],
    initialTactics: {
      line: level(p.initialTactics.line, 'line'),
      press: level(p.initialTactics.press, 'press'),
      width: level(p.initialTactics.width, 'width'),
    },
    objective: p.objective as Objective,
  }
}

export const problems = raw.map(toProblem)

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

function measure(base: Problem, decisions: Decision[]) {
  let pass = 0
  let home = 0
  let away = 0
  for (let s = 0; s < SEEDS; s++) {
    const r = simulate({ ...base, seed: base.seed + s }, decisions)
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

/** 27조합을 전부 돌려 순위를 낸다. 정답 경로를 손으로 적지 않아도 된다 */
function sweep(base: Problem) {
  const rows: Array<{ label: string; rate: number }> = []
  for (let l = 0; l <= 2; l++) {
    for (let p = 0; p <= 2; p++) {
      for (let w = 0; w <= 2; w++) {
        const { rate } = measure(base, set(l as Level, p as Level, w as Level))
        rows.push({ label: `${l}/${p}/${w}`, rate })
      }
    }
  }
  rows.sort((a, b) => b.rate - a.rate)
  return rows
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

console.log(`시드 ${SEEDS}개 × 국면 ${problems.length}개 × 27조합`)
console.log(`조합은 라인/압박/폭. 0=낮음·약·좁게, 1=보통·중, 2=높음·강·넓게\n`)

let allPassed = true
const winners: Array<{ title: string; top: string }> = []

for (const p of problems) {
  const noop = measure(p, [])
  const rows = sweep(p)
  const top = rows[0]
  const bottom = rows[rows.length - 1]
  const gap = top.rate - noop.rate
  const ok = noop.rate <= NOOP_MAX && gap >= GAP_MIN
  if (!ok) allPassed = false
  winners.push({ title: p.title, top: top.label })

  // 1위와 통계적으로 구분되지 않는 조합은 공동 1위로 본다
  const margin = 2 * Math.sqrt(stderr(top.rate) ** 2 + stderr(rows[1].rate) ** 2)
  const tied = rows.filter((r) => top.rate - r.rate < margin)

  console.log(`■ ${p.title}  ${ok ? '합격' : '미달'}`)
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
  console.log()
}

console.log('─'.repeat(72))
console.log(`기준: 무개입 ${pct(NOOP_MAX)} 이하 · 격차 ${pct(GAP_MIN)} 이상`)
console.log(allPassed ? '전 국면 합격' : '미달 국면 있음 — src/sim/constants.ts 를 조정한다')

// 국면마다 정답이 달라야 "판마다 다른 판단이 필요하다"가 성립한다
const distinct = new Set(winners.map((w) => w.top))
console.log(
  distinct.size === 1
    ? `주의: 전 국면의 최선 조합이 ${[...distinct][0]} 로 동일하다 — 만능 조합이 존재한다`
    : `국면별 최선 조합: ${winners.map((w) => `${w.title} ${w.top}`).join(' · ')}`,
)

if (!allPassed) process.exitCode = 1
