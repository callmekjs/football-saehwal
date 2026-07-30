/**
 * 임시 측정 스크립트 — 상대 팀 13종의 **화면에서 보이는** 차이를 잰다.
 * 다 쓰고 반드시 지운다.
 */
import raw from '../src/data/problems.json' with { type: 'json' }
import { createState, tick } from '../src/sim/engine'
import { createRng } from '../src/sim/rng'
import { toProblem } from '../src/sim/problems'
import { OPPONENTS, TOTAL_TICKS } from '../src/sim/constants'
import { VisualMatch } from '../src/render/visual'
import type { OpponentId, Problem } from '../src/sim/types'

const problems = raw.map(toProblem)
const TEAMS = OPPONENTS.teams.map((t) => t.id) as OpponentId[]
const SEED_COUNT = Number(process.argv.find((a) => a.startsWith('--seeds='))?.split('=')[1] ?? 4)

/** 한 경기에서 뽑아내는 화면 지표 */
type MatchStat = {
  key: string
  passDist: number
  passN: number
  homePassN: number
  avgX: number
  defX: number
  ySd: number
  pressMed: number
  shotN: number
  shotDist: number
  homeShotN: number
  possPct: number
  possOfHeld: number
  simAwayShot: number
  simHomeShot: number
  gf: number
  ga: number
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function mean(xs: number[]): number {
  const ok = xs.filter((x) => Number.isFinite(x))
  return ok.reduce((a, b) => a + b, 0) / ok.length
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}

/** 점수가 아직 안 바뀐 구간만 잴 것인가 (팀 효과와 득점 파급을 분리한다) */
const PRESCORE = process.argv.includes('--prescore')

function run(problem: Problem, team: OpponentId, key: string): MatchStat {
  const rng = createRng(problem.seed)
  let s = createState(problem, team)
  const vm = new VisualMatch(s, problem.seed)
  let lastKick = ''

  const awayPassDists: number[] = []
  const awayShotDists: number[] = []
  const nearest: number[] = []
  let homePassN = 0
  let homeShotN = 0
  let awayXSum = 0
  let awayXFrames = 0
  let defXSum = 0
  let defXFrames = 0
  let ySdSum = 0
  let awayHold = 0
  let homeHold = 0
  let frames = 0

  for (let i = 0; i < TOTAL_TICKS; i++) {
    s = tick(s, rng)
    vm.sync(s)
    if (PRESCORE && (s.score[0] !== problem.score[0] || s.score[1] !== problem.score[1])) break
    for (let f = 0; f < 6; f++) {
      vm.advance(s, 1 / 60)
      const b = vm.ball

      const sig = `${b.kickerId}|${b.fromX.toFixed(3)}|${b.fromY.toFixed(3)}|${b.toX.toFixed(3)}|${b.toY.toFixed(3)}|${b.kick}`
      if (sig !== lastKick) {
        lastKick = sig
        const kicker = b.kickerId ? vm.players.find((p) => p.id === b.kickerId) : undefined
        if (kicker) {
          const d = Math.hypot(b.toX - b.fromX, b.toY - b.fromY)
          if (b.kick === 'PASS') {
            if (kicker.side === 'AWAY') awayPassDists.push(d)
            else homePassN++
          } else if (b.kick === 'SHOT') {
            // 상대는 x=0 골문을 공격한다
            if (kicker.side === 'AWAY') awayShotDists.push(Math.hypot(b.fromX, b.fromY - 34))
            else homeShotN++
          }
        }
      }

      let axSum = 0
      let axN = 0
      let dxSum = 0
      let dxN = 0
      const ys: number[] = []
      let holder: (typeof vm.players)[number] | undefined
      for (const p of vm.players) {
        if (p.id === b.holder) holder = p
        if (p.side !== 'AWAY' || p.pos === 'GK') continue
        axSum += p.x
        axN++
        ys.push(p.y)
        if (p.pos === 'DF') {
          dxSum += p.x
          dxN++
        }
      }
      if (axN > 0) {
        awayXSum += axSum / axN
        awayXFrames++
        ySdSum += sd(ys)
      }
      if (dxN > 0) {
        defXSum += dxSum / dxN
        defXFrames++
      }

      frames++
      if (b.mode === 'HELD' && holder) {
        if (holder.side === 'AWAY') awayHold++
        else {
          homeHold++
          let near = Infinity
          for (const o of vm.players) {
            if (o.side !== 'AWAY' || o.pos === 'GK') continue
            const d = Math.hypot(o.x - holder.x, o.y - holder.y)
            if (d < near) near = d
          }
          if (Number.isFinite(near)) nearest.push(near)
        }
      }
    }
  }

  return {
    key,
    passDist: mean(awayPassDists),
    passN: awayPassDists.length,
    homePassN,
    avgX: awayXSum / awayXFrames,
    defX: defXSum / defXFrames,
    ySd: ySdSum / awayXFrames,
    pressMed: median(nearest),
    shotN: awayShotDists.length,
    shotDist: mean(awayShotDists),
    homeShotN,
    possPct: (awayHold / frames) * 100,
    possOfHeld: (awayHold / (awayHold + homeHold)) * 100,
    simAwayShot: s.stats.awayShot,
    simHomeShot: s.stats.homeShot,
    gf: s.score[0],
    ga: s.score[1],
  }
}

const out: Record<string, MatchStat[]> = {}
const t0 = Date.now()
for (const team of TEAMS) {
  const rows: MatchStat[] = []
  for (const base of problems) {
    for (let i = 0; i < SEED_COUNT; i++) {
      rows.push(run({ ...base, seed: base.seed + i }, team, `${base.id}#${i}`))
    }
  }
  out[team] = rows
  console.error(`${team} 완료 (${((Date.now() - t0) / 1000).toFixed(0)}초, ${rows.length}판)`)
}

console.log(JSON.stringify(out))
