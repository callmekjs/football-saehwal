/**
 * 지난 판이 쌓이면 무엇이 보이는가 — `04 · 분석·기록` 화면의 계산.
 *
 * 사용자가 정했다 — *"경기 후 사람들이 이해할 수 있게 그래프와 글을 통해서
 * 어떻게 해야 더 좋은 전술을 짤 수 있는지 알려줘야 해."*
 *
 * 그래서 이 파일이 만드는 것은 성적표가 아니라 **다음 판에 쓸 문장**이다.
 * 잘했다·못했다가 아니라 "이 국면에서는 라인을 낮추면 세트피스를 더 맞는다,
 * 그래서 낮음이 아니라 보통" 수준까지 내려가야 값을 한다.
 *
 * ## 지키는 것
 *
 * ★ **읽기만 한다.** 경기 결과·확률·난수에 닿지 않는다. 이미 끝난 경기가
 *   남긴 기록을 다시 읽을 뿐이다.
 * ★ **기록에 없는 것을 지어내지 않는다.** 옛 기록에는 여기서 쓰는 칸이
 *   통째로 없다(그때는 저장하지 않았다). 그런 줄은 조용히 건너뛰고, 쓸 줄이
 *   하나도 없으면 `null` 을 돌려준다. 화면은 없는 것을 그리지 않는다.
 * ★ **순수 함수다.** `Date` 도 `localStorage` 도 `Math.random` 도 모른다.
 *   같은 기록에는 언제나 같은 문장이 나온다.
 *
 * ## 왜 세 갈래인가
 *
 * `compare.ts` 가 **같은 150개의 시드**를 무개입·나의 판단·권장 전술에
 * 똑같이 먹인다. 셋의 운이 같으므로 달라지는 것은 판단뿐이고, 그래서 세
 * 막대를 나란히 놓는 것이 "내 판단이 무엇을 바꿨고 권장안은 무엇을 더
 * 했는가"의 유일한 정직한 그림이다. 두 갈래(무개입·나)만 보이면 사용자는
 * **얼마나 남았는지**를 영영 알 수 없다.
 */
import type { FormationId } from '../sim/formations'
import type { Level } from '../sim/types'
import { withJosa } from './josa'

/** 국면이 요구하는 것. `Problem.objective.type` 과 같은 값이다 */
export type Goal = 'SURVIVE' | 'EQUALIZE'

const LEVEL_LABEL: Record<'line' | 'press' | 'width', Record<Level, string>> = {
  line: { 0: '낮음', 1: '보통', 2: '높음' },
  press: { 0: '약', 1: '중', 2: '강' },
  width: { 0: '좁게', 1: '보통', 2: '넓게' },
}

/** 경기가 끝난 시점의 우리 설정. 기록 한 줄에 함께 남는다 */
export interface RecordSetup {
  formation: FormationId
  line: Level
  press: Level
  width: Level
}

/**
 * 150판 평균 한 갈래.
 *
 * `OutcomeProfile` 에서 **화면이 실제로 읽는 여섯 칸만** 추린 것이다.
 * 기록은 브라우저에 쉰 줄까지 남으므로 안 쓰는 칸까지 담지 않는다.
 */
export interface RecordProfile {
  goalsFor: number
  goalsAgainst: number
  homeShot: number
  awayShot: number
  setPiece: number
  behind: number
}

/** 같은 150 시드를 세 갈래에 똑같이 먹인 결과 */
export interface RecordCompare {
  rates: { noop: number; user: number; recommendation: number }
  noop: RecordProfile
  user: RecordProfile
  recommendation: RecordProfile
}

/**
 * 기록 한 줄에서 이 파일이 읽는 부분.
 *
 * `MatchRecord` 가 이 모양을 **구조적으로** 만족한다. 여기서 `src/ui` 를
 * 직접 import 하면 분석이 화면에 매달리므로 모양만 적어 둔다.
 */
export interface HistoryEntry {
  at: number
  problemId: string
  problemTitle: string
  opponentName: string
  passed: boolean
  decisions: number
  delta: number | null
  setup?: RecordSetup
  recommended?: RecordSetup
  compare?: RecordCompare
}

