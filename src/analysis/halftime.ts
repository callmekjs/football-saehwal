import { getPlayer } from '../sim/squad'
import { HALFTIME_RECOVERY } from '../sim/constants'
import { homeCaptainNumber } from '../captain'
import { withJosa } from './josa'
import type { MatchState, Problem } from '../sim/types'

/**
 * 하프타임 — 주장이 전반을 정리한다.
 *
 * 사용자 요청이다 — *"후반전 시작하기 전에 주장이 간략하게 경기를
 * 분석해서 사용자에게 알려줘."*
 *
 * 급수 타임 브리핑(`briefing.ts`)이 **앞으로 무슨 일이 벌어질지**를
 * 말한다면 이쪽은 **방금 무슨 일이 있었는지**를 말한다. 라커룸에서
 * 주장이 감독에게 전반을 요약해주는 자리다.
 *
 * ★ **지어내지 않는다.** 모든 문장이 `MatchState` 의 실제 기록에서
 * 나온다 — 점수, 슈팅 수, 세트피스 허용, 배후 뚫림, 경고, 체력, 남은
 * 교체. 해당 없는 항목은 아예 나오지 않는다. `briefing.ts` 와 같은
 * 원칙이고, 같은 이유다: 없는 사실을 말하는 순간 이 화면 전체를
 * 믿을 수 없게 된다.
 *
 * ★ **명령하지 않는다.** "라인을 올리세요"가 아니라 "세트피스 허용이
 * 29입니다"까지다. 판단은 감독이 한다. 다음에 뭘 하라는 처방은 경기가
 * 완전히 끝난 뒤 `coach.ts` 의 감독 보고서가 맡는다.
 *
 * ★ **순수 함수다.** 시계도 난수도 브라우저도 모른다. 경기 결과와 확률에
 * 닿지 않는다.
 */

/**
 * 나쁜 소식으로 표시하는 기준.
 *
 * 국면 다섯 개 × 시드 30개로 실측한 값이다.
 *
 * | | 세트피스 허용 | 등 뒤 |
 * |---|---|---|
 * | 지키는 판 | 평균 20~23 (12~31) | 0~3 |
 * | 쫓는 판 | 평균 3~4 (0~11) | 0~5 |
 *
 * 처음에는 세트피스 6으로 잡았는데, 그러면 **지키는 판은 거의 언제나
 * 나쁨**으로 뜬다. 늘 빨간 줄이면 아무 뜻도 전달하지 못한다. 지키는 판의
 * 평균보다 확실히 위인 25로 올렸다.
 */
const SET_PIECE_HEAVY = 25
const BEHIND_HEAVY = 3

export type HalftimeTone = 'GOOD' | 'BAD' | 'FACT'

export interface HalftimeLine {
  id: string
  text: string
  tone: HalftimeTone
}

export interface Halftime {
  /** 말하는 사람. **등번호뿐이다** — 이 명단에 이름 칸은 없다 */
  speaker: number
  /** 한 줄 머리말. 전반을 몇 대 몇으로 마쳤는지 */
  headline: string
  lines: HalftimeLine[]
}

/**
 * 주장을 고르는 규칙.
 *
 * 누가 주장인지는 데이터에 없다. 지어내지 않고 **규칙을 정했다** —
 * 피치 위 필드 플레이어 중 등번호가 가장 작은 선수. `briefing.ts` 와
 * 같은 규칙을 써야 급수 타임과 하프타임에서 다른 사람이 말하지 않는다.
 */
function captainOf(state: MatchState): number {
  return homeCaptainNumber(state.players)
}

/**
 * 전반을 정리하는 말.
 *
 * `problem` 은 목표를 읽는 데 쓴다 — 같은 0-1이라도 "동점 이상"이 목표면
 * 아직 할 일이 남은 것이고, "리드 지키기"였다면 이미 무너진 것이다.
 */
