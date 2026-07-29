import { EVENTS, LINE } from '../sim/constants'
import { getFormation } from '../sim/formations'
import { AWAY_XI, BENCH, effectivePos, getPlayer } from '../sim/squad'
import { LEVEL_WORD, presetOf } from './presets'
import type { MatchState, Player, PlayerState, Problem } from '../sim/types'

/**
 * 급수 타임에 주장이 감독에게 상황을 전한다.
 *
 * 실제 감독이 겪는 순간을 그대로 옮긴 것이다 — 주심이 경기를 세우면
 * 감독은 벤치에서 판을 다 볼 수 없고, 안에서 뛴 사람이 와서 무엇이
 * 벌어지고 있는지 말해준다.
 *
 * ★ 이 파일은 **없는 값을 만들어내지 않는다.** ★
 *
 * 여기서 나오는 문장은 전부 국면 데이터(`problems.json`) · 경기 상태
 * (`MatchState`) · 명단(`squads.json`) · 확률 상수(`constants.ts`)에서
 * 계산된다. 지어낸 형용사나 근거 없는 예측은 한 줄도 없다. 화면이
 * "저쪽 11번이 빠르다"고 말하면 명단에 실제로 11번의 속도 82가 적혀
 * 있다는 뜻이고, "세트피스를 네 배 내준다"고 말하면 `LINE[0].setPiece`
 * 가 실제로 4.2라는 뜻이다.
 *
 * 그리고 **답을 주지 않는다.** 상황을 알려주는 데서 멈춘다. "15번을
 * 넣으세요"가 아니라 "15번이 81입니다, 지금 뒷선 최저가 62입니다"까지다.
 * 답까지 주면 시뮬레이션이 아니라 받아쓰기가 된다.
 *
 * **해당 없는 항목은 아예 나오지 않는다.** 경고 보유자가 없으면 퇴장
 * 이야기를 하지 않고, 체력이 다 멀쩡하면 부상 이야기를 하지 않는다.
 * 그래서 국면마다 다른 말이 나온다.
 *
 * 순수 함수다. `Date` · `Math.random` · `window` 를 쓰지 않으므로 같은
 * 상태에는 항상 같은 문장이 나오고, 테스트로 고정할 수 있다.
 */

export type BriefingTone = 'FACT' | 'ALERT'

/** 한 줄이 무엇에 대한 말인지. 접힌 목록에서 눈이 먼저 잡는 표식이다 */
export type BriefingTopic = '상황' | '인원' | '위험' | '상대' | '자원'

export interface BriefingLine {
  id: string
  topic: BriefingTopic
  text: string
  tone: BriefingTone
}

export interface Briefing {
  /**
   * 말하는 사람. **등번호뿐이다** — 이 명단에 이름 칸은 없다.
   */
  speaker: number
  /** 항상 보이는 줄 */
  core: BriefingLine[]
  /** 접어두는 줄. 원하는 사람만 편다 */
  more: BriefingLine[]
}

/**
 * 처음에 보이는 줄 수.
 *
 * 할 말은 열 줄이 넘게 나올 수 있는데, 급수 타임 패널은 오른쪽 열 안에
 * 있고 감독은 동시에 전술판도 봐야 한다. 열세 줄을 한꺼번에 펴면 벽처럼
 * 보여서 **한 줄도 안 읽힌다.** 그래서 급한 것 넷만 세워두고 나머지는
 * 접는다. 우선순위가 곧 화면이다.
 */
export const CORE_BRIEFING_LINES = 4

/** 이 아래면 "지쳤다"고 말한다. 부상 임계(체력 25)까지는 아직 여유가 있다 */
const TIRED = 50

/** 체력 줄에 이름을 올릴 최대 인원. 다 부르면 그것대로 벽이 된다 */
const MAX_TIRED_NAMED = 3

interface Candidate {
  /** 작을수록 먼저 말한다. 잘려서 접히는 것은 뒤쪽이다 */
  priority: number
  line: BriefingLine
}

/**
 * 주장 완장을 누가 찼는지는 데이터에 없다.
 *
 * 없는 것을 지어내는 대신 **규칙을 하나 정해서 그대로 따른다** — 피치
 * 위 필드 플레이어 중 등번호가 가장 작은 선수다. 그 선수가 빠지면 다음
 * 번호로 넘어간다. 규칙이 코드 밖에 있으면 그건 데이터를 지어낸 것과
 * 같으므로 여기 적어 둔다.
 */