/** `AnalysisRow` 가 이 모양을 구조적으로 만족한다 */
interface ComparableRow {
  key: 'noop' | 'user' | 'recommendation'
  rate: number
  profile: RecordProfile
}

/**
 * 150판 비교 결과를 기록에 담을 만큼만 추린다.
 *
 * `OutcomeProfile` 에는 여기서 안 쓰는 칸도 있다. 기록은 쉰 줄까지 쌓이므로
 * 화면이 실제로 그리는 여섯 칸만 남긴다.
 */
export function toRecordCompare(rows: readonly ComparableRow[]): RecordCompare | null {
  const pick = (key: ComparableRow['key']) => rows.find((row) => row.key === key)
  const noop = pick('noop')
  const user = pick('user')
  const recommendation = pick('recommendation')
  if (!noop || !user || !recommendation) return null

  const slim = (profile: RecordProfile): RecordProfile => ({
    goalsFor: profile.goalsFor,
    goalsAgainst: profile.goalsAgainst,
    homeShot: profile.homeShot,
    awayShot: profile.awayShot,
    setPiece: profile.setPiece,
    behind: profile.behind,
  })

  return {
    rates: {
      noop: noop.rate,
      user: user.rate,
      recommendation: recommendation.rate,
    },
    noop: slim(noop.profile),
    user: slim(user.profile),
    recommendation: slim(recommendation.profile),
  }
}

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`
const point = (rate: number) => `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(1)}%p`
const abs = (rate: number) => `${(Math.abs(rate) * 100).toFixed(1)}%p`

/** 성공 가능성이 "사실상 같다"고 볼 폭. `verdict()` 와 같은 기준을 쓴다 */
const SAME_RATE = 0.04

export function setupText(setup: RecordSetup): string {
  return `${setup.formation} · 라인 ${LEVEL_LABEL.line[setup.line]} · 압박 ${
    LEVEL_LABEL.press[setup.press]
  } · 폭 ${LEVEL_LABEL.width[setup.width]}`
}

/* ------------------------------------------------------------------ *
 * 1. 가장 최근 판 — 세 갈래 비교
 * ------------------------------------------------------------------ */

export interface LessonRow {
  key: string
  label: string
  /** 이 값은 낮을수록 좋은가 */
  lowerIsBetter: boolean
  noop: number
  user: number
  recommendation: number
  /** 소수 몇 자리로 읽는가. 골은 두 자리, 횟수는 한 자리다 */
  digits: number
  /** 막대 하나를 사람 말로 옮긴 한 줄 */
  note: string
}

/** 내 설정과 권장 설정이 갈린 항목 하나 */
export interface SetupGap {
  label: string
  mine: string
  recommended: string
}

export interface Lesson {
  at: number
  problemTitle: string
  opponentName: string
  passed: boolean
  goal: Goal
  rates: { noop: number; user: number; recommendation: number }
  rows: LessonRow[]
  /** 권장안이 내 판단보다 몇 만큼 높았나. 음수면 내가 더 나았다 */
  headroom: number
  headline: string
  /** 그래프를 설명하는 글. 순서대로 읽는다 */
  paragraphs: string[]
  gaps: SetupGap[]
  mine: RecordSetup | null
  recommended: RecordSetup | null
}

function digitsOf(value: number, digits: number): string {
  return value.toFixed(digits)
}

/**
 * 국면이 요구하는 것에 따라 볼 칸이 다르다.
 *
 * 쫓는 국면에서 "상대 슈팅이 줄었다"는 위로가 되지 않고, 지키는 국면에서
 * "우리 슈팅이 늘었다"는 목표와 무관하다. 다만 **반대쪽을 한 줄은 남긴다**
 * — 쫓다가 더 내주면 따라잡아도 소용이 없기 때문이다.
 */
function rowsOf(compare: RecordCompare, goal: Goal): LessonRow[] {
  const spec: ReadonlyArray<{
    key: keyof RecordProfile
    label: string
    lower: boolean
    digits: number
  }> =
    goal === 'EQUALIZE'
      ? [
          { key: 'goalsFor', label: '평균 득점', lower: false, digits: 2 },
          { key: 'homeShot', label: '우리 슈팅', lower: false, digits: 1 },
          { key: 'goalsAgainst', label: '평균 실점', lower: true, digits: 2 },
          { key: 'behind', label: '배후 침투 허용', lower: true, digits: 1 },
        ]
      : [
          { key: 'goalsAgainst', label: '평균 실점', lower: true, digits: 2 },
          { key: 'awayShot', label: '상대 슈팅', lower: true, digits: 1 },
          { key: 'setPiece', label: '세트피스 위험', lower: true, digits: 1 },
          { key: 'behind', label: '배후 침투 허용', lower: true, digits: 1 },
        ]

  return spec.map((item) => {
    const noop = compare.noop[item.key]
    const user = compare.user[item.key]
    const recommendation = compare.recommendation[item.key]
    // 양수면 권장안이 낫다는 뜻이 되도록 방향을 맞춘다
    const gain = item.lower ? user - recommendation : recommendation - user
    const near = Math.max(0.02, 0.05 * Math.max(noop, user, recommendation))
    const verb = item.lower ? '낮춥니다' : '올립니다'

    const note =
      Math.abs(gain) < near
        ? `이 항목은 권장 전술과 거의 같았습니다(${digitsOf(user, item.digits)} 대 ${digitsOf(
            recommendation,
            item.digits,
          )}).`
        : gain > 0
          ? `권장 전술은 이 값을 ${digitsOf(recommendation, item.digits)}까지 ${verb}. 당신은 ${digitsOf(
              user,
              item.digits,
            )}에 머물렀고, 그 차이가 남은 몫입니다.`
          : `이 항목은 당신이 권장 전술보다 좋았습니다(${digitsOf(
              user,
              item.digits,
            )} 대 ${digitsOf(recommendation, item.digits)}).`

    return {
      key: item.key,
      label: item.label,
      lowerIsBetter: item.lower,
      noop,
      user,
      recommendation,
      digits: item.digits,
      note,
    }
  })
}

/** 내 설정과 권장 설정이 어디서 갈렸나 */
export function setupGaps(mine: RecordSetup, recommended: RecordSetup): SetupGap[] {
  const gaps: SetupGap[] = []
  if (mine.formation !== recommended.formation) {
    gaps.push({ label: '대형', mine: mine.formation, recommended: recommended.formation })
  }
  for (const key of ['line', 'press', 'width'] as const) {
    if (mine[key] !== recommended[key]) {
      gaps.push({
        label: key === 'line' ? '라인' : key === 'press' ? '압박' : '폭',
        mine: LEVEL_LABEL[key][mine[key]],
        recommended: LEVEL_LABEL[key][recommended[key]],
      })
    }
  }
  return gaps
}

/**
 * 가장 최근에 끝난 판 하나를 그래프와 글로 편다.
 *
 * 150판 비교가 끝나기 전에 화면을 떠난 판에는 `compare` 가 없다. 그런 줄은
 * 건너뛰고 **비교가 완성된 가장 최근 판**을 찾는다. 하나도 없으면 `null` 이다.
 */
export function lastLesson(
  records: readonly HistoryEntry[],
  goalOf: (problemId: string) => Goal | undefined,
): Lesson | null {
  const found = [...records]
    .sort((a, b) => b.at - a.at)
    .find((record) => record.compare !== undefined)
  if (!found?.compare) return null

  const goal = goalOf(found.problemId) ?? 'SURVIVE'
  const compare = found.compare
  const rows = rowsOf(compare, goal)
  const headroom = compare.rates.recommendation - compare.rates.user
  const userDelta = compare.rates.user - compare.rates.noop

  const headline =
    headroom >= SAME_RATE
      ? `권장 전술이 ${abs(headroom)} 더 높았습니다`
      : headroom <= -SAME_RATE
        ? `검증된 권장 전술보다 좋았습니다`
        : `권장 전술과 거의 같은 수준이었습니다`

  const paragraphs: string[] = [
    '회색은 앞 감독의 지시를 그대로 뒀을 때, 초록은 당신이 실제로 만든 설정, ' +
      '노랑은 같은 국면을 1,200판 검증해 고른 권장 설정입니다. 셋 다 똑같은 150경기를 ' +
      '돌렸기 때문에 달라진 것은 운이 아니라 판단뿐입니다.',
  ]

  paragraphs.push(
    userDelta >= SAME_RATE
      ? `당신의 판단은 방치보다 ${abs(userDelta)} 높았습니다(${percent(
          compare.rates.noop,
        )} → ${percent(compare.rates.user)}). 손을 댄 것 자체는 옳았습니다.`
      : userDelta <= -SAME_RATE
        ? `당신의 판단은 방치보다 ${abs(userDelta)} 낮았습니다(${percent(
            compare.rates.noop,
          )} → ${percent(compare.rates.user)}). 바꾼 방향이 이 국면과 맞지 않았습니다.`
        : `당신의 판단과 방치는 성공 가능성이 거의 같았습니다(${percent(
            compare.rates.noop,
          )} 대 ${percent(compare.rates.user)}). 바꾸긴 했지만 결과 분포는 움직이지 않았습니다.`,
  )

  // 어느 칸에서 가장 많이 뒤졌나. 단위가 서로 달라 비율로 견준다
  const behind = rows
    .map((row) => {
      const gain = row.lowerIsBetter
        ? row.user - row.recommendation
        : row.recommendation - row.user
      const scale = Math.max(row.user, row.recommendation, 0.01)
      return { row, gain, ratio: gain / scale }
    })
    .filter((item) => item.gain > 0)
    .sort((a, b) => b.ratio - a.ratio)[0]

  if (headroom >= SAME_RATE) {
    paragraphs.push(
      behind
        ? `권장 설정으로 뒀다면 ${percent(compare.rates.recommendation)}였습니다. 가장 크게 갈린 곳은 ` +
          `${withJosa(behind.row.label, '이가')} ${digitsOf(
            behind.row.user,
            behind.row.digits,
          )}에서 ${withJosa(digitsOf(behind.row.recommendation, behind.row.digits), '로으로')} ` +
          `${behind.row.lowerIsBetter ? '줄어드는' : '늘어나는'} 부분입니다.`
        : `권장 설정으로 뒀다면 ${percent(compare.rates.recommendation)}였습니다.`,
    )
  } else if (headroom <= -SAME_RATE) {
    paragraphs.push(
      `이 판은 권장 설정보다 좋았습니다(${percent(compare.rates.user)} 대 ${percent(
        compare.rates.recommendation,
      )}). 권장안은 평균적으로 안전한 답이지 유일한 답이 아닙니다. 같은 국면을 다시 만나면 이 설정을 그대로 쓰세요.`,
    )
  } else {
    paragraphs.push(
      `권장 설정과 성공 가능성이 사실상 같았습니다(${percent(
        compare.rates.user,
      )} 대 ${percent(compare.rates.recommendation)}). 이 판에서 설정으로 더 짜낼 몫은 거의 없었습니다.`,
    )
  }

  const mine = found.setup ?? null
  const recommended = found.recommended ?? null
  const gaps = mine && recommended ? setupGaps(mine, recommended) : []

  if (mine && recommended) {
    paragraphs.push(
      gaps.length > 0
        ? `다음에 같은 국면을 만나면 ${gaps
            .map((gap) => `${gap.label} ${gap.mine} → ${gap.recommended}`)
            .join(', ')}부터 맞추고 시작하세요.`
        : '설정은 종료 시점에 권장안과 같았습니다. 남은 차이는 무엇을 골랐는가가 아니라 ' +
          '언제 맞췄는가에서 옵니다. 다음에는 킥오프 직후에 네 가지를 한꺼번에 거세요.',
    )
  }

  return {
    at: found.at,
    problemTitle: found.problemTitle,
    opponentName: found.opponentName,
    passed: found.passed,
    goal,
    rates: compare.rates,
    rows,
    headroom,
    headline,
    paragraphs,
    gaps,
    mine,
    recommended,
  }
}

/* ------------------------------------------------------------------ *
 * 2. 여러 판에 걸친 버릇 — 어떤 레버를 계속 틀리는가
 * ------------------------------------------------------------------ */

export type LeverKey = 'formation' | 'line' | 'press' | 'width'

export interface LeverHabit {
  key: LeverKey
  label: string
  /** 설정이 남아 있는 판 수 */
  total: number
  matched: number
  /** 권장보다 낮게·약하게·좁게 둔 판 */
  lower: number
  /** 권장보다 높게·세게·넓게 둔 판 */
  higher: number
  /** 어긋난 쪽이 한쪽으로 몰렸는가 */
  lean: 'LOWER' | 'HIGHER' | 'MATCHED' | 'MIXED'
  note: string
}

/**
 * 레버마다의 대가. **이 저장소가 실측으로 확립한 것만 적는다.**
 *
 * 라인 낮음의 세트피스 승수와 폭의 수비 쪽 대가는 `AGENTS.md` 가 "건드리면
 * 무너지는 것"으로 지목한 설계 축이다. 여기 문장은 그 축을 사람 말로 옮긴
 * 것이지 새로 지어낸 인과가 아니다.
 */
const LEVER_LESSON: Record<
  Exclude<LeverKey, 'formation'>,
  { word: string; lower: string; higher: string; direction: [string, string] }
> = {
  line: {
    word: '라인',
    lower:
      '깊이 내려서면 뒷공간은 줄지만 세트피스 위험이 그보다 크게 늘어납니다. 잠글수록 오히려 더 맞는 국면이 있습니다.',
    higher:
      '라인을 올리면 앞으로 나가기는 쉬워지지만 수비 뒷공간을 그만큼 내줍니다. 가장 느린 수비수가 그대로 표적이 됩니다.',
    direction: ['낮게', '높게'],
  },
  press: {
    word: '압박',
    lower:
      '약하게 누르면 반칙과 체력 소모는 줄지만 상대가 편하게 전개합니다.',
    higher:
      '세게 누르면 공은 빨리 되찾지만 반칙이 늘어 경고와 페널티가 따라옵니다. 경고가 쌓인 국면에서는 특히 비쌉니다.',
    direction: ['약하게', '세게'],
  },
  width: {
    word: '폭',
    lower: '좁히면 중앙은 단단해지지만 빠져나갈 길이 사라집니다.',
    higher:
      '벌리면 공격할 길이 늘어나는 대신 중앙이 열립니다. 넓게가 공짜인 국면은 없습니다.',
    direction: ['좁게', '넓게'],
  },
}

function leanOf(matched: number, lower: number, higher: number): LeverHabit['lean'] {
  if (matched >= lower + higher) return 'MATCHED'
  if (lower > higher) return 'LOWER'
  if (higher > lower) return 'HIGHER'
  return 'MIXED'
}

/**
 * 설정이 남은 판을 모아 레버별 버릇을 센다.
 *
 * 한 판만으로는 버릇이 아니라 그날의 선택이다. 그래서 화면은 두 판부터
 * 이 표를 편다(`minimum`).
 */
export function leverHabits(
  records: readonly HistoryEntry[],
  minimum = 2,
): LeverHabit[] {
  const usable = records.filter(
    (record): record is HistoryEntry & { setup: RecordSetup; recommended: RecordSetup } =>
      record.setup !== undefined && record.recommended !== undefined,
  )
  if (usable.length < minimum) return []

  const habits: LeverHabit[] = []

  const formationMatched = usable.filter(
    (record) => record.setup.formation === record.recommended.formation,
  ).length
  habits.push({
    key: 'formation',
    label: '대형',
    total: usable.length,
    matched: formationMatched,
    lower: 0,
    higher: usable.length - formationMatched,
    lean: formationMatched >= usable.length - formationMatched ? 'MATCHED' : 'HIGHER',
    note:
      formationMatched === usable.length
        ? `권장 대형으로 끝낸 판이 ${usable.length}판 모두입니다. 틀은 잘 잡고 있습니다.`
        : `권장과 다른 대형으로 끝낸 판이 ${usable.length - formationMatched}번입니다. ` +
          '대형은 라인·압박·폭보다 먼저 정해지는 틀이라, 여기가 어긋나면 나머지 셋을 맞춰도 되돌리기 어렵습니다.',
  })

  for (const key of ['line', 'press', 'width'] as const) {
    let matched = 0
    let lower = 0
    let higher = 0
    for (const record of usable) {
      const mine = record.setup[key]
      const want = record.recommended[key]
      if (mine === want) matched += 1
      else if (mine < want) lower += 1
      else higher += 1
    }
    const lean = leanOf(matched, lower, higher)
    const lesson = LEVER_LESSON[key]
    const note =
      lean === 'MATCHED'
        ? `${usable.length}판 중 ${matched}판에서 국면이 요구한 값에 맞췄습니다.`
        : lean === 'LOWER'
          ? `${withJosa(lesson.word, '을를')} 권장보다 ${lesson.direction[0]} 둔 판이 ${lower}번입니다. ${lesson.lower}`
          : lean === 'HIGHER'
            ? `${withJosa(lesson.word, '을를')} 권장보다 ${lesson.direction[1]} 둔 판이 ${higher}번입니다. ${lesson.higher}`
            : `${withJosa(lesson.word, '이가')} 판마다 양쪽으로 흔들립니다. 국면이 무엇을 요구하는지 먼저 읽고 거세요.`

    habits.push({
      key,
      label: lesson.word,
      total: usable.length,
      matched,
      lower,
      higher,
      lean,
      note,
    })
  }

  return habits
}

/* ------------------------------------------------------------------ *
 * 3. 판단이 나아지고 있나
 * ------------------------------------------------------------------ */

export interface TrendPoint {
  at: number
  delta: number
  passed: boolean
  problemTitle: string
  opponentName: string
}

export interface Trend {
  /** 오래된 판 → 최근 판 */
  points: TrendPoint[]
  mean: number
  /** 앞 절반 평균 대비 뒤 절반 평균. 점이 넷 미만이면 `null` */
  shift: number | null
  note: string
}

/** 그래프에 세우는 판 수 상한. 이보다 오래된 것은 최근 흐름이 아니다 */
const TREND_LIMIT = 12

/**
 * 방치 대비 차이(`±%p`)의 흐름.
 *
 * **승패가 아니라 판단의 값을 세운다.** 한 판의 승패에는 운이 절반쯤
 * 섞이지만 `±%p` 는 같은 150 시드에서 잰 값이라 운이 걷혀 있다. 이것이
 * 판을 거듭할수록 올라가는지가 감독이 늘고 있는지의 유일한 신호다.
 */
export function deltaTrend(
  records: readonly HistoryEntry[],
  minimum = 2,
): Trend | null {
  const points: TrendPoint[] = [...records]
    .filter((record): record is HistoryEntry & { delta: number } => record.delta !== null)
    .sort((a, b) => a.at - b.at)
    .slice(-TREND_LIMIT)
    .map((record) => ({
      at: record.at,
      delta: record.delta,
      passed: record.passed,
      problemTitle: record.problemTitle,
      opponentName: record.opponentName,
    }))
  if (points.length < minimum) return null

  const mean = points.reduce((sum, item) => sum + item.delta, 0) / points.length
  let shift: number | null = null
  if (points.length >= 4) {
    const half = Math.floor(points.length / 2)
    const early = points.slice(0, half)
    const late = points.slice(points.length - half)
    const meanOf = (list: TrendPoint[]) =>
      list.reduce((sum, item) => sum + item.delta, 0) / list.length
    shift = meanOf(late) - meanOf(early)
  }

  const base =
    mean >= SAME_RATE
      ? `최근 ${points.length}판 평균 ${point(mean)}입니다. 손을 대는 쪽이 꾸준히 낫습니다.`
      : mean <= -SAME_RATE
        ? `최근 ${points.length}판 평균 ${point(
            mean,
          )}입니다. 지금까지는 손대지 않은 쪽이 더 나았다는 뜻입니다.`
        : `최근 ${points.length}판 평균 ${point(
            mean,
          )}입니다. 아직 방치와 크게 다르지 않습니다.`

  const tail =
    shift === null
      ? ' 네 판이 쌓이면 앞쪽 절반과 뒤쪽 절반을 갈라 비교합니다.'
      : shift >= 0.03
        ? ` 뒤쪽 절반이 앞쪽 절반보다 ${abs(shift)} 좋아졌습니다. 방향을 잡아가고 있습니다.`
        : shift <= -0.03
          ? ` 뒤쪽 절반이 앞쪽 절반보다 ${abs(shift)} 나빠졌습니다. 최근에 바꾼 방식을 되짚어 보세요.`
          : ' 앞쪽 절반과 뒤쪽 절반의 차이는 크지 않습니다.'

  return { points, mean, shift, note: base + tail }
}
