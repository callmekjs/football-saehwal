import lines from '../data/commentary.json'
import { getPlayer } from '../sim/squad'
import type { MatchEventLog } from '../sim/types'

type CommentaryKey = keyof typeof lines

const FALLBACK: Record<MatchEventLog['kind'], string> = {
  GOAL: '골! 우리가 넣었다.',
  CONCEDE: '실점. 상대가 넣었다.',
  CARD: '경고가 나왔다.',
  SEND_OFF: '퇴장. 한 명이 빠진다.',
  INJURY: '부상으로 선수가 빠진다.',
  PENALTY: '페널티킥 판정.',
  FOUL: '파울.',
  SUB: '교체가 끝났다.',
}

function hasKey(value: string): value is CommentaryKey {
  return value in lines
}

/**
 * 로그에 실제로 남은 원인까지만 문장에 쓴다.
 *
 * `BEHIND+OPEN_PLAY`처럼 한 틱에 여러 골이 난 경우에는 어느 문장 하나로
 * 뭉개지 않고 일반 실점 문장으로 돌아간다. 기록에 없는 방향·패스 경로를
 * 그럴듯하게 지어내지 않기 위해서다.
 */
export function commentaryKeyOf(event: MatchEventLog): CommentaryKey | null {
  const detailed = event.detail ? `${event.kind}.${event.detail}` : ''
  if (detailed && hasKey(detailed)) return detailed
  return hasKey(event.kind) ? event.kind : null
}

function playerLabel(id: string | undefined): string {
  if (!id) return '해당 선수'
  try {
    return `${getPlayer(id).num}번`
  } catch {
    return '해당 선수'
  }
}

/**
 * 같은 경기 로그는 언제 다시 열어도 같은 문장을 고른다.
 *
 * 코멘터리 때문에 난수를 하나 더 뽑으면 시뮬레이션 재현이 깨진다. 그래서
 * 이미 기록된 틱·종류·대상 문자열만으로 문장 번호를 정한다.
 */
function stableIndex(event: MatchEventLog, length: number): number {
  const source = `${event.tick}:${event.kind}:${event.target ?? ''}:${event.detail ?? ''}`
  let hash = 0
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0
  return hash % length
}

export function commentaryFor(event: MatchEventLog): string {
  const key = commentaryKeyOf(event)
  if (!key) return FALLBACK[event.kind]

  const variants = lines[key]
  const template = variants[stableIndex(event, variants.length)]
  return template
    .replaceAll('{target}', playerLabel(event.target))
    .replaceAll('{out}', playerLabel(event.kind === 'SUB' ? event.detail : undefined))
}
