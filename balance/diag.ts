import { simulate } from '../src/sim/engine'
import type { Decision, Level, Problem } from '../src/sim/types'

const P: Problem = {
  id: 'p02',
  title: '잠긴 문',
  order: 1,
  score: [1, 0],
  initialTactics: { line: 0, press: 0, width: 0 },
  homeCount: 11,
  awayCount: 11,
  seed: 40712,
  objective: { type: 'SURVIVE', bonusOnWin: false },
  minDefenderSpeed: 62,
  startStamina: { DF04: 62, MF06: 48, FW09: 71 },
}

const N = 1000

function measure(decisions: Decision[]) {
  let pass = 0
  let home = 0
  let away = 0
  for (let s = 0; s < N; s++) {
    const r = simulate({ ...P, seed: 40000 + s }, decisions)
    if (r.passed) pass++
    home += r.final.score[0] - P.score[0]
    away += r.final.score[1] - P.score[1]
  }
  return { rate: pass / N, home: home / N, away: away / N }
}

const set = (line: Level, press: Level, width: Level): Decision[] => [
  { tick: 0, type: 'LINE', value: line },
  { tick: 0, type: 'PRESS', value: press },
  { tick: 0, type: 'WIDTH', value: width },
]

console.log('설정                  통과율    우리득점   실점')
console.log('─'.repeat(48))
const noop = measure([])
console.log(`무개입 0/0/0        ${(noop.rate * 100).toFixed(1).padStart(6)}%  ${noop.home.toFixed(3).padStart(7)}  ${noop.away.toFixed(3).padStart(6)}`)

const results: Array<{ label: string; rate: number; home: number; away: number }> = []
for (let l = 0; l <= 2; l++) {
  for (let p = 0; p <= 2; p++) {
    for (let w = 0; w <= 2; w++) {
      const m = measure(set(l as Level, p as Level, w as Level))
      results.push({ label: `${l}/${p}/${w}`, ...m })
    }
  }
}
results.sort((a, b) => b.rate - a.rate)

console.log('─'.repeat(48))
console.log('27조합 상위 5')
for (const r of results.slice(0, 5)) {
  console.log(`  ${r.label}             ${(r.rate * 100).toFixed(1).padStart(6)}%  ${r.home.toFixed(3).padStart(7)}  ${r.away.toFixed(3).padStart(6)}`)
}
console.log('27조합 하위 3')
for (const r of results.slice(-3)) {
  console.log(`  ${r.label}             ${(r.rate * 100).toFixed(1).padStart(6)}%  ${r.home.toFixed(3).padStart(7)}  ${r.away.toFixed(3).padStart(6)}`)
}

const best = results[0]
console.log('─'.repeat(48))
console.log(`무개입          ${(noop.rate * 100).toFixed(1)}%`)
console.log(`최선 (${best.label})    ${(best.rate * 100).toFixed(1)}%`)
console.log(`격차            ${((best.rate - noop.rate) * 100).toFixed(1)}%p   ${best.rate - noop.rate >= 0.2 ? '합격' : '미달'}`)
console.log(`스프레드        ${((best.rate - results[results.length - 1].rate) * 100).toFixed(1)}%p`)
