/** 진단용 — 커밋 전에 지운다. 국면이 시작부터 걸고 나오는 지시를 센다 */
import raw from '../src/data/problems.json' with { type: 'json' }
import { toProblem } from '../src/sim/problems'
import { initialPlayers } from '../src/sim/squad'
import { rollSetup } from '../src/sim/setup'
import type { PlayerOrder } from '../src/sim/types'

const problems = raw.map(toProblem)
const SEEDS = 1200

for (const p of problems) {
  const count = new Map<PlayerOrder, number>()
  let booked = 0
  let anyBooked = 0
  for (let s = 0; s < SEEDS; s++) {
    const base = { ...p, seed: p.seed + s }
    const rolled = rollSetup(base, initialPlayers(base))
    let b = 0
    for (const st of rolled.players) {
      if (!st.onPitch || st.out) continue
      if (st.order !== 'NONE') count.set(st.order, (count.get(st.order) ?? 0) + 1)
      if (st.booked) b++
    }
    booked += b
    if (b > 0) anyBooked++
  }
  console.log(
    `${p.title}: ` +
      [...count.entries()].map(([k, v]) => `${k} ${(v / SEEDS).toFixed(2)}명/판`).join('  ') +
      `  | 경고 ${(booked / SEEDS).toFixed(2)}명/판 (경고 보유자 있는 판 ${((anyBooked / SEEDS) * 100).toFixed(0)}%)`,
  )
}
