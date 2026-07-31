/** 진단용 — 커밋 전에 지운다. 지시별 효과를 1위 레버 위에서만 빠르게 잰다 */
import raw from '../src/data/problems.json' with { type: 'json' }
import { simulate } from '../src/sim/engine'
import { FREE_POSITION } from '../src/sim/constants'
import { abilityOf, effectivePos, initialPlayers } from '../src/sim/squad'
import { rollSetup } from '../src/sim/setup'
import { toProblem } from '../src/sim/problems'
import type { Decision, Level, PlayerOrder, PlayerState, Problem } from '../src/sim/types'

const problems = raw.map(toProblem)
const SEEDS = 1200
const stderr = (p: number) => Math.sqrt((p * (1 - p)) / SEEDS)

/** measure.ts 가 낸 1위 레버 조합 */
const TOP: Record<string, [Level, Level, Level]> = {
  p01: [2, 1, 2],
  p02: [1, 1, 2],
  p03: [1, 1, 2],
  p04: [1, 2, 2],
  p05: [2, 0, 2],
}

const set = (l: Level, p: Level, w: Level): Decision[] => [
  { tick: 0, type: 'LINE', value: l },
  { tick: 0, type: 'PRESS', value: p },
  { tick: 0, type: 'WIDTH', value: w },
]

type Pick = [string, PlayerOrder]
const free = (ps: PlayerState[]) => ps.filter((s) => s.onPitch && !s.out && s.order === 'NONE')
const byId = (a: PlayerState, b: PlayerState) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const defCount = (ps: PlayerState[]) =>
  ps.filter((s) => s.onPitch && !s.out && effectivePos(s) === 'DF').length

const PLANS: Array<{ label: string; pick: (ps: PlayerState[]) => Pick[] }> = [
  { label: '지시없음', pick: () => [] },
  {
    label: '골문앞1',
    pick: (ps) =>
      free(ps).filter((s) => effectivePos(s) === 'DF').sort(byId).slice(0, 1).map((s) => [s.id, 'HOLD']),
  },
  {
    label: '골문앞2',
    pick: (ps) =>
      free(ps).filter((s) => effectivePos(s) === 'DF').sort(byId).slice(0, 2).map((s) => [s.id, 'HOLD']),
  },
  {
    label: '내려서라',
    pick: (ps) => {
      const m = free(ps)
        .filter((s) => effectivePos(s) === 'MF')
        .sort((a, b) => abilityOf(b).speed - abilityOf(a).speed || byId(a, b))[0]
      return m ? [[m.id, 'DROP_BACK']] : []
    },
  },
  {
    label: '올라가라',
    pick: (ps) => pushUp(ps, 1),
  },
  {
    label: '물러서라',
    pick: (ps) => {
      const r = free(ps).filter((s) => s.booked).sort(byId)[0]
      return r ? [[r.id, 'BACK_OFF']] : []
    },
  },
  {
    label: '아껴뛰어라',
    pick: (ps) => {
      const t = free(ps).sort((a, b) => a.stamina - b.stamina || byId(a, b))[0]
      return t ? [[t.id, 'CONSERVE']] : []
    },
  },
  // 쌓아 걸었을 때 폭주하는지 본다
  {
    label: '내려서3',
    pick: (ps) =>
      free(ps)
        .filter((s) => effectivePos(s) === 'MF')
        .sort((a, b) => abilityOf(b).speed - abilityOf(a).speed || byId(a, b))
        .slice(0, 3)
        .map((s) => [s.id, 'DROP_BACK']),
  },
  { label: '올라가2', pick: (ps) => pushUp(ps, 2) },
  {
    label: '물러전원',
    pick: (ps) => free(ps).filter((s) => s.booked).sort(byId).map((s) => [s.id, 'BACK_OFF']),
  },
  {
    label: '아껴3',
    pick: (ps) =>
      free(ps)
        .sort((a, b) => a.stamina - b.stamina || byId(a, b))
        .slice(0, 3)
        .map((s) => [s.id, 'CONSERVE']),
  },
]

/**
 * 올려보낼 사람. 수비가 셋 남을 때까지 가장 느린 수비수부터, 그 뒤로는
 * 미드필더를 올린다. 수비수만 보면 「한 명이 없다」처럼 뒷선이 셋인 국면에서
 * 대상이 0명이라 그 줄이 통째로 안 재진다
 */
function pushUp(ps: PlayerState[], want: number): Pick[] {
  const picks: Pick[] = []
  let backs = defCount(ps)
  const defs = free(ps)
    .filter((s) => effectivePos(s) === 'DF')
    .sort((a, b) => abilityOf(a).speed - abilityOf(b).speed || byId(a, b))
  for (const s of defs) {
    if (picks.length >= want || backs <= FREE_POSITION.rules.minDefenders) break
    picks.push([s.id, 'PUSH_UP'])
    backs--
  }
  const mids = free(ps)
    .filter((s) => effectivePos(s) === 'MF')
    .sort((a, b) => abilityOf(b).finishing - abilityOf(a).finishing || byId(a, b))
  for (const s of mids) {
    if (picks.length >= want) break
    picks.push([s.id, 'PUSH_UP'])
  }
  return picks
}

function run(p: Problem, lever: Decision[], plan: (typeof PLANS)[number]) {
  let pass = 0
  let applied = 0
  let sendOff = 0
  let injury = 0
  let passWhenDown = 0
  let down = 0
  for (let s = 0; s < SEEDS; s++) {
    const base = { ...p, seed: p.seed + s }
    const picks = plan.pick(rollSetup(base, initialPlayers(base)).players)
    if (picks.length > 0) applied++
    const r = simulate(
      base,
      [...lever, ...picks.map(([target, order]) => ({ tick: 0, type: 'ORDER' as const, target, order }))],
    )
    if (r.passed) pass++
    const so = r.final.log.some((e) => e.kind === 'SEND_OFF')
    const inj = r.final.log.some((e) => e.kind === 'INJURY')
    if (so) sendOff++
    if (inj) injury++
    if (so || inj) {
      down++
      if (r.passed) passWhenDown++
    }
  }
  return {
    rate: pass / SEEDS,
    coverage: applied / SEEDS,
    sendOff: sendOff / SEEDS,
    injury: injury / SEEDS,
    downRate: down / SEEDS,
    passWhenDown: down === 0 ? 0 : passWhenDown / down,
  }
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

for (const p of problems) {
  const lever = set(...TOP[p.id])
  const rows = PLANS.map((plan) => ({ label: plan.label, ...run(p, lever, plan) }))
  const zero = rows[0]
  const floor = 2 * Math.sqrt(2) * stderr(zero.rate)
  console.log(`\n■ ${p.title}  (${TOP[p.id].join('/')})  지시없음 ${pct(zero.rate)}  바닥 ±${(floor * 100).toFixed(1)}%p`)
  console.log(
    `   퇴장 ${pct(zero.sendOff)} · 부상 ${pct(zero.injury)} · 한 명 잃은 판 ${pct(zero.downRate)} ` +
      `→ 그 판의 통과율 ${pct(zero.passWhenDown)} (온전한 판 대비 손해)`,
  )
  for (const r of rows.slice(1)) {
    const d = (r.rate - zero.rate) * 100
    console.log(
      `   ${r.label.padEnd(6)} ${(d >= 0 ? '+' : '') + d.toFixed(1)}%p` +
        `   대상 찾은 판 ${pct(r.coverage)}` +
        `   퇴장 ${pct(r.sendOff)} 부상 ${pct(r.injury)}` +
        (Math.abs(d) >= floor * 100 ? '   ★바닥 넘음' : ''),
    )
  }
}