export function buildHalftime(problem: Problem, state: MatchState): Halftime {
  const [us, them] = state.score
  const lines: HalftimeLine[] = []
  const say = (id: string, text: string, tone: HalftimeTone = 'FACT') =>
    lines.push({ id, text, tone })

  // ── 머리말: 몇 대 몇으로 마쳤나 ──
  const headline =
    us > them
      ? `전반을 ${us} 대 ${withJosa(them, '로으로')} 앞선 채 마쳤습니다.`
      : us < them
        ? `전반을 ${us} 대 ${withJosa(them, '로으로')} 뒤진 채 마쳤습니다.`
        : `전반을 ${us} 대 ${withJosa(them, '로으로')} 마쳤습니다.`

  // ── 목표를 기준으로 지금 위치 ──
  const chasing = problem.objective.type === 'EQUALIZE'
  if (chasing) {
    if (us >= them) say('goal', '따라붙었습니다. 이 상태로 끝내면 됩니다.', 'GOOD')
    else say('goal', `아직 ${them - us}골이 모자랍니다. 후반 45분이 남았습니다.`, 'BAD')
  } else {
    if (us > them) say('goal', '리드는 지켰습니다. 후반이 더 깁니다.', 'GOOD')
    else if (us === them) say('goal', '리드를 놓쳤습니다. 다시 앞서야 합니다.', 'BAD')
    else say('goal', '역전당했습니다. 두 골이 필요합니다.', 'BAD')
  }

  // ── 슈팅 대비. 경기를 누가 쥐고 있었나 ──
  const ourShots = state.stats.homeShot
  const theirShots = state.stats.awayShot
  if (ourShots + theirShots > 0) {
    const tone: HalftimeTone =
      ourShots > theirShots ? 'GOOD' : ourShots < theirShots ? 'BAD' : 'FACT'
    say('shots', `슛은 우리가 ${ourShots}번, 상대가 ${theirShots}번 했습니다.`, tone)
  }

  // ── 우리가 내준 것. 어디가 뚫렸나 ──
  if (state.stats.setPiece > 0) {
    /**
     * **"몇 번"이라고 말하지 않는다.**
     *
     * 이 값은 실제 코너킥·프리킥 수가 아니라 시뮬이 매 틱 세트피스 상황을
     * 뽑은 누적 횟수다. 22분에 29가 나온다 — 그걸 "29번 내줬습니다"라고
     * 말하면 축구가 아니다. 화면 「경기 기록」 칸이 쓰는 것과 **똑같은
     * 말과 똑같은 숫자**를 쓴다. 그래야 감독이 두 곳을 맞춰볼 수 있다.
     */
    say(
      'setpiece',
      `세트피스 위험이 ${state.stats.setPiece}까지 쌓였습니다.`,
      state.stats.setPiece >= SET_PIECE_HEAVY ? 'BAD' : 'FACT',
    )
  }
  if (state.stats.behind > 0) {
    // 배후는 판당 0~5라 실제로 셀 수 있는 사건이다. "번"을 써도 된다
    say(
      'behind',
      `뒷공간을 ${state.stats.behind}번 내줬습니다.`,
      state.stats.behind >= BEHIND_HEAVY ? 'BAD' : 'FACT',
    )
  }

  // ── 후반에 안고 들어가는 위험 ──
  const onPitch = state.players.filter((s) => s.onPitch && !s.out)
  const booked = onPitch.filter((s) => s.booked).map((s) => getPlayer(s.id).num)
  if (booked.length > 0) {
    say(
      'booked',
      `${booked.sort((a, b) => a - b).join('번, ')}번은 경고가 있습니다. 한 장 더 받으면 나갑니다.`,
      'BAD',
    )
  }

  const tired = onPitch
    .filter((s) => s.stamina < 45)
    .map((s) => ({ num: getPlayer(s.id).num, stamina: Math.round(s.stamina) }))
    .sort((a, b) => a.stamina - b.stamina)
  if (tired.length > 0) {
    const worst = tired[0]
    say(
      'stamina',
      tired.length === 1
        ? `${worst.num}번 체력이 ${worst.stamina}까지 떨어졌습니다.`
        : `${tired.length}명이 체력 45 아래입니다. 가장 낮은 건 ${worst.num}번 ${worst.stamina}입니다.`,
      'BAD',
    )
  }

  /**
   * 회복 폭이 작은 선수를 보고 "기능이 고장 났다"고 읽지 않게 먼저
   * 설명한다. 수동 휴식은 일부 피로를 덜지만 전반에 많이 소모한 체력까지
   * 되돌리지는 못하고, 후반 초 경기력 저하도 남는다는 연구 방향에 맞춘다.
   *
   * 되돌림 스위치를 0으로 둔 빌드에서는 실제 회복이 없으므로 이 줄도
   * 숨긴다.
   */
  if (HALFTIME_RECOVERY.rate > 0) {
    say(
      'recovery',
      '숨은 고를 수 있습니다. 다만 많이 뛴 선수는 쉬어도 체력이 조금만 돌아옵니다. 후반 교체가 필요할 수 있습니다.',
    )
  }

  /**
   * ── 저쪽도 전반을 다 뛰었다 ──
   *
   * 사용자가 지적했다 — *"상대방도 같이 뛰었는데 당연히 그쪽도 힘들고
   * 지쳐있어야 당연한 거 아냐."* 그리고 그것을 주장이 설명해서 감독이
   * 후반을 더 수월하게 풀도록 돕는 것이 이 줄의 목적이다.
   */
  {
    const away = Math.round(state.awayStamina)
    const worn = state.awayStamina < 70
    say(
      'awayStamina',
      worn
        ? `상대도 전반을 다 뛰었습니다. 체력은 ${away}입니다. 후반에는 뒷공간이 더 벌어질 수 있습니다.`
        : `상대 체력은 ${away}입니다. 아직 버틸 만합니다.`,
      worn ? 'GOOD' : 'FACT',
    )
  }

  // ── 인원. 숫자가 어긋났으면 그것이 후반의 전제다 ──
  if (state.homeCount < state.awayCount) {
    say('count', `우리가 ${state.homeCount}명, 상대가 ${state.awayCount}명입니다.`, 'BAD')
  } else if (state.homeCount > state.awayCount) {
    say('count', `상대가 ${state.awayCount}명입니다. 우리가 한 명 많습니다.`, 'GOOD')
  }

  // ── 손에 남은 것 ──
  say(
    'subs',
    state.subsLeft > 0
      ? `교체 카드가 ${state.subsLeft}장 남았습니다.`
      : '교체 카드를 다 썼습니다.',
    state.subsLeft > 0 ? 'FACT' : 'BAD',
  )

  return { speaker: captainOf(state), headline, lines }
}
