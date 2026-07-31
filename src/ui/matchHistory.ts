/**
 * 지난 판 기록.
 *
 * 사용자가 정했다 — 히스토리를 **브라우저에 저장**한다. 새로고침하거나
 * 내일 다시 열어도 남는다.
 *
 * **여기는 `src/sim/` 이 아니다.** 엔진은 `localStorage` 를 알면 안 되지만
 * 화면은 알아도 된다. 기록은 읽기 전용 부산물이라 경기 결과·확률·난수에
 * 닿지 않는다.
 *
 * 저장이 막힌 브라우저(사생활 보호 모드 등)에서도 게임은 그대로 돌아가야
 * 한다. 그래서 모든 접근을 감싸고, 실패하면 조용히 이번 방문에만 기억한다.
 */

export interface MatchRecord {
  /** 저장 시각(밀리초). 화면이 사람 말로 바꾼다 */
  at: number
  problemId: string
  problemTitle: string
  /** 'USA' 같은 상대 팀 id */
  opponentId: string
  opponentName: string
  half: 1 | 2
  score: [number, number]
  /** 국면의 목표를 이뤘는가 */
  passed: boolean
  /** 감독이 내린 결정 수 */
  decisions: number
  /** 150판 비교에서 방치 대비 몇 %p 였나. 없으면 null */
  delta: number | null
}

const KEY = 'saehwal.history.v1'
/** 이보다 오래된 기록은 버린다. 화면도 저장 공간도 무한하지 않다 */
const LIMIT = 50

/** 저장이 막힌 브라우저에서 쓰는 이번 방문용 기억 */
let fallback: MatchRecord[] = []

function storage(): Storage | null {
  try {
    const store = globalThis.localStorage
    if (!store) return null
    // 사생활 보호 모드는 있는 척하다가 쓸 때 던진다. 여기서 미리 확인한다
    const probe = `${KEY}.probe`
    store.setItem(probe, '1')
    store.removeItem(probe)
    return store
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is MatchRecord {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.at === 'number' &&
    typeof v.problemId === 'string' &&
    typeof v.problemTitle === 'string' &&
    typeof v.opponentName === 'string' &&
    Array.isArray(v.score) &&
    v.score.length === 2 &&
    typeof v.passed === 'boolean'
  )
}

export function readHistory(): MatchRecord[] {
  const store = storage()
  if (!store) return [...fallback]
  try {
    const raw = store.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 예전 판이나 손상된 줄이 섞여 있어도 화면이 죽지 않아야 한다
    return parsed.filter(isRecord).sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export function addRecord(record: MatchRecord): MatchRecord[] {
  const next = [record, ...readHistory()].slice(0, LIMIT)
  const store = storage()
  if (!store) {
    fallback = next
    return next
  }
  try {
    store.setItem(KEY, JSON.stringify(next))
  } catch {
    // 저장 공간이 꽉 찼거나 막혔다. 게임은 계속된다
    fallback = next
  }
  return next
}

export function clearHistory(): MatchRecord[] {
  fallback = []
  const store = storage()
  try {
    store?.removeItem(KEY)
  } catch {
    // 지우지 못해도 화면은 빈 목록을 보여준다
  }
  return []
}

/** 승률과 판수. 히스토리 머리줄이 읽는다 */
export function historySummary(records: readonly MatchRecord[]): {
  played: number
  passed: number
  rate: number
} {
  const played = records.length
  const passed = records.filter((r) => r.passed).length
  return { played, passed, rate: played === 0 ? 0 : passed / played }
}

/** `3분 전` · `어제` 처럼 읽는다 */
export function timeAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return '방금'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.round(hours / 24)
  return days === 1 ? '어제' : `${days}일 전`
}
