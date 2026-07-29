import raw from '../data/problems.json' with { type: 'json' }
import type { FormationId } from './formations'
import type { Level, Objective, PlayerOrder, Problem, Variation } from './types'

/**
 * 국면 데이터를 읽는 **단 하나의 자리.**
 *
 * 전에는 화면(`App.tsx`)·검증 하네스(`balance/measure.ts`)·테스트가 각자
 * 같은 파싱을 베껴 쓰고 있었다. 세 벌이 갈리면 화면과 검증이 서로 다른
 * 국면을 돌리게 되는데, 그 차이는 숫자로만 드러나고 눈에는 안 보인다.
 * 실제로 한 벌에 `initialTactics` 가 빠져 있어 전혀 다른 경기가 돌았다.
 *
 * **새 국면을 넣을 때 이 파일을 고칠 일이 없어야 한다.** 국면은 JSON
 * 한 덩어리이고 여기는 그것을 타입으로 좁히기만 한다.
 */

function levelOf(id: string, where: string, v: number): Level {
  if (v !== 0 && v !== 1 && v !== 2) throw new Error(`${id}: ${where} 레버 값이 0·1·2가 아니다 (${v})`)
  return v
}

function levelsOf(id: string, where: string, v: number[] | undefined): Level[] | undefined {
  if (!v) return undefined
  return v.map((x) => levelOf(id, where, x))
}

function variationOf(id: string, v: unknown): Variation | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const range = o.staminaRange as number[] | undefined
  const booked = o.booked as number[] | undefined
  const orders = o.orders as number[] | undefined
  const t = o.tactics as Record<string, number[]> | undefined
  return {
    staminaSpread: o.staminaSpread as number | undefined,
    staminaRange: range ? [range[0], range[1]] : undefined,
    booked: booked ? [booked[0], booked[1]] : undefined,
    orders: orders ? [orders[0], orders[1]] : undefined,
    orderKinds: o.orderKinds as PlayerOrder[] | undefined,
    tactics: t
      ? {
          line: levelsOf(id, 'variation.line', t.line),
          press: levelsOf(id, 'variation.press', t.press),
          width: levelsOf(id, 'variation.width', t.width),
        }
      : undefined,
    away: awayOf(o.away),
  }
}

/** 이번 판에 만날 상대를 흔드는 띠. 안 적으면 상대는 늘 같은 팀이다 */
function awayOf(v: unknown): Variation['away'] {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const booked = o.booked as number[] | undefined
  const stamina = o.stamina as number[] | undefined
  return {
    booked: booked ? [booked[0], booked[1]] : undefined,
    stamina: stamina ? [stamina[0], stamina[1]] : undefined,
    injuryChance: o.injuryChance as number | undefined,
  }
}

export function toProblem(p: (typeof raw)[number]): Problem {
  return {
    id: p.id,
    title: p.title,
    order: p.order,
    summary: p.summary,
    seed: p.seed,
    subsLeft: p.subsLeft,
    awayCount: p.awayCount,
    booked: [...p.booked],
    unavailable: [...p.unavailable],
    // JSON 은 국면마다 키가 달라 유니온으로 읽힌다. 명시적으로 좁힌다
    staminaOverrides: { ...p.staminaOverrides } as Record<string, number>,
    initialFormation: p.initialFormation as FormationId,
    score: [p.score[0], p.score[1]],
    initialTactics: {
      line: levelOf(p.id, 'line', p.initialTactics.line),
      press: levelOf(p.id, 'press', p.initialTactics.press),
      width: levelOf(p.id, 'width', p.initialTactics.width),
    },
    recommendation: {
      formation: p.recommendation.formation as FormationId,
      tactics: {
        line: levelOf(p.id, 'recommendation.line', p.recommendation.tactics.line),
        press: levelOf(p.id, 'recommendation.press', p.recommendation.tactics.press),
        width: levelOf(p.id, 'recommendation.width', p.recommendation.tactics.width),
      },
      explanation: p.recommendation.explanation,
    },
    objective: p.objective as Objective,
    variation: variationOf(p.id, (p as { variation?: unknown }).variation),
  }
}

/** 난이도 사다리 순서로 정렬된 전체 국면 */
export const PROBLEMS: Problem[] = raw.map(toProblem).sort((a, b) => a.order - b.order)

export function problemById(id: string): Problem {
  const p = PROBLEMS.find((x) => x.id === id)
  if (!p) throw new Error(`없는 국면: ${id}`)
  return p
}
