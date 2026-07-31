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

import type { RecordCompare, RecordSetup } from '../analysis/history'

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
  /**
   * 아래 셋은 **옛 기록에 없다.**
   *
   * 이 칸들이 생기기 전에 저장된 줄이 브라우저에 그대로 남아 있고, 그것도
   * 진짜 기록이므로 버리지 않는다. 그래서 전부 선택 항목이고, 화면은 값이
   * 있는 줄만 골라 쓴다. 없는 줄에 0을 채워 그리면 있지도 않은 경기를
   * 그리는 것이 된다.
   */
  /** 경기가 끝난 시점의 우리 설정 */
  setup?: RecordSetup
  /** 그 국면의 검증된 권장 설정 */
  recommended?: RecordSetup
  /** 무개입·나의 판단·권장 전술 150판 비교. 분석이 끝나야 채워진다 */
  compare?: RecordCompare
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

/**
 * 같은 판이면 덮어쓰고 아니면 새로 담는다.
 *
 * 한 경기가 **두 번에 나눠 저장된다.** 경기가 끝나는 순간 한 번(그때는
 * 150판 비교가 아직 안 끝나 `delta` 가 없다), 분석이 끝난 뒤 한 번이다.
 * 둘을 따로 담으면 목록에 같은 판이 두 줄로 남고, 두 번째를 버리면
 * `±%p` 가 영영 안 채워진다.
 *
 * 그래서 같은 판이면 **처음 저장한 시각은 지키고 값만 갱신한다.** 목록의
 * 순서가 분석이 끝나는 시점에 따라 흔들리지 않아야 하기 때문이다.
 */
export function upsertRecord(
  record: MatchRecord,
  isSame: (candidate: MatchRecord, existing: MatchRecord) => boolean,
): MatchRecord[] {
  const current = readHistory()
  const at = current.findIndex((prev) => isSame(record, prev))
  if (at === -1) return addRecord(record)

  const next = [...current]
  next[at] = { ...record, at: current[at].at }
  const store = storage()
  if (!store) {
    fallback = next
    return next
  }
  try {
    store.setItem(KEY, JSON.stringify(next))
  } catch {
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