export function captainOf(onPitch: PlayerState[]): number {
  let best = Infinity
  for (const s of onPitch) {
    const p = getPlayer(s.id)
    if (p.pos === 'GK') continue
    if (p.num < best) best = p.num
  }
  return best === Infinity ? 0 : best
}

/**
 * 상대 공격 자원을 빠른 순으로.
 *
 * 왜 속도로 줄을 세우는가 — 우리 배후 실점은 "우리 수비수 중 가장 느린
 * 선수"의 속도 하나로 정해진다(`minDefenderSpeed`). 그러니 상대의 빠른
 * 공격 자원이 곧 우리에게 위협이다. 위협의 정의가 시뮬레이션 안에
 * 이미 있으므로 따로 지어낼 필요가 없다.
 */
function awayThreats(): Player[] {
  return AWAY_XI.filter((p) => p.pos === 'FW' || p.pos === 'MF').sort(
    (a, b) => b.speed - a.speed,
  )
}

/**
 * 지금 뒷선에서 가장 느린 선수.
 *
 * `minDefenderSpeed` 와 **같은 규칙**이어야 한다. 그쪽은 속도만 돌려주는데
 * 주장은 등번호를 불러야 하므로 선수를 통째로 찾는다. 내려서라고 지시받은
 * 선수도 포함된다 — 실점 공식이 보는 것이 그 줄이기 때문이다.
 */
function slowestDefender(onPitch: PlayerState[]): Player | null {
  let best: Player | null = null
  for (const s of onPitch) {
    if (effectivePos(s) !== 'DF') continue
    const p = getPlayer(s.id)
    if (!best || p.speed < best.speed) best = p
  }
  return best
}

/**
 * 지금 피치 위에서 골을 넣을 사람.
 *
 * `bestFinishing` 과 같은 규칙이다. 우리 득점은 피치 위 최고 마무리
 * 하나로 정해지므로, 그 하나가 누구인지가 곧 공격력이다.
 */
function bestFinisher(onPitch: PlayerState[]): Player | null {
  let best: Player | null = null
  for (const s of onPitch) {
    const pos = effectivePos(s)
    if (pos !== 'FW' && pos !== 'MF') continue
    const p = getPlayer(s.id)
    if (!best || p.finishing > best.finishing) best = p
  }
  return best
}

/** 아직 안 쓴 벤치 자원 */
function availableBench(state: MatchState): Player[] {
  return BENCH.filter((b) => {
    const s = state.players.find((p) => p.id === b.id)
    return !!s && !s.onPitch && !s.out
  })
}

const numberList = (list: PlayerState[]): string =>
  list
    .map((s) => getPlayer(s.id).num)
    .sort((a, b) => a - b)
    .map((n) => `${n}번`)
    .join(' · ')

export function buildBriefing(problem: Problem, state: MatchState): Briefing {
  const onPitch = state.players.filter((s) => s.onPitch && !s.out)
  const chasing = problem.objective.type === 'EQUALIZE'
  const out: Candidate[] = []
  const say = (
    priority: number,
    id: string,
    topic: BriefingTopic,
    text: string,
    tone: BriefingTone = 'FACT',
  ) => out.push({ priority, line: { id, topic, text, tone } })

  // ── 1. 몇 대 몇이고 무엇을 해야 하는가. 이것만은 항상 첫 줄이다 ──
  const [us, them] = state.score
  const standing =
    us > them ? '우리가 앞서 있습니다' : us < them ? '우리가 뒤지고 있습니다' : '동점입니다'
  const goal = chasing ? '최소 동점은 만들어야 합니다' : '이대로 끝내야 합니다'
  say(0, 'score', '상황', `지금 ${us} 대 ${them}, ${standing}. ${goal}.`, us < them ? 'ALERT' : 'FACT')

  // ── 2. 인원. 한 명이 없으면 다른 어떤 말보다 먼저다 ──
  if (state.homeCount < 11) {
    const gone = state.players.filter((s) => s.out)
    say(
      5,
      'ten-men',
      '인원',
      `우리는 ${state.homeCount}명입니다. ${numberList(gone)} 자리는 다시 못 채웁니다.`,
      'ALERT',
    )
  }
  if (state.awayCount < 11) {
    say(7, 'away-ten-men', '인원', `저쪽은 ${state.awayCount}명입니다. 숫자는 우리가 앞섭니다.`)
  }

  // ── 3. 퇴장 위험. 경고를 안은 선수를 강 압박 속에 두면 열린다 ──
  const booked = onPitch.filter((s) => s.booked)
  if (booked.length > 0 && state.tactics.press === 2) {
    say(
      10,
      'send-off-risk',
      '위험',
      `${numberList(booked)}이 경고를 안고 있는데 지금 압박이 강입니다. 한 번 더 걸리면 퇴장이고, 압박을 낮추면 이 위험은 꺼집니다.`,
      'ALERT',
    )
  }

  // ── 4. 부상 위험. 체력이 임계 아래로 내려간 선수가 있으면 급하다 ──
  const tired = [...onPitch]
    .filter((s) => s.stamina < TIRED)
    .sort((a, b) => a.stamina - b.stamina)
  const critical = tired.filter((s) => s.stamina < EVENTS.injuryThreshold)
  if (critical.length > 0) {
    say(
      15,
      'injury-now',
      '위험',
      `당장 위험합니다 — ${staminaList(critical)}. 이미 부상 판정이 열리는 ${EVENTS.injuryThreshold} 아래이고, 부상은 교체 카드를 강제로 태웁니다.`,
      'ALERT',
    )
  }

  // ── 5. 저쪽이 지금 무엇을 하고 있는가 ──
  say(
    18,
    'opponent',
    '상대',
    state.opponent === 'ALL_OUT'
      ? '저쪽은 지고 있어서 전부 올라옵니다. 우리 뒤가 계속 빕니다.'
      : state.opponent === 'PARK_BUS'
        ? '저쪽은 앞서 있으니 내려앉아 골문 앞을 채웁니다. 가운데는 이미 막혀 있습니다.'
        : '저쪽은 아직 어느 쪽으로도 크게 걸지 않았습니다.',
  )

  // ── 6. 가장 위협적인 상대 선수 vs 우리 뒷선에서 가장 느린 발 ──
  const threats = awayThreats()
  const slow = slowestDefender(onPitch)
  if (slow && threats.length > 0 && threats[0].speed > slow.speed) {
    const top = threats[0]
    const tail =
      state.opponent === 'PARK_BUS' ? '역습 한 번에 뒤집힙니다' : '등 뒤를 계속 노립니다'
    say(
      20,
      'top-threat',
      '상대',
      `제일 위험한 건 저쪽 ${top.num}번입니다. 속도 ${top.speed} 대 우리 뒷선 최저 ${slow.num}번 ${slow.speed}, ${top.speed - slow.speed} 차이입니다. ${tail}.`,
      top.speed - slow.speed >= 10 ? 'ALERT' : 'FACT',
    )
    const next = threats.slice(1, 3).filter((p) => p.speed > slow.speed)
    if (next.length > 0) {
      say(
        50,
        'next-threats',
        '상대',
        `그다음은 ${next.map((p) => `${p.num}번 ${p.speed}`).join(' · ')}입니다. 우리 뒷선보다 빠른 발이 저쪽에 ${threats.filter((p) => p.speed > slow.speed).length}명 있습니다.`,
      )
    }
  }

  // ── 7. 아직 임계는 아니지만 떨어지고 있는 체력 ──
  const fading = tired.filter((s) => s.stamina >= EVENTS.injuryThreshold)
  if (fading.length > 0) {
    say(
      30,
      'stamina',
      '위험',
      `체력이 떨어졌습니다 — ${staminaList(fading.slice(0, MAX_TIRED_NAMED))}. ${EVENTS.injuryThreshold} 밑으로 가면 부상이고, 부상은 교체 카드를 강제로 태웁니다.`,
      'ALERT',
    )
  }

  // ── 8. 경고는 있는데 압박이 강이 아니라 아직 위험이 꺼져 있는 경우 ──
  if (booked.length > 0 && state.tactics.press !== 2) {
    say(
      35,
      'booked',
      '위험',
      `${numberList(booked)}이 경고를 안고 있습니다. 지금 압박이 ${LEVEL_WORD.press[state.tactics.press]}이라 퇴장 위험은 꺼져 있지만, 강으로 올리면 켜집니다.`,
    )
  }

  // ── 9. 수비라인의 대가. 이 시뮬레이션의 핵심 반전이라 해당할 때만 꺼낸다 ──
  if (state.tactics.line === 0) {
    say(
      40,
      'low-line',
      '위험',
      `수비라인이 낮음입니다. 뒤로 넘어가는 공은 ${LINE[0].behind}배지만 세트피스는 ${LINE[0].setPiece}배입니다. 깊이 잠글수록 오히려 더 맞는 구간입니다.`,
      'ALERT',
    )
  } else if (state.tactics.line === 2) {
    say(
      40,
      'high-line',
      '위험',
      `수비라인이 높음입니다. 세트피스는 ${LINE[2].setPiece}배지만 뒤로 넘어가는 공이 ${LINE[2].behind}배입니다.`,
    )
  }

  // ── 10. 앞 감독이 무엇을 걸어두고 나갔는가. 국면의 전제다 ──
  const preset = presetOf(state.tactics)
  const formation = getFormation(state.formation).label
  const levers = `라인 ${LEVEL_WORD.line[state.tactics.line]} · 압박 ${
    LEVEL_WORD.press[state.tactics.press]
  } · 폭 ${LEVEL_WORD.width[state.tactics.width]}`
  say(
    45,
    'inherited',
    '상황',
    preset
      ? `앞 감독은 ${formation} · ${preset.name} 그대로 두고 나갔습니다.`
      : `앞 감독이 남긴 건 ${formation}, ${levers}입니다. 이름 붙은 전술 어디에도 맞지 않습니다.`,
    preset ? 'FACT' : 'ALERT',
  )

  // ── 11. 지금 골을 넣을 사람 ──
  const finisher = bestFinisher(onPitch)
  if (finisher) {
    say(
      48,
      'finisher',
      '자원',
      `지금 골을 넣을 사람은 ${finisher.num}번입니다. 마무리 ${finisher.finishing.toFixed(2)}, 피치 위에서 제일 높습니다.`,
    )
  }

  // ── 12. 벤치에 남은 자원.
  //    지키는 판이면 뒷선 속도가, 쫓는 판이면 마무리가 먼저다 ──
  const bench = state.subsLeft > 0 ? availableBench(state) : []
  const benchBack = pick(bench, (p) => (p.pos === 'DF' ? p.speed : -1))
  if (benchBack && slow && benchBack.speed > slow.speed) {
    say(
      chasing ? 62 : 52,
      'bench-back',
      '자원',
      `벤치 ${benchBack.num}번은 수비 속도 ${benchBack.speed}입니다. 지금 우리 뒷선 최저는 ${slow.speed}입니다.`,
    )
  }

  const benchFinisher = pick(bench, (p) => p.finishing)
  if (benchFinisher && finisher && benchFinisher.finishing > finisher.finishing) {
    say(
      chasing ? 52 : 62,
      'bench-finisher',
      '자원',
      `벤치 ${benchFinisher.num}번 마무리는 ${benchFinisher.finishing.toFixed(2)}입니다. 지금 피치 위 최고는 ${finisher.finishing.toFixed(2)}입니다.`,
    )
  }

  const benchFast = pick(bench, (p) => p.speed)
  const fastestOnPitch = onPitch.reduce(
    (best, s) => Math.max(best, getPlayer(s.id).speed),
    0,
  )
  if (benchFast && benchFast.id !== benchBack?.id && benchFast.speed > fastestOnPitch) {
    say(
      66,
      'bench-fast',
      '자원',
      `벤치에서 제일 빠른 건 ${benchFast.num}번 ${benchFast.speed}입니다. 지금 피치 위 최고 속도는 ${fastestOnPitch}입니다.`,
    )
  }

  // ── 13. 손에 남은 카드 ──
  say(
    70,
    'subs',
    '자원',
    state.subsLeft > 0
      ? `교체는 ${state.subsLeft}장 남아 있습니다.`
      : '교체 카드는 다 썼습니다. 지금 있는 사람으로 끝내야 합니다.',
    state.subsLeft > 0 ? 'FACT' : 'ALERT',
  )

  const lines = out.sort((a, b) => a.priority - b.priority).map((c) => c.line)
  return {
    speaker: captainOf(onPitch),
    core: lines.slice(0, CORE_BRIEFING_LINES),
    more: lines.slice(CORE_BRIEFING_LINES),
  }
}

/** "6번 41 · 9번 49" */
function staminaList(list: PlayerState[]): string {
  return list
    .map((s) => `${getPlayer(s.id).num}번 ${Math.round(s.stamina)}`)
    .join(' · ')
}

/** 점수가 가장 높은 하나. 후보가 없으면 `null` */
function pick(list: Player[], score: (p: Player) => number): Player | null {
  let best: Player | null = null
  let bestScore = -Infinity
  for (const p of list) {
    const v = score(p)
    if (v > bestScore) {
      bestScore = v
      best = p
    }
  }
  return bestScore <= 0 ? null : best
}
