import { createRng, type Rng } from '../sim/rng'
import {
  assignFormationSlots,
  formationSlotKey,
  slotsForPlayers,
} from '../sim/formations'
import { AWAY_XI, abilityOf, effectivePos, getPlayer } from '../sim/squad'
import { AWAY_SHAPES, awaySlots } from '../sim/awayShape'
import { TOTAL_TICKS } from '../sim/constants'
import { calloutOf, type Callout } from './callout'
import type { MatchState, PlayerOrder, Position } from '../sim/types'

/**
 * 판정 한 줄이 화면에 남아 있는 시간(초).
 *
 * 재개는 0.35~0.95초 만에 끝나는 것이 있어서 `restart` 수명에 맞추면 글자를
 * 읽기도 전에 사라진다. 이 화면은 15분을 75초로 압축하므로 1.6초는 실제
 * 경기의 19초에 해당한다 — 판정 하나를 알아보기에 넉넉하고, 다음 장면을
 * 가릴 만큼 길지 않다.
 */
const CALLOUT_LIFE = 1.2

/**
 * 관전용 경기 연출.
 *
 * 밸런스가 걸린 시뮬레이션(src/sim)은 확률로 결과만 정한다. 이 모듈은 그
 * 결과를 실제 축구 장면으로 옮긴다. 시뮬이 "슛이 나왔다"고 하면 여기서
 * 실제로 공이 골대로 날아가고, 시뮬이 "점유가 넘어갔다"고 하면 여기서
 * 가장 가까운 수비수가 달려들어 뺏는 장면이 나온다.
 *
 * 이 모듈은 경기 결과에 아무 영향을 주지 않는다. 반대 방향으로만 흐른다.
 */

export const PITCH_W = 105
export const PITCH_H = 68

/**
 * 우리는 오른쪽(x=105) 골대를 공격한다.
 *
 * 골대는 골라인 위에 있고 폭은 7.32미터다. 실제 규격을 써야 슛이 골대
 * 안으로 들어가는지 밖으로 빗나가는지가 화면에서 구분된다.
 */
export const GOAL_LINE_HOME = 105
export const GOAL_LINE_AWAY = 0
export const GOAL_HALF = 3.66
export const GOAL_MID = PITCH_H / 2

const WALK = 1.4
const ACCEL = 8.5

/**
 * 휘슬이 울리면 공도 사람도 선다.
 *
 * 사용자가 지적했다 — *"프리킥, 파울 혹은 선수 교체 할때는 모두가 멈춰야
 * 해."* 맞다. 전에는 재개를 기다리는 동안에도 스물두 명 전원이 계속
 * 자리를 잡으러 뛰었다. 실측으로 **차는 선수를 뺀 21명 중 15.0명이 초속
 * 0.5미터를 넘게 움직였고**, 한 판에 348미터를 데드볼 중에 이동했다.
 * 공만 멈추고 사람은 계속 뛰는 화면은 경기가 멈췄다는 것 자체를 지운다.
 *
 * **급정거는 아니다.** 초속 7미터로 뛰던 선수가 한 프레임에 서면 그건
 * 사람이 아니라 정지 버튼이다. 이 감속도면 전력에서 정지까지 0.6초다.
 */
const DEAD_BALL_BRAKE = 12
/**
 * 휘슬 뒤 이만큼은 **전원이 완전히 선다**(초).
 *
 * 그 뒤로는 걷는다. 실제 축구의 데드볼이 그렇다 — 휘슬에 플레이가 딱
 * 멎고, 그다음 선수들이 **걸어서** 자리를 잡는다. 끝까지 얼려두면 대형이
 * 휘슬 순간 모양 그대로 굳어, 재개 뒤 공격이 시작될 자리가 없어진다.
 * 걷기(초속 1.5m)와 뛰기(초속 4~7m)는 화면에서 확실히 구분된다.
 */
const DEAD_BALL_FREEZE = 0.9

/**
 * 프리킥 벽.
 *
 * 경기 규칙 13조다 — **상대 선수는 공에서 9.15미터(10야드) 밖에** 서야
 * 한다. 화면에서 이 규칙이 보이는 방법은 벽 하나뿐이다. 벽이 없으면
 * 프리킥이 "공이 잠깐 섰다가 다시 굴러가는 것"과 구분되지 않는다.
 */
const WALL_DISTANCE = 9.15
/**
 * 벽에 서는 인원은 **골대까지의 거리**가 정한다.
 *
 * 실제 축구가 그렇다. 하프라인 근처의 프리킥에는 아무도 벽을 세우지 않고
 * 라인을 올려 잡는다. 박스 앞이면 서너 명이 어깨를 붙인다. 인원을 늘 같게
 * 두면 미드필드 반칙에도 네 명이 줄을 서는 이상한 그림이 된다.
 */
const wallSize = (toGoal: number): number => (toGoal > 34 ? 0 : toGoal > 24 ? 2 : 3)
/**
 * 벽에 선 선수 사이의 간격(미터).
 *
 * 실제 벽은 어깨를 붙여 0.5미터쯤이다. 여기서 1.5미터인 이유는 `separate`
 * 가 **모든 선수에게 1.4미터의 개인 공간**을 강제하기 때문이다. 그보다
 * 좁게 세우면 벽이 매 프레임 밀려나 흔들린다.
 */
const WALL_GAP = 1.5

/**
 * 상대가 반칙하는 조건과 빈도.
 *
 * 시뮬은 **우리 반칙만** 센다 — 경고와 퇴장이 우리 쪽에만 걸리기 때문이다.
 * 그래서 화면에서 프리킥은 언제나 상대 것이었고, 우리가 프리킥을 얻는
 * 장면이 한 판에 한 번도 없었다. 실제 축구는 양 팀이 비슷하게 반칙한다
 * (90분에 팀당 10~12회 → 15분 구간에 1.8회).
 *
 * **왜 태클 성공에 걸지 않았는가.** 처음에는 상대의 태클이 성공하는
 * 순간에 걸었는데, 실측으로 여섯 판에 1~3번뿐이었다. 상대는 레버가 없어
 * 성향으로 압박하고, 버스를 세운 상대는 5.5미터 밖에 서 있어 발끝이 닿는
 * 거리(1.7m)까지 오는 시간이 판당 0.1초였다. 반칙이 판당 0.17회밖에 안
 * 나왔다.
 *
 * 지금은 **경합 시간**에 건다. 우리가 공을 가졌고 상대 수비수가 6미터
 * 안에 붙어 있는 시간이 판당 8초쯤이고, 그동안 초당 이 비율로 반칙이
 * 난다. 실제 축구의 반칙도 "붙어 있는 시간"에 비례한다.
 *
 * 여기서 만드는 것은 **상대의 반칙뿐**이다. 우리 반칙은 `syncFouls` 가
 * 시뮬 기록에서 옮기므로, 여기서 또 만들면 우리 반칙이 두 배가 된다.
 * 경기 결과·점수·시뮬 난수는 건드리지 않는다 — 연출 전용 난수다.
 */
const FOUL_RANGE = 6
const FOUL_RATE = 0.11
/**
 * 재개 뒤 이 시간 동안은 반칙을 불지 않는다(초).
 *
 * 규칙상 상대는 9.15미터 밖에 서 있으므로 공을 다시 넣는 선수가 곧바로
 * 반칙을 당할 수 없다. 이게 없으면 재개가 끝나자마자 다음 반칙이 걸려
 * 공이 두 자리 사이를 왔다 갔다 한다.
 */
const FOUL_MUTE = 1.5
/**
 * 상대의 반칙이 나오는 최소 x(우리 골문 0 → 상대 골문 105).
 *
 * 우리 진영 깊은 곳에서는 상대가 우리를 반칙하지 않는다. 실제 축구에서
 * 그 자리의 반칙은 **막는 쪽**이 범하는 것이고, 그건 우리 반칙이라 시뮬이
 * 이미 세고 있다.
 */
const FOUL_ZONE = 38
/**
 * 빗나간 패스가 마크하던 수비수에게서 이만큼 **앞에** 떨어진다(미터).
 *
 * 발밑에 꽂으면 실수가 아니라 상대에게 건넨 패스로 보인다. 수비수가
 * 앞으로 나와 끊는 거리를 남긴다.
 */
const MISS_CUT_GAP = 3.4

/**
 * 흘린 공이 뺏는 선수에게 **닿기 전에 멈추는** 거리(미터).
 *
 * 전에는 상대 발밑을 직접 겨눠(중앙값 1.1m) "건네준 패스"로 보였다.
 * 이만큼 앞에 떨어뜨리면 상대가 달려 나와야 잡는다 — 실제 축구의 "터치가
 * 길어 뺏겼다"가 그런 그림이다. `MISS_CUT_GAP` 과 같은 원리다.
 */
const SPILL_GAP = 4.2

/** 흘린 공이 일직선을 벗어나는 각도(라디안). 정확히 겨눈 것처럼 보이지 않게 한다 */
const SPILL_SCATTER = 0.9
/**
 * 반칙한 상대 선수가 경고를 받는 비율.
 *
 * 실제 축구에서 반칙 열 번에 경고 한두 번이다. **상대에게 퇴장은 주지
 * 않는다** — 시뮬이 상대 인원(`awayCount`)을 자기 기록으로 들고 있어서,
 * 화면이 마음대로 한 명을 빼면 점수판·브리핑·감독 보고서가 서로 다른
 * 인원을 말하게 된다.
 */
const AWAY_CARD = 0.18

/**
 * 지금 무엇을 하는 중인가 — 노력 단계.
 *
 * 전에는 이 단계가 없었다. 목표까지 5미터를 넘으면 **예외 없이 최고
 * 속도**였고, 실측으로 목표까지 평균 13.4미터·5미터 초과가 75.4%였다.
 * 그래서 골키퍼를 뺀 전 프레임의 **29.1%가 초속 6.5미터를 넘는 전력질주**
 * 였다. 실제 축구는 1~2%다. 스물두 명이 75초 내내 전력으로 뛰는 화면은
 * 축구가 아니라 술래잡기다.
 *
 * 사람은 목적에 맞는 속도로 움직인다. 자리를 잡을 때는 조깅하고, 공을
 * 쫓을 때만 전력으로 뛴다. 단계는 **거리가 아니라 지금 하는 일**이 정한다.
 */
export type Effort = 'WALK' | 'JOG' | 'RUN' | 'SPRINT'
const EFFORT: Record<Effort, number> = { WALK: 0.2, JOG: 0.45, RUN: 0.72, SPRINT: 1 }
const TIERS: Effort[] = ['WALK', 'JOG', 'RUN', 'SPRINT']
const raise = (e: Effort): Effort => TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(e) + 1)]
const lower = (e: Effort): Effort => TIERS[Math.max(0, TIERS.indexOf(e) - 1)]

/** 목표에 다가가며 속도를 줄이기 시작하는 거리. 빨리 뛸수록 멀리서부터 줄인다 */
const SLOW_FROM: Record<Effort, number> = { WALK: 1.5, JOG: 2.5, RUN: 4, SPRINT: 6 }

/**
 * 목표 근처에서 멈추는 거리와 다시 출발하는 거리.
 *
 * 하나의 문턱만 두면 그 값 근처에서 섰다 갔다를 반복해 제자리 진동이
 * 된다. 멈추는 문턱을 안쪽에, 출발하는 문턱을 바깥쪽에 둔다.
 *
 * **문턱은 하는 일에 따라 다르다.** 자리를 잡으러 조깅하는 선수는 3미터면
 * 다 온 것이고 거기서 더 미세조정하지 않는다. 공을 쫓아 전력으로 뛰는
 * 선수에게 3미터는 다 온 것이 아니다 — 그 거리에서 멈추면 아무도 공에
 * 닿지 못한다.
 */
const STOP_GAP: Record<Effort, number> = { WALK: 3, JOG: 2.6, RUN: 1.4, SPRINT: 1 }
const RESTART_GAP: Record<Effort, number> = { WALK: 4.2, JOG: 3.6, RUN: 2.2, SPRINT: 1.6 }
/** 이 안에 들어오면 한 단 낮춰 마무리한다 */
const EASE_GAP = 3.4
/**
 * 자기 목표에서 이만큼 뒤처지면 한 단 올린다 — 회복 주행.
 *
 * 이게 없으면 노력 단계를 넣은 결과가 "몰려다닌다"에서 "늘어져서 못
 * 따라온다"로 바뀔 뿐이다. 대형이 무너진 선수는 실제로 전력으로 복귀한다.
 */
const RECOVER_GAP = 20

/**
 * 압박 레버가 화면에서 하는 일.
 *
 * 전에는 아무 일도 안 했다. `setTargets` 가 시뮬 상태를 인자로 받아놓고
 * `void state` 로 버렸고, 공에 달려드는 인원은 압박과 무관하게 늘 셋이었다.
 * 강하게 눌러도 약하게 물러서도 **화면이 똑같았다** — 홀더에서 가장 가까운
 * 상대까지의 거리 중앙값이 5.02 / 5.15 / 5.24m 로 0.2m 안에 붙어 있었고,
 * 그나마 방향도 거꾸로였다.
 *
 * 실제 축구에서 압박의 세기는 두 가지로 보인다. **몇 명이 붙느냐**와
 * **얼마나 가까이 붙느냐**다. 낮은 압박은 달려들지 않고 지연시킨다 —
 * 앞을 막아서서 옆으로 돌리게 만들지, 발을 뻗지 않는다.
 */
/** 공에 달려드는 인원 */
const PRESS_CHASERS = [2, 3, 4] as const
/**
 * 가장 가까운 한 명이 공에서 이만큼 떨어져 선다.
 *
 * 낮은 압박은 달려들지 않고 지연시킨다. 값이 큰 이유가 있다 — 실측으로
 * 쫓는 선수가 한 번의 소유 동안 홀더에게 가장 가까이 붙는 거리의 중앙값이
 * 4.4미터다. 그보다 작은 간격을 두라고 하면 애초에 거기까지 못 가므로
 * 지시가 아무 일도 하지 않는다.
 */
const PRESS_STANDOFF = [5.5, 2.2, 0] as const
/** 두 번째·세 번째가 뒤를 받치는 거리 */
const PRESS_BACKUP = [7, 4, 2.5] as const
/**
 * 공을 안 쫓는 나머지가 공 쪽으로 얼마나 따라 붙는가.
 *
 * 압박은 앞의 한두 명이 아니라 **블록 전체**로 하는 것이다. 높이 누르면
 * 블록이 공 쪽으로 밀려 올라가 상대의 다음 선택지를 지우고, 낮게 서면
 * 블록이 제자리를 지켜 앞을 막기만 한다. 앞의 몇 명만 바꾸면 화면에서
 * 레버가 거의 안 보인다 — 실측으로 공 8미터 안 인원이 1.13 대 1.18명이었다.
 */
const PRESS_COMPACT = [-0.13, 0, 0.13] as const

/**
 * 골키퍼는 자기 자리까지 남은 거리로 단계를 정한다.
 *
 * 문턱이 필드 선수보다 훨씬 촘촘하다. 골문이 7.32미터인데 2미터를 "다
 * 왔다"고 치면 골대 한쪽이 통째로 빈다. 상대가 박스로 들어오면 골키퍼는
 * 8미터를 물러나야 하는데, 그 8미터를 조깅으로 가면 그동안 골문이 비어
 * 있다 — 골키퍼 위치를 고쳐놓은 작업이 그대로 회귀한다.
 */
const gkEffort = (gap: number): Effort =>
  gap > 5 ? 'SPRINT' : gap > 2 ? 'RUN' : gap > 0.8 ? 'JOG' : 'WALK'
/** 골키퍼가 "다 왔다"고 치는 거리. 미터 단위로 자리를 잡는다 */
const GK_STOP = 0.5
const GK_RESTART = 0.9

/**
 * 공의 물리.
 *
 * 전에는 공이 목표 지점까지 등속으로 가서 **도착하는 순간 단번에 섰다.**
 * 차인 공이 그렇게 서는 것은 축구가 아니다. 이제 공은 속도를 가지고,
 * 잔디에 마찰로 감속하고, 뜬 공은 떨어져 튄다. 받는 선수가 늦으면 공은
 * 그 선수를 지나쳐 계속 흐른다.
 *
 * **구름 감속** — 축구공의 구름 저항 계수는 짧게 깎은 천연 잔디에서
 * 대략 0.055다. a = μ·g = 0.055 × 9.81 ≈ 0.54 m/s². 이 값이면 초속
 * 20미터로 찬 땅볼 패스는 20미터를 가도 19.4m/s 로 거의 안 죽는다 —
 * 실제 축구의 강한 땅볼 패스가 그렇다.
 *
 * 다만 구름 저항만으로는 세게 찬 공이 300미터를 굴러야 선다. 실제 잔디는
 * 속도에 비례하는 저항(잔디 잎에 스치는 손실)이 함께 걸린다. 두 성분을
 * 더하면 초속 20미터에서 2.5 m/s², 걸음 속도에서 0.6 m/s² 가 되어
 * "빠른 공은 잘 안 죽고 느린 공은 금방 선다"가 나온다.
 */
const GRAVITY = 9.81
const ROLL_DECEL = 0.54
const ROLL_DRAG = 0.1
/**
 * 튕김.
 *
 * 규정 공기압(0.6~1.1 bar)의 공을 잔디에 떨어뜨리면 딱딱한 바닥(반발계수
 * 0.83)보다 훨씬 덜 튄다. 잔디 위에서는 대략 0.6이다.
 */
const BOUNCE = 0.6
/** 공중 저항 */
const AIR_DRAG = 0.05
/** 이 높이 아래면 발이 닿는다. 크로스바가 2.44m 다 */
const REACH_HEIGHT = 1.9
/** 슛 속도. 프로 선수의 슛은 초속 25~35미터다 */
const SHOT_SPEED = 30
/** 공을 발밑에 두는 거리 */
const CONTROL_DIST = 1.3
/**
 * 슛을 고려하는 거리.
 *
 * 이보다 멀면 시뮬이 "슛"이라고 알려도 그 자리에서 쏘지 않고 기다린다.
 * 전에는 그런 검사가 없어서 슛 거리 중앙값이 47미터였다 — 자기 진영에서
 * 상대 골대를 향해 때리는 장면이 절반이었다는 뜻이다.
 */
const SHOOT_RANGE = 32
/**
 * 시뮬이 골이라고 알렸는데 사정거리에 아무도 없을 때 허용하는 최대 슛 거리.
 *
 * 38미터짜리 골은 드물지만 있다. 그 너머는 축구가 아니라 걷어내기가
 * 골이 된 것이다.
 */
const LONG_SHOT_MAX = 38
/**
 * 화면의 공 주인이 시뮬과 어긋난 채 버틸 수 있는 시간(초).
 *
 * 짧게 잡으면 화면에서 방금 태클로 뺏은 공이 곧바로 되돌아가 압박이
 * 무의미해진다. 길게 잡으면 시뮬이 골이라고 알릴 때 화면의 그 팀이
 * 반대편에서 수비를 하고 있다.
 */
const OWNER_GRACE = 0.5

/**
 * 골 장면을 만들기 위해 확보하는 전개 시간(초).
 *
 * 시뮬은 확률로 득점을 정한다. **그 순간 시뮬 자신의 볼 위치조차 상대
 * 진영이 아닌 경우가 절반이 넘는다** — 백 판을 재보니 득점을 정한 틱에
 * 시뮬의 볼이 득점 팀의 공격 진영에 있던 것은 46%였다. 사용자가 본
 * "공은 하프라인도 못 넘었는데 골"이 이것이다. 화면이 아무리 잘 그려도
 * 그 순간에 골대 앞 장면을 만들어낼 수는 없다.
 *
 * 그래서 화면은 **골을 예약해두고 진짜 공격을 만든 다음에 보여준다.**
 * 자기 진영에서 하프라인을 넘는 데 2~4초, 상대 진영에서 골문 앞까지
 * 밀고 들어가는 데 다시 3~5초가 걸린다. 그만큼을 준다.
 *
 * 점수판은 이 장면에 맞춰 오른다(`displayScore`). 시뮬의 점수는 그대로다 —
 * 늦는 것은 화면의 숫자뿐이고, 종료 휘슬에서 반드시 같아진다.
 */
const GOAL_RUNWAY = 11
/**
 * 골이 들어가기 전에 있어야 하는 최소 전개 시간(초).
 *
 * "공이 그 팀 발에 상대 진영에 있던 연속 시간"이다. 이 시간을 채우지
 * 못하면 사정거리 안이어도 아직 쏘지 않는다. 골이 사건이 되려면 그 앞에
 * 전개가 있어야 한다.
 */
const BUILDUP = 3
/**
 * 유예가 끝났을 때 전개가 진행 중이면 더 줄 수 있는 시간(초).
 *
 * 유예가 끝나는 그 순간 그 팀이 이미 상대 진영에서 공을 몰고 있으면,
 * 남은 것은 전개 시간을 채우는 일뿐이다. 거기서 끊는 것은 다 지은 장면을
 * 헐고 공을 순간이동시키는 것과 같다. `BUILDUP` 을 채울 만큼만 준다
 */
const GOAL_EXTRA = 4
/**
 * 라인 밖으로 향하는 공을 먼저 처리할 시간(초).
 *
 * 공이 이 시간 안에 라인을 넘을 궤적이면 예약 골이 만료돼도 기다린다.
 * 아웃 판정과 재개가 먼저 끝나야 공이 라인 근처에서 골망으로 순간이동하지
 * 않는다.
 */
const OUTBOUND_GUARD = 0.5

/**
 * 태클이 성립하는 거리.
 *
 * 시뮬이 "점유가 넘어갔다"고 알려도, 뺏는 선수가 이만큼 붙어 있지 않으면
 * 공만 옮겨서는 안 된다. 8미터 떨어진 수비수에게 공이 순간이동하는 장면은
 * 축구가 아니다. 멀면 홀더가 공을 흘린 것으로 그린다.
 *
 * 너무 좁게 잡으면 반대 문제가 생긴다. 소유권 전환이 거의 전부 "흘렸다"
 * 로 그려져 발밑에서 뺏는 장면이 화면에서 사라진다 — 3.5m 로 뒀더니 세
 * 판에 한 번밖에 안 나왔다. 한 걸음에 발이 닿는 거리로 잡는다.
 */
const TACKLE_REACH = 4.5

/**
 * "골문 앞을 지켜라" 를 받은 선수가 자기 골대에서 벗어날 수 있는 거리(m).
 *
 * 페널티 지역이 골라인에서 16.5미터다. 그 조금 바깥까지 허용해 박스 앞
 * 세컨드볼까지 닿게 한다. 더 좁히면 골라인에 붙어 서 있는 그림이 되고,
 * 더 넓히면 다른 수비수와 구분이 안 돼 지시를 내린 표시가 사라진다.
 */
const HOLD_RANGE = 22

/**
 * 오프사이드로 부는 최소 차이(미터). **애매하면 안 분다.**
 *
 * 실제 규칙은 신체 일부가 앞서기만 해도 오프사이드다. 그대로 옮기면 안
 * 된다 — 우리 선수는 반지름 7픽셀짜리 점이고 자리가 매 프레임 흔들린다.
 *
 * 7미터는 재서 나온 값이다. 시드 40개 × 다섯 국면(200판)으로 잰 판당
 * 판정 횟수:
 *
 * | 기준 | 판당 평균 | 자동검사 |
 * |---|---|---|
 * | 1.2m | 4.4회 | 6~10개 실패 |
 * | 3m | 2.0회 | 3개 실패 |
 * | 5m | 1.2회 | 4개 실패 |
 * | **7m** | **0.63회** | **95개 전부 통과** |
 *
 * 실제 축구를 이 15분 구간으로 환산하면 0.7~1.0회다. 7미터가 빈도로도
 * 맞고 나머지 관전 품질을 하나도 깎지 않는다.
 *
 * 낮은 기준이 왜 나쁜가: 판정이 잦아지면 데드볼이 늘어(정지 비율 15% →
 * 27.6%) 75초짜리 관전에서 볼 것이 사라지고, 예약된 골이 전개 시간을
 * 뺏겨 장면 없이 지나간다. 이 화면은 15분을 75초로 압축하므로 휘슬 한
 * 번의 값이 실제 축구의 열두 배다.
 *
 * 이건 편법이 아니라 규칙에 있는 원칙이다 — **의심스러우면 공격 측에
 * 유리하게.** 실제 부심도 확신이 없으면 깃발을 올리지 않는다.
 */
const OFFSIDE_MARGIN = 7

/**
 * 재개 뒤 이 시간 동안은 오프사이드를 불지 않는다(초).
 *
 * 규칙이다. 스로인·골킥·코너킥에서 직접 받는 공은 오프사이드가 아니다.
 * 시간으로 두는 이유는 재개 직후 첫 패스만 정확히 짚어내려면 상태를 하나
 * 더 들고 다녀야 하는데, 이 화면의 재개는 1초 안에 끝나기 때문이다.
 */
const OFFSIDE_MUTE = 1.4

/** 깃발을 들고 있는 시간(초) */
const FLAG_LIFT = 1.8

/**
 * 부심 깃발이 뻗는 길이(미터). 내렸을 때와 들었을 때.
 *
 * 미터로 둔다. 선수 반지름의 배수로 두면 화면이 작아질 때 깃발만
 * 상대적으로 커진다 — 반지름에는 최소 픽셀 하한이 걸려 있기 때문이다.
 */
export const FLAG_REACH = { down: 2.6, up: 4.7 }

/**
 * 부심 깃발 끝이 놓이는 y (미터).
 *
 * **깃발은 경기장 안쪽으로 뻗는다.** 실제 부심은 터치라인 바깥에 서서
 * 바깥쪽으로 깃발을 드는데, 그대로 옮기면 **화면 밖에 그려져 아예 안
 * 보인다.** 우리 캔버스는 105×68에 정확히 맞춰져 여백이 0이고 부심은
 * 라인 안쪽 1.1미터에 서 있다. 실측으로 깃발 끝이 −27.5픽셀과
 * 555.5픽셀이었다(캔버스 높이 528). 두 부심 모두 깃발이 통째로 잘려
 * 있었고, 20초를 지켜봐도 깃발이 한 번도 눈에 안 잡혔다.
 *
 * 위에서 내려다보는 화면이라 "위로 든다"는 방향 자체가 뜻이 없다.
 * 보이는 것이 먼저다.
 */
export function flagTipY(kind: Official['kind'], raised: boolean): number {
  const reach = raised ? FLAG_REACH.up : FLAG_REACH.down
  // 위쪽 부심은 아래(경기장 안)로, 아래쪽 부심은 위(경기장 안)로
  return kind === 'AR_TOP' ? AR_INSET + reach : PITCH_H - AR_INSET - reach
}

/**
 * 판정 표시가 화면에 남는 시간(초).
 *
 * 이 화면은 15분을 75초로 압축하므로 실제 축구의 몇 초가 여기서는
 * 0.5초 안쪽이다. 너무 짧으면 눈에 안 들어오고, 길면 다음 판정과 겹친다.
 */
const WHISTLE_SHOW = 1.2
/** 카드는 조금 더 오래 든다. 주심이 선수 앞까지 가서 들어 올린다 */
const CARD_SHOW = 2.2

/** 페널티 지역 깊이(미터). 골라인에서 16.5m 가 규격이다 */
const PENALTY_DEPTH = 16.5

/** 심판이 낼 수 있는 최고 속도(초당 미터). 선수보다 느리다 */
const REF_SPEED = 6.2

/**
 * 주심이 공에서 떨어져 서는 거리(미터).
 *
 * 실제 주심은 공에서 15~20미터를 유지한다. 더 붙으면 패스 길에 서고,
 * 더 떨어지면 반칙을 못 본다.
 */
const REF_STANDOFF = 15
/** 주심이 공보다 뒤에 서는 거리(미터). 플레이를 앞에 두고 본다 */
const REF_TRAIL = 4
/** 주심이 반대쪽으로 자리를 옮기는 기준(미터). 여유 구간이 없으면 갈지자가 된다 */
const REF_SWITCH = 6
const AR_SPEED = 7.0

/**
 * 부심이 터치라인에서 안쪽으로 들어와 서는 거리(미터).
 *
 * 실제 부심은 라인 **바깥**에 선다. 여기서 바깥에 세우면 화면에서
 * 사라진다 — 캔버스가 경기장 105×68에 정확히 맞춰져 있어 여백이 없다.
 * 여백을 만들려면 경기장이 그만큼 작아지는데, 이 화면에서 가장 큰
 * 면적을 차지해야 하는 것이 경기장이다.
 *
 * 1.1미터면 화면에서 라인 위에 선 것으로 읽힌다. 선수와 겹칠 수
 * 있지만 실제 경기에서도 윙어는 부심 코앞을 스쳐 지나간다.
 */
const AR_INSET = 1.1

export interface VPlayer {
  id: string
  num: number
  side: 'HOME' | 'AWAY'
  pos: Position
  x: number
  y: number
  vx: number
  vy: number
  tx: number
  ty: number
  /**
   * 부드럽게 따라가는 실제 목표.
   *
   * 역할이 바뀌는 순간 tx·ty 는 반대편으로 튈 수 있다. 몸이 그걸 그대로
   * 따라가면 홱홱 꺾이는 갈지자가 된다. 사람은 방향을 눌러서 바꾼다.
   */
  stx: number
  sty: number
  /**
   * 대형에서 이 선수가 맡은 자리 번호.
   *
   * 배열 순서로 자리를 나눠주면 교체 한 번에 뒤쪽 선수가 전부 한 칸씩
   * 밀린다. 자리 번호를 선수에게 붙여두면 뛰던 선수는 자리를 지키고
   * 새로 들어온 선수만 빈자리를 받는다.
   */
  slot: number
  /** 이 자리가 원래 자기 자리 */
  homeX: number
  homeY: number
  top: number
  stamina: number
  booked: boolean
  /**
   * 감독이 이 선수에게 내린 개별 지시.
   *
   * 화면에서 **눈에 보여야** 지시가 조작으로 성립한다. 확률만 바뀌고
   * 그림이 그대로면 감독은 자기가 무엇을 시켰는지 확인할 방법이 없다.
   * 상대 선수에게는 걸리지 않으므로 언제나 `NONE` 이다.
   */
  order: PlayerOrder
  /** 방금 태클을 시도해 몸이 무너진 상태. 잠깐 못 움직인다 */
  recover: number
  /** 지금 무엇을 하는 중인가. 최고 속도에 곱한다 */
  effort: Effort
  /** 자리를 잡고 멈춰 선 상태. 다시 출발하려면 목표가 더 멀어져야 한다 */
  settled: boolean
}

export type BallMode = 'HELD' | 'PASS' | 'SHOT' | 'LOOSE'

export interface VBall {
  x: number
  y: number
  /** 지면에서의 높이(미터). 뜬 공은 떨어져 튄다 */
  z: number
  /** 공의 속도(초당 미터). 이게 있어야 공이 굴러가고 서서히 선다 */
  vx: number
  vy: number
  vz: number
  mode: BallMode
  /** HELD 일 때 공을 가진 선수 */
  holder: string | null
  /** 마지막 킥의 출발점. 화면에 궤적을 그리는 데 쓴다 */
  fromX: number
  fromY: number
  /** 노린 지점. **공이 여기서 멈추는 것은 아니다** */
  toX: number
  toY: number
  /** 이 선수에게 보낸 공이다. 받으러 달려가고, 잡을 때 조금 유리하다 */
  targetId: string | null
  /** 방금 찬 선수. 자기가 찬 공을 곧바로 다시 잡는 것을 막는다 */
  kickerId: string | null
  /** 찬 뒤 이 시간 동안은 찬 선수가 다시 못 잡는다(초) */
  selfLock: number
  /** 이 슛은 골로 끝난다. 시뮬이 이미 득점으로 판정한 슛이다 */
  willScore: boolean
  /** 마지막으로 공을 찬 팀. 공이 밖으로 나갔을 때 누가 재개하는지를 정한다 */
  lastTouch: 'HOME' | 'AWAY'
  /**
   * 이 공이 왜 굴러가고 있는지.
   *
   * 화면에는 안 나오지만 검증에는 필요하다. 흘린 공과 의도한 패스를
   * 구분하지 못하면 패스 성공률 통계에 "일부러 뺏긴 공"이 섞인다.
   */
  kick: 'PASS' | 'SPILL' | 'SHOT' | 'RESTART'
}

/**
 * 공이 밖으로 나간 뒤의 재개.
 *
 * 축구는 90분 내내 흐르지 않는다. 공은 계속 라인 밖으로 나가고, 그때마다
 * 규칙이 정한 자리에서 정해진 팀이 다시 넣는다. 이것이 없으면 공이 벽에
 * 튕기는 실내 경기처럼 보인다.
 */
export interface Restart {
  kind: 'THROW_IN' | 'GOAL_KICK' | 'CORNER' | 'FREE_KICK'
  /** 다시 넣는 팀 */
  side: 'HOME' | 'AWAY'
  x: number
  y: number
  /** 남은 정지 시간(초) */
  wait: number
  /** 공을 가지러 가는 선수 */
  takerId: string | null
  /** 재개가 끝나지 않고 늘어지는 것을 막는 보호 시간 */
  age: number
  /**
   * 벽에 서는 선수와 각자 설 자리.
   *
   * 프리킥에만 있다. 휘슬 직후 전원이 선 뒤, 움직여도 되는 사람은 공을
   * 놓으러 가는 선수와 이 벽뿐이다.
   */
  wall: Array<{ id: string; x: number; y: number }>
}

export interface Flash {
  kind: 'TACKLE' | 'GOAL' | 'SAVE' | 'SHOT'
  x: number
  y: number
  life: number
}

/**
 * 쓰러져 있는 선수.
 *
 * 시뮬은 부상이나 퇴장이 나는 **그 틱에 즉시** 선수를 피치에서 빼버린다.
 * 화면에서는 선수가 소리 없이 사라지고, 관전자는 열한 명이 열 명이 된
 * 것조차 모른다. 그렇다고 시뮬을 늦출 수는 없다 — 교체 카드 강제 소모와
 * 커버 공백 계수가 그 시점에 물려 있고, 밸런스가 걸려 있다.
 *
 * 그래서 **화면에만 잔상을 남긴다.** 시뮬에서는 이미 빠진 선수를 몇 초
 * 동안 쓰러진 채로 그려주고 배지를 띄운 뒤 사라지게 한다. 시뮬 결과에서
 * 파생되기만 하므로 한 방향 규칙에 어긋나지 않는다.
 */
export interface Downed {
  id: string
  num: number
  side: 'HOME' | 'AWAY'
  x: number
  y: number
  kind: 'INJURY' | 'SEND_OFF'
  /** 남은 시간(초) */
  life: number
  /** 처음 받은 시간. 사라질 때 서서히 흐려지게 하는 데 쓴다 */
  span: number
}

/**
 * 교체로 걸어 나가는 선수.
 *
 * 시뮬에서는 이미 빠졌지만 화면에서는 터치라인까지 걸어 나간다. 이게
 * 없으면 선수가 그 자리에서 소리 없이 다른 사람으로 바뀐다.
 */
export interface Leaving {
  num: number
  x: number
  y: number
  /** 걸어 나갈 터치라인 위의 지점 */
  tx: number
  ty: number
  life: number
  span: number
}

/** 골이 들어간 직후의 연출 상태. 이게 없으면 골이 사건으로 안 보인다 */
export interface Celebration {
  side: 'HOME' | 'AWAY'
  /** 남은 시간(초). 0이 되면 킥오프로 넘어간다 */
  life: number
  /** 공이 골망에 박힌 자리 */
  x: number
  y: number
}

/**
 * 심판 셋.
 *
 * 사용자가 지적했다 — *"심판도 없고 라인 심도 없어. 그냥 동그라미가
 * 공차는 것만 보이잖아."* 스물두 개의 점만 있으면 그건 어떤 공놀이도
 * 될 수 있다. 축구장에는 언제나 검은 옷 셋이 더 있고, 그중 둘은
 * **터치라인 밖에서 옆걸음으로만** 움직인다. 그 셋이 있어야 초록
 * 사각형이 축구장으로 읽힌다.
 *
 * 부심의 자리는 장식이 아니라 **정보**다. 부심은 뒤에서 두 번째 수비수와
 * 나란히 선다. 그래서 부심의 위치가 곧 오프사이드 라인이고, 관전자는
 * 선을 그리지 않아도 어디가 경계인지 눈으로 안다.
 *
 * **경기 결과에 아무 영향이 없다.** 공에 닿지 않고, 난수를 쓰지 않으며,
 * 시뮬은 심판이 있는지조차 모른다.
 */
export interface Official {
  /** 주심 하나와 부심 둘. 부심은 서로 반대편 터치라인의 반대편 절반을 맡는다 */
  kind: 'REFEREE' | 'AR_TOP' | 'AR_BOTTOM'
  x: number
  y: number
  /** 깃발을 든 남은 시간(초). 부심만 쓴다 */
  flag: number
}

/**
 * 오프사이드 판정이 난 자리. 깃발이 내려갈 때까지 화면에 남는다.
 *
 * 이것은 **관전 연출 계층의 사건**이다. 스로인·골킥·코너킥과 똑같이
 * 시뮬 바깥에서 만들어지고, 시뮬의 점수·확률·난수 18개를 건드리지
 * 않는다. 경기 결과를 바꾸는 판정이 아니라 **공이 다시 놓이는 자리**를
 * 정할 뿐이다.
 */
/**
 * 주심이 방금 내린 판정.
 *
 * 사용자 요청이다 — *"주심에게는 파울과 페널티킥, 스로인, 프리킥 등 축구
 * 상황에 맞게 줄 수 있다고 말해줘."*
 *
 * 반칙·프리킥·페널티킥·경고·퇴장은 **이미 다 일어나고 있었다.** 없던 것은
 * 그것을 **누가 주는가**였다. 공이 저절로 놓이고 카드가 저절로 붙으면
 * 심판은 화면에 서 있는 장식이다. 이제 주심이 판정 지점으로 달려가고
 * 카드는 주심이 손에 들어 올린다.
 *
 * **누가 신호하는지는 규칙이 정한다.** 주심이 휘슬을 부는 것은 반칙·
 * 페널티킥·오프사이드·킥오프다. 스로인·코너킥·골킥은 휘슬 없이 **부심이
 * 깃발로 방향을 가리킨다** — 실제 축구에서 스로인마다 휘슬이 울리지
 * 않는다. 이 구분이 없으면 심판이 그냥 계속 삑삑거리는 사람이 된다.
 */
export interface Whistle {
  kind: 'FOUL' | 'PENALTY' | 'OFFSIDE' | 'CARD' | 'KICKOFF'
  x: number
  y: number
  /** 카드 판정일 때 빨간 카드인가 */
  red: boolean
  life: number
}

export interface OffsideCall {
  x: number
  y: number
  /** 깃발을 든 부심 쪽. 화면에서 어느 라인이 불었는지 보인다 */
  by: Official['kind']
  life: number
}

/**
 * 화면과 함께 내보낼 소리 사건.
 *
 * `restart`·`celebration`의 현재 값만 보면, 느린 프레임 하나 사이에
 * 생겼다가 끝난 짧은 사건을 놓친다. 사건을 순번으로 남기면 화면이
 * 늦게 따라와도 각 휘슬과 함성을 정확히 한 번씩 소비할 수 있다.
 */
export type VisualAudioCue =
  | { sequence: number; kind: 'OUT' }
  | { sequence: number; kind: 'GOAL'; side: 'HOME' | 'AWAY' }

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

/**
 * 패스 세기 (초당 미터).
 *
 * 선수는 늘 같은 세기로 차지 않는다. 실제 축구의 짧은 땅볼 패스는 초속
 * 12~16미터, 긴 전환 패스는 22~28미터다. 거리에 맞춰 세기를 정한다.
 */
const passSpeed = (d: number) => clamp(11 + d * 0.5, 13, 26)

/**
 * 튕기는 순간 잔디에 걸려 앞으로 가는 속도도 함께 죽는 비율.
 *
 * 얼마나 죽는지는 **얼마나 세게 떨어졌느냐**에 달려 있다. 하늘에서
 * 떨어진 롱볼은 잔디를 깊게 물어 크게 죽고, 살짝 뜬 공이 스치듯 닿는
 * 것은 거의 안 죽는다. 고정값으로 두면 살짝 뜬 슛이 세 번 튀는 동안
 * 22%씩 잃어 초속 30미터가 8미터가 된다 — 실측으로 그렇게 나왔고,
 * 골이 화면에 뜨는 데 4.7초가 걸렸다.
 */
const bounceGrip = (impact: number) => clamp(1 - impact * 0.035, 0.72, 1)

/** 상대 기본 배치. 성향에 따라 통째로 앞뒤로 옮겨간다 */

const TOP_SPEED: Record<Position, number> = { GK: 5.2, DF: 7.4, MF: 7.6, FW: 8.0 }

/**
 * 선수 개인의 속도를 관전 최고 속도에 섞는다.
 *
 * **QA-14 에서 걸렸다.** 명단 다시 뽑기로 나온 스타의 계산 속도가 66에서
 * 100이 되어도 관전 최고 속도는 6.495m/s 그대로였고, 75초 동안 두 위치의
 * 차이가 **0.000m** 였다. 관전이 포지션별 고정 속도만 써서, 카드 숫자만
 * 커지고 뛰는 것은 똑같았다. 감독이 화면으로 확인할 방법이 없었다.
 *
 * 자리는 여전히 `TOP_SPEED` 가 정한다 — 골키퍼가 공격수보다 빠르면 안 된다.
 * 그 위에 **그 선수가 명단 평균보다 얼마나 빠른가**를 곱한다.
 *
 * 우리 선발의 평균 속도가 72 근처라 그 값을 1.0 으로 둔다.
 *
 * 기울기는 **0.6에서 0.45로 낮췄다.** 0.6 에서는 빨라진 수비가 예약된 골
 * 장면을 가로채, 80골 중 셋이 화면에 골 장면 없이 지나갔다
 * (`visual.test.ts` 의 "시뮬이 골이라고 하면 화면에서도 골이 들어간다").
 * 시뮬이 골이라고 했는데 화면이 안 보여주는 것은 더 큰 고장이므로 그쪽을
 * 지켰다. 0.45 에서도 스타는 눈에 띄게 빠르다.
 *
 * **확률에는 닿지 않는다.** 관전 계층이므로 경기 결과를 바꾸지 않는다.
 */
const SPEED_PIVOT = 72
const SPEED_SLOPE = 0.45

/**
 * 상대 등번호별 속도.
 *
 * 등번호는 대형이 바뀌어도 역할에 붙어 다니지만 **자리는 바뀐다.** 그래서
 * 대형이 준 포지션으로 id 를 만들면 안 맞는다(4-4-2 의 3번은 수비지만
 * 3-5-2 에서는 다른 줄에 선다). 번호로 찾는다.
 */
const AWAY_SPEED_BY_NUM = new Map(AWAY_XI.map((p) => [p.num, p.speed]))

function topSpeedOf(pos: Position, speed: number): number {
  const factor = clamp(1 + (SPEED_SLOPE * (speed - SPEED_PIVOT)) / 100, 0.85, 1.2)
  return TOP_SPEED[pos] * factor
}

export class VisualMatch {
  players: VPlayer[] = []
  ball: VBall
  flashes: Flash[] = []
  /** 이미 일어난 소리 사건. 순번이 있으므로 느린 화면에서도 건너뛰지 않는다 */
  audioCues: VisualAudioCue[] = []
  private nextAudioSequence = 1
  /** 골이 들어간 뒤의 세리머니. 이 동안은 경기가 멈춰 있다 */
  celebration: Celebration | null = null
  /** 공이 밖으로 나가 재개를 기다리는 중 */
  restart: Restart | null = null
  /**
   * 지금 경기장에 띄워둘 판정 한 줄. 없으면 `null`.
   *
   * 사용자 지적에서 나왔다 — *"왜 갑자기 공을 주는 지 모르잖아"*.
   * 오른쪽 이벤트 목록은 골·경고·교체만 싣고 파울은 아예 걸러내므로,
   * 경기를 보는 동안 스로인인지 파울인지 알 길이 없었다.
   */
  callout: (Callout & { life: number }) | null = null
  /** 지금 띄운 판정이 어느 재개·휘슬에서 나왔는지. 같은 사건을 다시 읽지 않는다 */
  private calloutRestart: Restart | null = null
  private calloutWhistle: Whistle | null = null
  /**
   * 주심 하나와 부심 둘.
   *
   * 부심은 터치라인 **바깥**에 선다(`y` 가 0 미만이거나 68 초과). 안쪽에
   * 세우면 선수와 겹쳐서 스물다섯 번째 선수처럼 보인다.
   */
  officials: Official[] = [
    { kind: 'REFEREE', x: PITCH_W / 2, y: PITCH_H / 2 + 10, flag: 0 },
    { kind: 'AR_TOP', x: PITCH_W * 0.25, y: AR_INSET, flag: 0 },
    { kind: 'AR_BOTTOM', x: PITCH_W * 0.75, y: PITCH_H - AR_INSET, flag: 0 },
  ]
  /** 방금 분 오프사이드. 없으면 null */
  offside: OffsideCall | null = null
  /** 주심이 방금 내린 판정. 이 동안 주심이 그 자리로 간다 */
  whistle: Whistle | null = null
  /** 부상·퇴장으로 빠졌지만 아직 화면에 쓰러져 있는 선수 */
  downed: Downed[] = []
  /** 교체로 걸어 나가는 중인 선수 */
  leaving: Leaving[] = []
  /**
   * 교체 때문에 플레이가 멈춰 있는 시간(초).
   *
   * **경기 시계가 멈추는 것이 아니다.** 시뮬은 절대 시각으로 750틱을
   * 계속 돌린다("시계는 멈추지 않는다"는 이 게임의 전제다). 화면의 공만
   * 잠깐 데드볼이 되어 교체가 눈에 보이게 한다 — 골킥·프리킥에서 이미
   * 쓰고 있는 방식과 같다.
   */
  subPause = 0
  /** 방금 들어온 선수의 등번호. 화면에 잠깐 표시한다 */
  entering: number[] = []
  /**
   * 점수판에 띄우는 점수.
   *
   * 시뮬의 `state.score` 와 다를 수 있다. 시뮬이 득점을 정하는 순간의
   * 경기 상황은 골을 그릴 수 있는 상황이 아닌 경우가 절반이 넘어서,
   * 화면은 골을 예약해두고 진짜 공격 장면을 만든 다음에 보여준다.
   * 그동안 숫자만 먼저 오르면 관전자는 "공이 하프라인에 있는데 골이
   * 났다"를 보게 된다 — 사용자가 지적한 바로 그 결함이다.
   *
   * **경기 결과는 아무 영향도 받지 않는다.** 승패는 시뮬의 점수로만
   * 판정하고, 이 숫자는 종료 휘슬에서 시뮬의 점수로 반드시 맞춰진다.
   */
  displayScore: [number, number] = [0, 0]
  /**
   * 각 팀이 상대 진영에서 공을 쥐고 밀고 있는 연속 시간(초).
   *
   * 골은 이 값이 `BUILDUP` 을 넘어야 들어간다. "골 앞에 전개가 있다"를
   * 확률이 아니라 조건으로 만든다.
   */
  private attackTime: Record<'HOME' | 'AWAY', number> = { HOME: 0, AWAY: 0 }
  /** 시뮬이 지금 몇 틱째인지. 남은 경기 시간으로 골 유예를 자른다 */
  private simTick = 0
  private rng: Rng
  private decideIn = 0
  private lastStats = { homeShot: 0, awayShot: 0 }
  private lastScore: [number, number] = [0, 0]
  private lastOwner: 'HOME' | 'AWAY' = 'HOME'
  /** 시뮬이 말하는 지금의 공 주인. 화면은 이걸 따라간다 */
  private simOwner: 'HOME' | 'AWAY' = 'HOME'
  /** 화면의 공 주인이 시뮬과 어긋난 채 흐른 시간(초) */
  private ownerDrift = 0
  private lastFormation = ''
  /** 같은 자리 모양 안에서 교체할 때만 기존 자리 번호를 보존한다 */
  private lastFormationSlots = ''
  /**
   * 마지막으로 화면에 그린 우리 팀 명단.
   *
   * 전에는 **인원 수**만 봤다. 열한 명이 열한 명으로 유지되는 교체는
   * 인원도 포메이션도 안 바뀌므로 화면이 통째로 갱신되지 않았다 — 나간
   * 선수가 계속 뛰고 들어온 선수는 나타나지 않았다. 실측으로 경기의 76%
   * 동안 화면 명단과 시뮬 명단이 어긋나 있었다.
   */
  private lastLineup = ''
  /** 교체로 들어오는 선수가 처음 설 자리(터치라인). rebuild 가 읽어 간다 */
  private entryAt = new Map<string, { x: number; y: number }>()
  /**
   * 스로인을 던질 선수.
   *
   * 이 선수가 공을 내보낼 때는 **발이 아니라 손이다.** 표시가 없으면
   * 스로인이 평범한 패스가 되어 초속 26미터짜리 40미터 롱볼이 나온다.
   */
  private throwBy: string | null = null
  /** 시뮬 사건 기록을 어디까지 읽었는지 (반칙 → 프리킥) */
  private lastLogLen = 0
  /**
   * 이탈 기록을 어디까지 읽었는지.
   *
   * 반칙과 커서를 따로 쓴다. 이탈은 **대형을 다시 짜기 전에** 읽어야
   * 쓰러진 자리를 알 수 있고, 반칙은 세리머니 중에는 흘려보내야 한다.
   * 하나로 합치면 둘 중 하나가 반드시 틀린 자리에서 읽힌다.
   */
  private downLogLen = 0
  /** 관전 시계 (초). 추격조 유지 시간 계산에 쓴다 */
  private clock = 0
  /** 압박 게이지. 상대가 발밑에 붙어 있던 시간이 쌓인다 */
  private pressure = 0
  /**
   * 시뮬이 알린 슛인데 공이 아직 그 팀에게 없어 기다리는 중.
   *
   * **줄이지 하나가 아니다.** 실측으로 0.7초 간격으로 두 골이 들어간 판이
   * 있었는데, 자리가 하나뿐이라 뒤엣것이 앞엣것을 덮어써서 골 하나가
   * 화면에서 통째로 사라졌다.
   */
  private pending: Array<{
    side: 'HOME' | 'AWAY'
    willScore: boolean
    life: number
    /**
     * 유예가 끝났을 때 전개가 진행 중이면 빌려 쓸 수 있는 여유(초).
     *
     * 유예가 끝나는 순간 그 팀이 이미 상대 진영에서 공을 몰고 있는 경우가
     * 있다. 거기서 끊고 억지로 골을 만들면 방금까지 쌓아온 장면을 버리고
     * 공을 순간이동시키게 된다. 몇 초만 더 주면 제대로 된 골이 된다
     */
    extra: number
  }> = []
  private chaseIds: Record<'HOME' | 'AWAY', string[]> = { HOME: [], AWAY: [] }
  private chaseAt: Record<'HOME' | 'AWAY', number> = { HOME: -9, AWAY: -9 }
  /**
   * 이 시간이 남아 있는 동안은 오프사이드를 불지 않는다(초).
   *
   * 재개(스로인·골킥·코너킥)에서 직접 받는 공과 킥오프가 여기 걸린다.
   * 규칙이 그렇다. 이걸 안 두면 코너킥마다 깃발이 올라간다 — 코너킥은
   * 정의상 공보다 앞에 사람이 잔뜩 서 있는 상황이다.
   */
  private offsideMute = OFFSIDE_MUTE
  /** 깃발은 올라갔지만 아직 휘슬이 안 분 상태. 공이 멎으면 분다 */
  private flagged: { against: 'HOME' | 'AWAY'; by: Official['kind'] } | null = null
  /** 이 경기에서 분 오프사이드 횟수. 빈도를 재는 데 쓴다 */
  offsideCount = 0
  /** 상대가 범한 반칙과 그 때문에 나온 경고. 빈도를 재는 데 쓴다 */
  awayFouls = 0
  awayCards = 0
  /** 재개 직후 이 시간 동안은 반칙을 불지 않는다(초). `FOUL_MUTE` 참조 */
  private foulMute = 0

  constructor(state: MatchState, seed: number) {
    this.rng = createRng((seed ^ 0x5bf03635) >>> 0)
    this.ball = {
      x: PITCH_W / 2,
      y: PITCH_H / 2,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      mode: 'HELD',
      holder: null,
      fromX: 0,
      fromY: 0,
      toX: 0,
      toY: 0,
      targetId: null,
      kickerId: null,
      selfLock: 0,
      willScore: false,
      lastTouch: 'HOME',
      kick: 'PASS',
    }
    this.rebuild(state)
    this.lastScore = [...state.score] as [number, number]
    this.displayScore = [...state.score] as [number, number]
    this.lastStats = { homeShot: state.stats.homeShot, awayShot: state.stats.awayShot }
    this.lastOwner = state.ball.owner
    // 경기는 킥오프로 시작한다.
    //
    // 전에는 미드필더 하나가 아무 자리에서 공을 들고 서 있는 것으로
    // 시작했고, 시작 순간에 네 명이 하프라인 너머에 있었다. 심사자가
    // 처음 보는 3초다 — 그 장면이 축구가 아니면 나머지도 안 믿는다
    this.kickoff('HOME')
  }

  /** 지금 피치 위 우리 선수의 화면 id 목록 */
  private lineupOf(state: MatchState): string[] {
    return state.players
      .filter((s) => s.onPitch && !s.out)
      .map((s) => `H${getPlayer(s.id).num}`)
  }

  /** 명단·포메이션이 바뀌면 자리를 다시 만든다 */
  private rebuild(state: MatchState) {
    const onPitch = state.players.filter((s) => s.onPitch && !s.out)
    /**
     * 자리 수는 실제 인원을 넘지 않는다.
     *
     * 열 명용 배치는 자리가 열 개다. 부상이나 추가 퇴장으로 아홉 명이
     * 되면 남는 자리에 **등번호 0번인 유령이 그려졌다.** 화면에서 실제로
     * 봤다 — 우리 팀이 열 명이라고 적혀 있는데 피치에는 0번이 뛰고 있었다.
     */
    const slots = slotsForPlayers(
      state.formation,
      onPitch.map((s) => getPlayer(s.id).pos),
    )
    const currentSlotKey = formationSlotKey(slots)

    const keep = new Map(this.players.map((p) => [p.id, p]))
    const next: VPlayer[] = []

    /**
     * 자리 나누기.
     *
     * 전에는 `onPitch[i]` 를 `slots[i]` 에 붙였다 — **배열 순서**다.
     * 명단에서 빠진 선수는 배열에서 사라지고 새로 들어온 선수는 맨 뒤에
     * 붙으므로, 교체 한 번에 뒤쪽 선수 전원이 한 칸씩 밀려 대형이 통째로
     * 어긋났다. 이제 **뛰던 선수는 쓰던 자리를 그대로 지키고**, 빈자리는
     * 새로 들어온 선수가 받는다. 빈자리가 여럿이면 포지션이 맞는 자리를
     * 먼저 준다 — 수비수가 최전방 자리를 받으면 안 된다.
     */
    const previousSeats =
      this.lastFormation === state.formation && this.lastFormationSlots === currentSlotKey
        ? new Map(
            onPitch.flatMap((player) => {
              const previous = keep.get(`H${getPlayer(player.id).num}`)
              return previous ? [[player.id, previous.slot] as const] : []
            }),
          )
        : new Map<string, number>()
    const assigned = assignFormationSlots(
      onPitch,
      slots,
      (player) => getPlayer(player.id).pos,
      previousSeats,
    )

    assigned.placed.forEach(({ player: s, slot, slotIndex }) => {
      const num = getPlayer(s.id).num
      const id = `H${num}`
      const prev = keep.get(id)
      const base = s.position ?? slot
      const pos = effectivePos(s)
      // 새로 들어온 선수는 터치라인에서 걸어 들어온다
      const entry = this.entryAt.get(id)
      this.entryAt.delete(id)
      next.push({
        id,
        num,
        side: 'HOME',
        pos,
        x: prev?.x ?? entry?.x ?? base.x,
        y: prev?.y ?? entry?.y ?? base.y,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        tx: base.x,
        ty: base.y,
        stx: prev?.stx ?? entry?.x ?? base.x,
        sty: prev?.sty ?? entry?.y ?? base.y,
        slot: slotIndex,
        homeX: base.x,
        homeY: base.y,
        top: topSpeedOf(pos, abilityOf(s).speed),
        stamina: s.stamina,
        booked: s.booked,
        order: s.order,
        recover: prev?.recover ?? 0,
        effort: prev?.effort ?? 'JOG',
        settled: prev?.settled ?? false,
      })
    })

    /**
     * 상대 대형은 판마다 다르다(`state.away.formation`).
     * 좌표의 단일 원본은 `src/sim/awayShape.ts` 다 — 큰 경기장과 오른쪽
     * 상대 패널이 서로 다른 자리를 가리키면 둘 중 하나가 거짓말이 된다.
     */
    awaySlots(state.away.formation, state.awayCount).forEach(([pos, x, y, num], i) => {
      const id = `A${num}`
      const prev = keep.get(id)
      next.push({
        id,
        num,
        side: 'AWAY',
        pos,
        x: prev?.x ?? x,
        y: prev?.y ?? y,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        tx: x,
        ty: y,
        stx: prev?.stx ?? x,
        sty: prev?.sty ?? y,
        slot: i,
        homeX: x,
        homeY: y,
        // 상대는 등번호별 속도가 명단에 있다. 지어내지 않는다
        top: topSpeedOf(pos, AWAY_SPEED_BY_NUM.get(num) ?? 72),
        // 상대는 팀 하나의 체력을 쓴다. 개인별 값을 지어내지 않는다
        stamina: state.awayStamina,
        booked: state.away.booked.includes(num),
        // 지시는 우리 팀에게만 내린다
        order: 'NONE',
        recover: prev?.recover ?? 0,
        effort: prev?.effort ?? 'JOG',
        settled: prev?.settled ?? false,
      })
    })

    this.players = next
    this.lastFormation = state.formation
    this.lastFormationSlots = currentSlotKey
    this.lastLineup = this.lineupOf(state).join(',')
  }

  /** 시뮬 선수 id 로 화면 선수를 찾는다. 명단에 없으면 undefined */
  private numOf(simId: string): VPlayer | undefined {
    try {
      return this.byId(`H${getPlayer(simId).num}`)
    } catch {
      return undefined
    }
  }

  private byId(id: string | null): VPlayer | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined
  }

  private giveTo(p: VPlayer) {
    const b = this.ball
    // 공 주인이 바뀌면 스로인 예약은 사라진다. 재개할 때 다시 건다
    this.throwBy = null
    b.mode = 'HELD'
    b.holder = p.id
    b.targetId = null
    b.kickerId = null
    b.selfLock = 0
    b.lastTouch = p.side
    this.stopBall()
    // 주인이 바뀌었으니 압박은 처음부터 다시 쌓이고, 추격조도 새로 짠다
    this.pressure = 0
    this.chaseAt.HOME = -9
    this.chaseAt.AWAY = -9
    // 공을 잡는 순간 발밑으로 붙인다. 서서히 다가가게 두면 몇 프레임 동안
    // 공이 주인과 떨어져 있어 "누가 가진 건지" 알 수 없다.
    //
    // 붙이는 방향은 **공이 있던 쪽**이다. 진행 방향으로 붙이면 발 앞에서
    // 잡은 공이 몸 뒤로 순간이동한다
    const dx = b.x - p.x
    const dy = b.y - p.y
    const d = Math.hypot(dx, dy)
    if (d > 0.25) {
      b.x = p.x + (dx / d) * CONTROL_DIST
      b.y = p.y + (dy / d) * CONTROL_DIST
    } else {
      const dir = p.side === 'HOME' ? 1 : -1
      b.x = p.x + dir * CONTROL_DIST
      b.y = p.y
    }
    // 잡자마자 곧바로 내주지 않는다. 받아서 살피고 한두 번 터치한 뒤 준다.
    // 이 시간이 짧으면 공이 경기 내내 공중에 떠 있고, 수비수가 붙을
    // 틈도 없어 압박이 화면에 나타나지 않는다
    this.decideIn = 0.5 + this.rng.next() * 0.6
  }

  private flash(kind: Flash['kind'], x: number, y: number) {
    this.flashes.push({ kind, x, y, life: kind === 'GOAL' ? 1.4 : 0.55 })
  }

  /** 공을 세운다. 데드볼과 세리머니에서만 쓴다 — 살아 있는 공은 스스로 죽는다 */
  private stopBall() {
    const b = this.ball
    b.z = 0
    b.vx = 0
    b.vy = 0
    b.vz = 0
  }

  /**
   * 공을 찬다.
   *
   * 목표 지점을 향해 **속도를 준다.** 공은 그 지점에서 멈추는 것이 아니라
   * 그쪽으로 굴러가고, 아무도 받지 않으면 지나쳐 계속 흐른다. 이것이
   * 등속 이동과의 결정적 차이다.
   */
  private kickBall(
    from: VPlayer,
    tx: number,
    ty: number,
    speed: number,
    vz: number,
    mode: 'PASS' | 'SHOT',
    targetId: string | null,
    kind: VBall['kick'],
  ) {
    const b = this.ball
    const dx = tx - b.x
    const dy = ty - b.y
    const d = Math.hypot(dx, dy) || 1
    b.mode = mode
    b.holder = null
    b.fromX = b.x
    b.fromY = b.y
    b.toX = tx
    b.toY = ty
    b.vx = (dx / d) * speed
    b.vy = (dy / d) * speed
    b.vz = vz
    // 발등에 맞는 높이에서 출발한다
    b.z = 0.12
    b.targetId = targetId
    b.kickerId = from.id
    b.selfLock = 0.5
    b.lastTouch = from.side
    b.kick = kind
    if (mode !== 'SHOT') b.willScore = false
  }

  /**
   * 롱볼의 수직 속도.
   *
   * 40미터를 초속 24미터로 보내면 1.7초가 걸린다. 그동안 공이 떠 있으려면
   * 수직 초속이 g·t/2 = 8m/s 여야 한다. 짧은 패스는 땅볼로 간다.
   */
  private loftFor(d: number, speed: number) {
    if (d < 24) return 0
    return clamp((GRAVITY * (d / speed)) / 2, 0, 9)
  }

  /**
   * 시뮬레이션 상태를 읽어 연출을 맞춘다.
   *
   * 시뮬이 결정한 것: 누가 공을 가졌는지(팀 단위), 슛이 나왔는지, 골이
   * 들어갔는지. 그것을 실제 장면으로 옮기는 것이 여기 할 일이다.
   */
  sync(state: MatchState) {
    this.simTick = state.tick
    /**
     * 종료 휘슬 — 점수판을 시뮬에 맞춘다.
     *
     * 750틱이 끝나면 화면도 멈춘다. 미뤄둔 골이 남아 있으면 그 장면은
     * 영영 안 나오는데, 그렇다고 숫자까지 안 오르면 시뮬의 결과와 화면이
     * 어긋난 채로 경기가 끝난다. 장면을 놓치는 것보다 점수가 틀리는 것이
     * 훨씬 나쁘다. 아래 `queueShot` 이 남은 시간을 보고 유예를 잘라서
     * 여기까지 오는 일 자체가 거의 없게 해둔다
     */
    if (state.tick >= TOTAL_TICKS) {
      /**
       * 종료 직전까지 장면을 못 만든 골도 소리 사건에서는 잃지 않는다.
       *
       * 종료 휘슬에서는 점수 정확성이 우선이라 화면 점수를 시뮬 점수로
       * 맞춘다. 전에는 숫자만 바뀌고 함성은 `requestAnimationFrame`
       * 전이에 매달려 사라질 수 있었다. 아직 보여주지 못한 골 수만큼
       * 같은 사건 장부에 남긴다.
       */
      while (this.displayScore[0] < state.score[0]) this.revealGoal('HOME')
      while (this.displayScore[1] < state.score[1]) this.revealGoal('AWAY')
      this.displayScore = [...state.score] as [number, number]
      // 이미 점수와 함성을 맞췄으므로 밀린 득점 슛이 다시 실행되면 안 된다
      this.pending = this.pending.filter((shot) => !shot.willScore)
      this.lastScore = [...state.score] as [number, number]
    }

    // 대형을 다시 짜기 전에 읽어야 한다. 다시 짜고 나면 빠진 선수가
    // 목록에서 사라져 어디에 쓰러졌는지 알 방법이 없다
    this.captureDowned(state)

    // **명단이 바뀌면** 다시 짠다. 인원 수만 보면 열한 명이 열한 명으로
    // 유지되는 교체를 놓친다 — 그게 "교체가 화면에 안 나온다"의 정체였다
    if (state.formation !== this.lastFormation || this.lineupOf(state).join(',') !== this.lastLineup) {
      this.rebuild(state)
    }

    const onPitch = state.players.filter((s) => s.onPitch && !s.out)
    const slots = slotsForPlayers(
      state.formation,
      onPitch.map((s) => getPlayer(s.id).pos),
    )

    // 체력·경고를 갱신한다. 지친 선수는 실제로 느려진다
    const byNum = new Map(onPitch.map((s) => [`H${getPlayer(s.id).num}`, s]))
    const lineShift = (state.tactics.line - 1) * 8
    /**
     * 폭 레버가 대형의 좌우를 정한다.
     *
     * 전에는 0.8 에서 시작해서, **좁게도 보통도 실제 대형보다 좁았다.**
     * 4-4-2 의 좌우 끝이 y=12·56 인데 0.8 을 곱하면 y=17.6·50.4 로
     * 들어와, 양쪽 터치라인 근처 11미터가 통째로 비었다. 그 상태에서는
     * 아무리 옆으로 벌리는 패스에 값을 줘도 갈 사람이 거기 없다.
     *
     * 보통(1)이 실제 대형과 거의 같도록 잡는다. 레버 세 단계의 차이는
     * 그대로 남는다 — 0.86 · 1.03 · 1.20.
     */
    const widthScale = 0.86 + state.tactics.width * 0.17
    for (const v of this.players) {
      if (v.side !== 'HOME') continue
      const s = byNum.get(v.id)
      if (!s) continue
      v.stamina = s.stamina
      v.booked = s.booked
      v.order = s.order
      v.pos = effectivePos(s)
      // 교체로 들어온 선수와 자리를 옮긴 선수도 자기 속도로 뛴다
      v.top = topSpeedOf(v.pos, abilityOf(s).speed)
      /**
       * 손으로 놓은 좌표가 이 선수의 기준 자리다.
       *
       * 포메이션·라인·폭은 직접 놓지 않은 선수들의 기본 대형을 정한다.
       * 자유 좌표 위에 그 이동을 다시 더하면 배치판에서 놓은 곳과 중앙
       * 경기장에서 서는 곳이 달라지고, 정확한 좌표를 읽는 엔진과도
       * 어긋난다. 그래서 자유 좌표가 있는 동안은 그 값을 그대로 쓴다.
       */
      if (s.position) {
        v.homeX = s.position.x
        v.homeY = s.position.y
        continue
      }
      // 수비라인·폭 설정을 자기 자리에 반영한다.
      // 자리는 배열 순서가 아니라 선수에게 붙어 있는 자리 번호로 찾는다
      const slot = slots[v.slot]
      if (!slot || slot.pos === 'GK') continue
      /**
       * 자리를 바꾸라는 지시는 **기준 자리 자체를 옮긴다.**
       *
       * 다른 지시들은 공을 어떻게 쫓을지만 바꾸므로 기준 자리가 그대로여도
       * 되지만, 내려서라·올라가라는 그 선수가 어느 줄에 서느냐를 바꾸는
       * 지시다. 시뮬은 이미 그 선수를 수비수(또는 공격수)로 세고 있는데
       * 화면에서 원래 자리에 서 있으면 감독이 무엇을 시켰는지 확인할 수
       * 없다. 22미터는 한 줄을 건너뛰기에 충분하고 대형이 무너지지는
       * 않는 폭이다.
       */
      const shift =
        v.order === 'DROP_BACK' ? -22 : v.order === 'PUSH_UP' ? 22 : 0
      v.homeX = clamp(slot.x + lineShift + shift, 12, 88)
      v.homeY = 34 + (slot.y - 34) * widthScale
    }
    const mood = state.opponent === 'ALL_OUT' ? -13 : state.opponent === 'PARK_BUS' ? 11 : 0
    for (const [pos, x, y, num] of AWAY_SHAPES[state.away.formation]) {
      const v = this.byId(`A${num}`)
      if (!v) continue
      v.homeX = pos === 'GK' ? x : x + mood
      v.homeY = y
    }

    // 세리머니 중에는 새 슛을 받지 않는다. 밀린 슛이 재개 직후 한꺼번에
    // 터지면 그림이 엉킨다.
    //
    // 다만 **득점은 버리지 않는다.** lastScore 를 여기서 갱신하면 세리머니
    // 도중에 들어온 골이 조용히 사라져 점수판만 혼자 올라간다. 실측으로
    // 세 판에 골 셋 중 하나가 그렇게 없어졌다
    if (this.celebration) {
      this.lastStats = { homeShot: state.stats.homeShot, awayShot: state.stats.awayShot }
      this.lastOwner = state.ball.owner
      // 세리머니 중에 난 반칙은 흘려보낸다. 밀렸다가 재개 직후에 한꺼번에
      // 프리킥으로 터지면 무슨 일이 일어난 건지 알 수 없다
      this.lastLogLen = state.log.length
      return
    }

    this.syncFouls(state)

    const scored = state.score[0] - this.lastScore[0]
    const conceded = state.score[1] - this.lastScore[1]
    const newHomeShot = state.stats.homeShot - this.lastStats.homeShot
    const newAwayShot = state.stats.awayShot - this.lastStats.awayShot
    this.lastScore = [...state.score] as [number, number]
    this.lastStats = { homeShot: state.stats.homeShot, awayShot: state.stats.awayShot }

    // 골 — 시뮬이 점수를 올렸으면 실제로 골망에 꽂히는 슛을 만든다.
    // 여기서 바로 킥오프로 넘기면 골이 사건으로 보이지 않는다
    if (scored > 0 || conceded > 0) {
      /**
       * 숨긴 탭에서 시뮬이 여러 틱을 한 번에 따라오면 한 번의 `sync`에
       * 골이 둘 이상 들어올 수 있다. 합계가 늘었다는 사실을 한 장면으로
       * 뭉개면 뒤 골의 함성과 점수 장면이 사라진다.
       */
      for (let i = 0; i < scored; i++) this.queueShot('HOME', true)
      for (let i = 0; i < conceded; i++) this.queueShot('AWAY', true)
      // 여기서 돌아가지 않는다. 시뮬이 골이라고 했다는 것은 시뮬에서 그
      // 팀이 공을 가졌다는 뜻이다. 화면의 공이 아직 반대편에 있으면 아래
      // 점유 전환으로 넘겨줘야 그 팀이 골대로 밀고 갈 수 있다
    }

    // 슛 — 시뮬이 슈팅 상황을 셌으면 골대로 차되 막히거나 빗나간다
    if (newHomeShot > 0 || newAwayShot > 0) {
      this.queueShot(newHomeShot > 0 ? 'HOME' : 'AWAY', false)
    }

    /**
     * 시뮬이 말하는 소유 팀. 화면은 이걸 따라가야 한다.
     *
     * **단, 골이 예약돼 있으면 따라가지 않는다.** 시뮬은 득점한 그 틱에
     * 이미 킥오프 상태로 넘어가 공 주인을 **먹힌 팀**으로 바꿔버린다.
     * 그대로 따라가면 화면은 골을 그려야 할 팀에게서 공을 도로 빼앗고,
     * 예약된 골은 밀고 갈 공이 없어 결국 골망 장면으로 때워진다.
     * 화면이 그 골을 다 그릴 때까지는 득점 팀이 공을 가지고 있어야 한다
     */
    const scoring = this.pending.find((q) => q.willScore)
    this.simOwner = scoring ? scoring.side : state.ball.owner

    // 점유 전환 — 가장 가까운 상대가 뺏는 장면으로 만든다
    if (state.ball.owner !== this.lastOwner) {
      this.lastOwner = state.ball.owner
      if (!scoring) this.takeOver(state.ball.owner)
    }
  }

  /**
   * 부상·퇴장으로 빠진 선수를 화면에 잠시 남긴다.
   *
   * 시뮬은 그 틱에 즉시 선수를 지운다. 그대로 두면 화면에서 사람이 소리
   * 없이 없어지고, 관전자는 우리가 열 명이 된 것도 모른 채 경기를 본다.
   * 실제 중계는 그 반대다 — 쓰러진 선수가 화면의 중심이 된다.
   */
  private captureDowned(state: MatchState) {
    for (let i = this.downLogLen; i < state.log.length; i++) {
      const e = state.log[i]
      // 교체 — 나가는 선수는 걸어 나가고 들어오는 선수는 터치라인에서 들어온다
      if (e.kind === 'SUB' && e.detail) {
        this.beginSub(e.detail, e.target)
        continue
      }
      /**
       * 카드는 주심이 든다.
       *
       * 전에는 경고가 선수 원 옆에 배지로 **저절로** 붙었다. 배지는
       * "이 선수는 경고를 안고 있다"는 상태 표시로 계속 필요하지만,
       * 카드가 나오는 **그 순간**에 아무도 그것을 주지 않으면 심판이
       * 판정하는 사람으로 안 보인다. 주심이 그 자리로 가서 손에 든다.
       */
      if (e.kind === 'CARD' || e.kind === 'SEND_OFF') {
        const who = e.target ? this.numOf(e.target) : undefined
        if (who) this.blowWhistle('CARD', who.x, who.y, e.kind === 'SEND_OFF')
      }
      // 페널티킥도 주심이 준다. 지점을 가리키는 것이 판정 그 자체다
      if (e.kind === 'PENALTY') {
        const spot = this.ownGoalX('HOME')
        this.blowWhistle('PENALTY', spot + (spot === 0 ? 11 : -11), GOAL_MID)
      }
      if ((e.kind !== 'INJURY' && e.kind !== 'SEND_OFF') || !e.target) continue
      let v: VPlayer | undefined
      try {
        v = this.byId(`H${getPlayer(e.target).num}`)
      } catch {
        v = undefined
      }
      if (!v) continue
      // 부상은 들것이 들어온다. 퇴장은 걸어 나간다 — 조금 짧다
      const span = e.kind === 'INJURY' ? 3.4 : 2.6
      this.downed.push({
        id: v.id,
        num: v.num,
        side: v.side,
        x: v.x,
        y: v.y,
        kind: e.kind,
        life: span,
        span,
      })
    }
    this.downLogLen = state.log.length
  }

  /**
   * 공을 그 팀에게 넘긴다.
   *
   * 붙어 있으면 발밑에서 뺏는 장면, 멀면 터치가 길어 흘린 장면이 된다.
   * 공이 날아가는 중이거나 죽어 있으면 아무것도 하지 않는다 — 그때는
   * `reconcileOwner` 가 공이 잡히기를 기다렸다 다시 시도한다.
   */
  private takeOver(side: 'HOME' | 'AWAY'): boolean {
    const holder = this.byId(this.ball.holder)
    if (this.ball.mode !== 'HELD' || !holder || holder.side === side) return false
    // 골키퍼가 손으로 잡은 공은 뺏을 수 없다. 곧 차낸다
    if (holder.pos === 'GK') return false
    const taker = this.nearestOf(side, holder)
    if (!taker) return false
    if (dist(taker, holder) <= TACKLE_REACH) {
      this.flash('TACKLE', this.ball.x, this.ball.y)
      holder.recover = 0.5
      this.giveTo(taker)
    } else {
      this.spill(holder, taker)
    }
    return true
  }

  /**
   * 화면의 공 주인을 시뮬에 맞춘다.
   *
   * 전에는 시뮬의 소유 팀이 **바뀌는 순간에만** 화면을 맞췄고, 그때 공이
   * 날아가는 중이거나 죽어 있으면 그 전환을 그냥 버렸다. 공은 경기의
   * 40%를 공중에서 보내므로 전환의 상당수가 조용히 사라졌고, 화면과 시뮬의
   * 소유 팀이 **경기의 40% 동안 서로 달랐다**(실측 일치율 60.3%).
   *
   * 그래서 시뮬이 "이 팀이 골"이라고 알린 순간 화면에서는 그 팀이 반대편
   * 골문 앞에서 수비를 하고 있었고, 연출은 슛을 만들 수가 없어 골 넷 중
   * 셋을 슛 없이 골망 장면으로 때웠다. 사용자가 본 "갑작스러운 득점"이
   * 이것이다.
   *
   * 이제 어긋난 채로 흐른 시간을 재서, 잠깐이면 화면의 자체 판단(태클·
   * 인터셉트)을 존중하고 길어지면 시뮬 쪽으로 되돌린다. 매 프레임 강제로
   * 맞추면 화면에서 방금 뺏은 공이 곧바로 되돌아가 태클이 무의미해진다.
   */
  private reconcileOwner(dt: number) {
    const holder = this.byId(this.ball.holder)
    if (this.ball.mode !== 'HELD' || !holder || holder.side === this.simOwner) {
      this.ownerDrift = 0
      return
    }
    if (holder.pos === 'GK') return
    this.ownerDrift += dt
    if (this.ownerDrift < OWNER_GRACE) return
    if (this.takeOver(this.simOwner)) this.ownerDrift = 0
  }

  /**
   * 교체 장면을 시작한다.
   *
   * 시뮬은 대기 6초가 지난 그 틱에 명단을 바꿔버린다. 그대로 그리면
   * 선수가 그 자리에서 소리 없이 다른 사람으로 바뀐다. 실제 축구는
   * 경기가 멈추고, 나가는 선수가 걸어 나가고, 들어오는 선수가 들어온다.
   *
   * 멈추는 시간은 **1.2초**다. 근거: 이 화면은 게임 내 15분을 75초로
   * 압축하므로 압축비가 12:1이고, 실제 교체 20~30초는 2초 남짓이다.
   * 그런데 교체 카드가 세 장이라 2초씩이면 6초, 75초의 8%가 죽는다.
   * 공이 발에 있는 시간이 이 화면의 생명이라 1.2초로 잡았다(세 장 = 4.8%).
   */
  private beginSub(outId: string, inId: string | undefined) {
    let out: VPlayer | undefined
    try {
      out = this.byId(`H${getPlayer(outId).num}`)
    } catch {
      out = undefined
    }
    if (!out) return
    // 가까운 터치라인으로 걸어 나간다
    const ty = out.y < PITCH_H / 2 ? -1.5 : PITCH_H + 1.5
    this.leaving.push({
      num: out.num,
      x: out.x,
      y: out.y,
      tx: out.x,
      ty,
      life: 1.6,
      span: 1.6,
    })
    if (inId) {
      try {
        const num = getPlayer(inId).num
        // 들어오는 선수는 나간 선수가 나간 그 자리로 들어온다
        this.entryAt.set(`H${num}`, { x: out.x, y: clamp(ty, 0.6, PITCH_H - 0.6) })
        this.entering.push(num)
      } catch {
        /* 명단에 없는 선수는 무시한다 */
      }
    }
    this.subPause = 1.2
  }

  /**
   * 반칙을 프리킥으로 옮긴다.
   *
   * 시뮬은 반칙을 세고 경고와 퇴장까지 처리하지만, 화면에서는 아무 일도
   * 일어나지 않았다. 통계로만 존재하는 반칙은 관전자에게는 없는 일이다.
   * 실제 축구는 반칙이 나면 휘슬이 울리고 그 자리에서 다시 시작한다.
   */
  private syncFouls(state: MatchState) {
    for (let i = this.lastLogLen; i < state.log.length; i++) {
      const e = state.log[i]
      if (e.kind !== 'FOUL' || !e.target) continue
      // 이미 공이 죽어 있으면 반칙이 날 수 없다. 여기서 또 걸면 재개를
      // 기다리던 공이 반칙 지점으로 순간이동한다
      if (this.restart) continue
      // 슛이 날아가는 중이면 휘슬을 불지 않는다. 어드밴티지다.
      // 실측으로 골대로 향하던 득점 슛이 반칙 휘슬에 가로채여 통째로
      // 사라졌다 — 점수판만 오르고 화면에는 아무 일도 없었다
      if (this.ball.mode === 'SHOT' || this.pending.some((q) => q.willScore)) continue
      // 페널티로 이어진 반칙은 득점 쪽으로 처리된다. 여기서 또 멈추면
      // 골 장면과 프리킥이 겹친다
      if (state.log.some((x) => x.tick === e.tick && x.kind === 'PENALTY')) continue
      let at: VPlayer | undefined
      try {
        at = this.byId(`H${getPlayer(e.target).num}`)
      } catch {
        at = undefined
      }
      // 반칙은 우리 선수가 범한다. 차는 쪽은 상대다
      if (at) this.beginRestart('FREE_KICK', 'AWAY', clamp(at.x, 2, PITCH_W - 2), clamp(at.y, 2, PITCH_H - 2))
    }
    this.lastLogLen = state.log.length
  }

  /**
   * 공을 흘린다.
   *
   * 뺏는 선수가 발이 닿지 않는 거리에 있을 때 쓴다. 공이 홀더 발밑에서
   * 상대 쪽으로 굴러가고, 상대가 달려가서 줍는다. 실제 축구의 "터치가
   * 길어 뺏겼다"에 해당한다.
   */
  private spill(holder: VPlayer, to: VPlayer) {
    /**
     * ★ **상대 발밑을 겨누지 않는다.**
     *
     * 사용자 지적이다 — *"패스는 아주 낮은 확률로 상대편에게 하는걸로 해줘
     * 보니까 너무 패스를 상대방에 난발하는거 같아"*.
     *
     * 전에는 `to.x + to.vx * 0.3` 이었다. **동료에게 리드 패스를 넣는 것과
     * 똑같은 계산**을 상대에게 하고 있었다. 실측으로 조준점이 가장 가까운
     * 상대의 1.1m 앞(중앙값)이었고, 55.7%가 1.2m 안이었으며, 상대가 0.48초
     * 만에 90%를 회수했다. 판당 4.67회. 화면에는 하얀 점선까지 그려져서
     * "우리 선수가 상대에게 정확히 굴려줬다"로 보인다.
     *
     * 게다가 이건 붙지도 않은 상대에게 한다 — 흘리는 순간 가장 가까운
     * 상대가 중앙값 7.2m 떨어져 있고, 42.9%는 8m 안에 아무도 없었다.
     *
     * 실제 축구의 "터치가 길어 뺏겼다"는 공이 **발에서 벗어나 빈 곳으로
     * 굴러가고** 상대가 달려와 잡는 것이다. 그래서 상대 쪽으로 굴리되
     * **발밑까지 배달하지 않고 그 앞에서 멈춘다.** 상대가 나와야 잡는
     * 자리이며, 이는 빗나간 패스를 7/29에 고친 방식과 같은 원리다.
     */
    const dx = to.x - holder.x
    const dy = to.y - holder.y
    const d = Math.hypot(dx, dy) || 1
    // 상대에게 닿기 전에 멈춘다. 너무 짧으면 홀더가 도로 줍는다
    const reach = clamp(d - SPILL_GAP, 2.5, d)
    /**
     * 정확히 일직선이면 그것대로 겨눈 것처럼 보인다. 옆으로 흩는다.
     *
     * ★ **난수를 새로 뽑지 않는다.** 연출 난수(`this.rng`)는 경기 결과를
     * 바꾸지는 않지만, 한 번 더 뽑으면 이후 수열이 통째로 밀려 같은 시드의
     * 화면이 달라진다. 실제로 그렇게 했다가 스로인 거리·슛 거리·오프사이드
     * 빈도·골 함성 검사 넷이 한꺼번에 깨졌다. 그래서 자리 좌표에서
     * 결정적으로 만든다 — 같은 상황은 언제나 같은 방향으로 흩어진다.
     */
    const mix = ((Math.round(holder.x * 100) * 73856093) ^ (Math.round(holder.y * 100) * 19349663)) >>> 0
    const ang = ((mix % 2000) / 2000 - 0.5) * SPILL_SCATTER
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const ux = (dx / d) * cos - (dy / d) * sin
    const uy = (dx / d) * sin + (dy / d) * cos
    const tx = clamp(holder.x + ux * reach, 2, PITCH_W - 2)
    const ty = clamp(holder.y + uy * reach, 2, PITCH_H - 2)
    // 흘린 공은 세게 차인 것이 아니다. 느리게 굴러가 상대가 달려와 줍는다
    this.kickBall(holder, tx, ty, 7 + this.rng.next() * 4, 0, 'PASS', to.id, 'SPILL')
    holder.recover = 0.35
    this.flash('TACKLE', this.ball.x, this.ball.y)
  }

  /**
   * 슛 예약.
   *
   * 시뮬은 "이 팀이 슛을 쐈다"만 알려준다. 그 순간 공이 상대 발밑에 있으면
   * 곧바로 쏠 수 없다 — 슈터에게 공을 순간이동시켜야 하는데, 공이 30미터를
   * 날아가 갑자기 슛이 되는 장면은 축구가 아니다. 그 팀이 공을 잡을 때까지
   * 기다렸다 쏜다.
   */
  private queueShot(side: 'HOME' | 'AWAY', willScore: boolean) {
    if (willScore) {
      // 빗나갈 슛을 골보다 먼저 처리할 이유가 없다. 점수판은 이미 올라갔다
      this.pending = this.pending.filter((q) => q.willScore)
    } else if (this.pending.length) {
      return
    }
    /**
     * 공격을 만들 시간을 확보한다.
     *
     * 전에는 4.2초였다. 점수판이 이미 올라간 뒤라 장면을 더 미룰 수가
     * 없었기 때문이다. 이제 점수판이 장면을 기다리므로(`displayScore`)
     * 진짜 공격 하나를 만들 만큼 넉넉히 잡는다.
     *
     * 다만 **종료 휘슬 뒤에는 화면이 멈춘다.** 남은 경기 시간보다 긴
     * 유예를 잡으면 미뤄둔 골이 화면에 영영 안 나오고 점수판만 끝에서
     * 훌쩍 뛴다. 세리머니 1.5초까지 감안해 2.5초를 남긴다
     */
    /**
     * 골이 예약됐는데 프리킥을 기다리는 중이면 **빨리 찬다.**
     *
     * 벽을 다 세우는 시간이 골 장면을 만들 예산을 먹는다. 실제 축구에서도
     * 급한 팀은 벽을 기다리지 않고 빨리 재개한다.
     */
    if (willScore && this.restart) this.restart.wait = Math.min(this.restart.wait, 0.2)
    const left = (TOTAL_TICKS - this.simTick) * 0.1 - 2.5
    const life = willScore ? clamp(Math.min(GOAL_RUNWAY, left), 0, GOAL_RUNWAY) : 1.8
    this.pending.push({ side, willScore, life, extra: willScore ? GOAL_EXTRA : 0 })
    const holder = this.byId(this.ball.holder)
    if (
      this.ball.mode === 'HELD' &&
      holder &&
      this.readyToScore(side, willScore) &&
      this.canShoot(holder, side, this.pendingRange(willScore))
    ) {
      this.pending.pop()
      this.shoot(holder, willScore)
    }
  }

  /**
   * 지금 골을 넣어도 되는가 — 앞에 전개가 있었는가.
   *
   * 빗나갈 슛에는 걸지 않는다. 골만 "갑자기 터졌다"로 보인다
   */
  private readyToScore(side: 'HOME' | 'AWAY', willScore: boolean) {
    return !willScore || this.attackTime[side] >= BUILDUP
  }

  /**
   * 이 팀이 지금 상대 진영에서 공을 쥐고 밀고 있는가.
   *
   * 골 앞의 전개를 세는 자다. 자기 진영으로 돌아가면 전개는 끊긴 것이라
   * 처음부터 다시 센다. 상대 진영인데 잠깐 공이 상대에게 가 있는 것은
   * 끊긴 것이 아니라 멈춘 것이므로 세지도 지우지도 않는다.
   */
  private updateAttackTime(dt: number) {
    for (const side of ['HOME', 'AWAY'] as const) {
      const inAttackHalf =
        side === 'HOME' ? this.ball.x > PITCH_W / 2 : this.ball.x < PITCH_W / 2
      if (!inAttackHalf) {
        this.attackTime[side] = 0
        continue
      }
      const holder = this.byId(this.ball.holder)
      const mine =
        this.ball.mode === 'HELD' ? holder?.side === side : this.ball.lastTouch === side
      if (mine) this.attackTime[side] += dt
    }
  }

  /**
   * 지금 이 선수가 슛을 쏠 수 있는가.
   *
   * 골키퍼는 안 쏘고, 사정거리 밖에서도 안 쏜다. 자기 진영에서 상대
   * 골대를 향해 때리는 것은 축구가 아니라 걷어내기다.
   */
  private canShoot(p: VPlayer, side?: 'HOME' | 'AWAY', range = SHOOT_RANGE) {
    if (side && p.side !== side) return false
    if (p.pos === 'GK') return false
    const gx = this.goalX(p.side)
    return Math.hypot(gx - p.x, GOAL_MID - p.y) <= range
  }

  /**
   * 시뮬이 예약한 슛을 쏠 수 있는 거리.
   *
   * 골은 조금 더 멀리서도 허용한다. 여기서 못 쏘면 슛 없이 골망 장면으로
   * 넘어가야 하는데, 38미터짜리 골은 드물어도 실재하는 반면 "슛이 없는 골"은
   * 관전자가 무슨 일이 일어났는지 모르는 장면이다.
   */
  private pendingRange(willScore: boolean) {
    return willScore ? LONG_SHOT_MAX : SHOOT_RANGE
  }

  /** 지금 날아가거나 굴러가는 공이 곧 경기장을 벗어나는가 */
  private ballIsLeavingField() {
    const b = this.ball
    if (b.mode === 'HELD') return false
    const x = b.x + b.vx * OUTBOUND_GUARD
    const y = b.y + b.vy * OUTBOUND_GUARD
    return x < 0 || x > PITCH_W || y < 0 || y > PITCH_H
  }

  private tryPendingShot(dt: number) {
    // 스로인·골킥·코너·프리킥을 준비하는 동안에는 골을 실행할 수 없다.
    // 호출부가 둘이라 한쪽만 막으면 공이 라인을 넘은 그 프레임의 마지막
    // 호출에서 다시 실행되므로, 예약 처리의 입구에서 함께 막는다.
    if (this.restart) return
    const q = this.pending[0]
    if (!q) return
    if (q.willScore && this.ballIsLeavingField()) return
    q.life -= dt
    /**
     * 골 예약이 걸린 팀이 공을 안 가지고 있으면 곧바로 넘겨준다.
     *
     * 시뮬에서는 이미 그 팀이 공을 몰고 가서 골을 넣었다. 유예를 주면
     * 상대가 그 공을 자기 진영으로 되돌려 전개가 매번 끊긴다 — 유예를
     * `reconcileOwner` 의 0.5초로 맡겨봤더니 세 기준을 다 넘긴 골이
     * 92.8%에서 85.7%로 내려갔고 점수판 지연은 4.5초에서 6.1초로 늘었다.
     *
     * 매 프레임 부르지만 공을 매 프레임 뺏는 것은 아니다. `takeOver` 는
     * 공이 누군가의 발밑에 있을 때만 움직이고, 붙어 있으면 태클로
     * 멀면 흘린 공으로 그린다. 상대가 다시 주울 때마다 한 번씩 걸린다
     */
    if (q.willScore) this.takeOver(q.side)
    const holder = this.byId(this.ball.holder)
    if (
      this.ball.mode === 'HELD' &&
      holder &&
      this.readyToScore(q.side, q.willScore) &&
      this.canShoot(holder, q.side, this.pendingRange(q.willScore))
    ) {
      this.pending.shift()
      this.shoot(holder, q.willScore)
      return
    }
    if (q.life > 0) return

    /**
     * 유예가 끝났는데 전개가 한창이면 조금만 더 기다린다.
     *
     * 이 팀이 지금 상대 진영에서 공을 몰고 있다는 것은 몇 초 뒤에 제대로
     * 된 골이 나온다는 뜻이다. 여기서 끊으면 그 장면을 헐고 공을
     * 순간이동시켜야 한다. 빌릴 수 있는 여유는 한 번뿐이라 끝없이
     * 늘어지지 않는다
     */
    if (q.willScore && q.extra > 0 && this.attackTime[q.side] > 0) {
      // 여유는 **총량**이다. 쓴 만큼만 깎으므로, 전개가 한 번 끊겨도
      // 남은 만큼 다시 빌릴 수 있고 총 대기 시간은 여전히 묶여 있다
      const need = clamp(BUILDUP - this.attackTime[q.side] + 0.3, 0, q.extra)
      q.extra -= need
      q.life = need
      if (need > 0) return
    }

    this.pending.shift()
    // 기다려도 공이 오지 않는다. 빗나갈 슛이었다면 그냥 흘려보낸다 —
    // 안 보이는 슛 하나보다 공이 순간이동하는 장면이 훨씬 나쁘다
    if (!q.willScore) return

    /**
     * 골은 점수판이 이미 올라갔으므로 장면이 반드시 나와야 한다.
     *
     * 사정거리 안에 있는 선수를 먼저 찾는다. 그중에서도 공에 가까운
     * 선수여야 공이 적게 움직인다. 전에는 이 검사가 없어서 자기 진영에서
     * 60미터짜리 골이 나왔다
     */
    let shooter: VPlayer | undefined
    let bd = Infinity
    for (const p of this.players) {
      if (!this.canShoot(p, q.side, LONG_SHOT_MAX)) continue
      const d = dist(p, this.ball)
      if (d < bd) {
        bd = d
        shooter = p
      }
    }
    if (!shooter) {
      // 사정거리 안에 아무도 없다. 상대 골대에 가장 가까운 공격 자원이 쏜다.
      //
      // 여기서 "지금 공을 가진 선수"를 쓰면 안 된다. 그 선수가 자기 진영
      // 수비수일 수 있고, 실측으로 81미터짜리 골이 나왔다 — 공이 골대까지
      // 3.5초를 날아가 골 장면이 득점보다 6초 늦었다
      let bg = Infinity
      const gx = this.goalX(q.side)
      for (const p of this.players) {
        if (p.side !== q.side || p.pos === 'GK' || p.pos === 'DF') continue
        const d = Math.hypot(gx - p.x, GOAL_MID - p.y)
        if (d < bg) {
          bg = d
          shooter = p
        }
      }
    }
    // 골이 났으면 밖으로 나간 공을 다시 넣을 이유가 없다. 다음은 킥오프다
    this.restart = null
    const far = shooter
      ? Math.hypot(this.goalX(q.side) - shooter.x, GOAL_MID - shooter.y)
      : Infinity
    if (shooter && far <= LONG_SHOT_MAX) {
      this.giveTo(shooter)
      this.shoot(shooter, true)
      return
    }
    /**
     * 그 팀 선수가 아무도 골대 근처에 없다.
     *
     * 시뮬은 확률로 득점을 정하고, 그 순간 화면의 공은 반대편에 있을 수
     * 있다. 이때 억지로 슛을 만들면 80미터짜리 골이 나온다 — 실측으로
     * 공이 골대까지 3.5초를 굴러갔고 골 장면이 득점보다 6초 늦었다.
     *
     * 그럴 바에는 중계처럼 **골망이 흔들리는 장면으로 바로 넘어간다.**
     * 안 나오는 골보다 낫고, 있을 수 없는 슛보다도 낫다.
     */
    this.netGoal(q.side)
  }

  /** 슛 없이 골망 장면으로 넘어간다 */
  private netGoal(side: 'HOME' | 'AWAY') {
    const b = this.ball
    const gx = this.goalX(side)
    b.mode = 'LOOSE'
    b.holder = null
    b.targetId = null
    b.willScore = false
    this.stopBall()
    b.x = gx === GOAL_LINE_HOME ? PITCH_W + 0.8 : -0.8
    b.y = GOAL_MID + (this.rng.next() - 0.5) * 4
    b.lastTouch = side
    this.flash('GOAL', b.x, b.y)
    this.beginCelebration(side, b.x, b.y)
  }

  /**
   * 골 장면을 띄우고 **그때** 점수판을 올린다.
   *
   * 숫자와 장면이 같이 움직여야 관전자가 둘을 하나의 사건으로 읽는다.
   * 시뮬의 점수는 여기서 건드리지 않는다 — 승패 판정은 시뮬 것만 쓴다
   */
  private beginCelebration(side: 'HOME' | 'AWAY', x: number, y: number) {
    // 75초짜리 경기다. 세리머니가 길면 플레이 시간을 잡아먹는다
    this.celebration = { side, life: 1.5, x, y }
    this.revealGoal(side)
  }

  /** 화면 점수와 골 함성 사건을 반드시 같은 문에서 올린다 */
  private revealGoal(side: 'HOME' | 'AWAY') {
    if (side === 'HOME') this.displayScore[0] += 1
    else this.displayScore[1] += 1
    this.audioCues.push({ sequence: this.nextAudioSequence++, kind: 'GOAL', side })
  }

  private nearestOf(side: 'HOME' | 'AWAY', to: { x: number; y: number }): VPlayer | undefined {
    let best: VPlayer | undefined
    let bd = Infinity
    for (const p of this.players) {
      if (p.side !== side || p.pos === 'GK') continue
      const d = dist(p, to)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }

  /**
   * 중앙 킥오프.
   *
   * 축구 규칙대로 **먹힌 팀이 센터서클에서 다시 시작한다.** 전원이 자기
   * 진영으로 돌아가고, 차는 선수만 센터서클에 선다.
   */
  private kickoff(side: 'HOME' | 'AWAY') {
    // 킥오프 직후 첫 패스에는 깃발이 올라가지 않는다. 전원이 자기 진영에
    // 있어 애초에 성립하지 않지만, 배후로 찔러 넣는 첫 공에는 걸릴 수 있다
    this.offsideMute = OFFSIDE_MUTE
    // 킥오프는 주심의 휘슬로 시작한다
    this.blowWhistle('KICKOFF', PITCH_W / 2, PITCH_H / 2)
    for (const p of this.players) {
      p.x = p.homeX
      p.y = p.homeY
      p.vx = 0
      p.vy = 0
      p.recover = 0
      // 킥오프 순간에는 양 팀이 하프라인을 넘지 않는다
      if (p.side === 'HOME' && p.x > PITCH_W / 2 - 2) p.x = PITCH_W / 2 - 2 - (p.x - PITCH_W / 2) * 0.3
      if (p.side === 'AWAY' && p.x < PITCH_W / 2 + 2) p.x = PITCH_W / 2 + 2 + (PITCH_W / 2 - p.x) * 0.3
      p.x = clamp(p.x, 2, PITCH_W - 2)
      p.tx = p.x
      p.ty = p.y
      p.stx = p.x
      p.sty = p.y
    }
    this.ball.x = PITCH_W / 2
    this.ball.y = PITCH_H / 2
    this.ball.mode = 'HELD'
    this.stopBall()
    // 중앙에서 다시 시작한다. 전개는 여기서 끊긴 것이므로 처음부터 센다
    this.attackTime.HOME = 0
    this.attackTime.AWAY = 0
    // 재개 시점에 밀려 있던 빗나갈 슛은 버린다. 골 예약은 반드시 장면이
    // 나와야 하므로 살려두되 기다리는 시간을 다시 준다
    this.pending = this.pending.filter((q) => q.willScore)
    const left = (TOTAL_TICKS - this.simTick) * 0.1 - 2.5
    for (const q of this.pending) {
      q.life = clamp(Math.min(GOAL_RUNWAY, left), 0, GOAL_RUNWAY)
      q.extra = GOAL_EXTRA
    }
    // 킥오프가 아웃 재개보다 우선한다
    this.restart = null

    const taker = this.nearestOf(side, { x: PITCH_W / 2, y: PITCH_H / 2 })
    if (taker) {
      // 차는 선수만 센터서클 안으로 들어온다
      taker.x = PITCH_W / 2 - (side === 'HOME' ? 1.5 : -1.5)
      taker.y = PITCH_H / 2
      this.giveTo(taker)
    }
  }

  /**
   * 공이 밖으로 나갔는지 본다.
   *
   * 규칙 그대로다. 터치라인을 넘으면 마지막에 찬 팀의 상대가 스로인.
   * 골라인을 넘으면, 찬 팀이 상대 골라인 밖으로 낸 것이면 골킥이고
   * 자기 골라인 밖으로 낸 것이면 코너킥이다.
   */
  private checkOut(): boolean {
    const b = this.ball
    const kicker = b.lastTouch
    const other: 'HOME' | 'AWAY' = kicker === 'HOME' ? 'AWAY' : 'HOME'

    if (b.y < 0 || b.y > PITCH_H) {
      this.beginRestart('THROW_IN', other, clamp(b.x, 2, PITCH_W - 2), b.y < 0 ? 0 : PITCH_H)
      return true
    }
    if (b.x >= 0 && b.x <= PITCH_W) return false

    // 이 팀이 공격하는 골라인 밖으로 나갔으면 골킥, 자기 골라인이면 코너
    const attacking = this.goalX(kicker)
    const outAtAttackingEnd = attacking === GOAL_LINE_HOME ? b.x > PITCH_W : b.x < 0
    const line = b.x < 0 ? GOAL_LINE_AWAY : GOAL_LINE_HOME
    if (outAtAttackingEnd) {
      this.beginRestart('GOAL_KICK', other, 0, 0)
    } else {
      this.beginRestart('CORNER', other, line, b.y < PITCH_H / 2 ? 0 : PITCH_H)
    }
    return true
  }

  /**
   * 재개를 건다.
   *
   * 정지 시간은 짧다. 이 화면은 게임 내 15분을 75초로 압축해 보여주므로,
   * 실제 스로인이 걸리는 10초는 여기서 1초가 안 된다.
   */
  private beginRestart(kind: Restart['kind'], side: 'HOME' | 'AWAY', x: number, y: number) {
    // 골로 판정된 슛이 날아가는 중이면 아무것도 이 공을 가로채지 못한다.
    // 점수판은 이미 올라갔고, 이 공은 골망에 들어가야만 한다
    if (this.ball.mode === 'SHOT' && this.ball.willScore) return
    /**
     * 이미 재개를 기다리는 중이면 프리킥으로 덮어쓰지 않는다.
     *
     * 공이 이미 죽어 있는데 반칙 프리킥이 들어오면 놓여 있던 공이
     * 다른 자리로 순간이동한다. 실측으로 재개 대기 중 공이 1.4미터
     * 움직였고, 최악은 42미터였다. 축구에서도 공이 이미 아웃된 뒤에
     * 새 프리킥을 주지 않는다 — 앞의 재개가 먼저 끝난다.
     *
     * 스로인·골킥·코너는 공이 실제로 라인을 넘은 사실이라 덮어쓸 수
     * 있어야 한다. 위치를 지어내는 것은 프리킥뿐이다.
     */
    if (this.restart && kind === 'FREE_KICK') return
    let px = x
    let py = y
    if (kind === 'GOAL_KICK') {
      // 골 에어리어 안에서 찬다. 자기 골대 쪽이다
      const gl = this.goalX(side) === GOAL_LINE_HOME ? GOAL_LINE_AWAY : GOAL_LINE_HOME
      px = gl === GOAL_LINE_AWAY ? 5.5 : PITCH_W - 5.5
      py = GOAL_MID + (this.ball.y < PITCH_H / 2 ? -9 : 9)
    }
    const taker =
      kind === 'GOAL_KICK'
        ? this.players.find((p) => p.side === side && p.pos === 'GK')
        : this.nearestOf(side, { x: px, y: py })
    this.ball.mode = 'LOOSE'
    this.ball.holder = null
    this.ball.targetId = null
    this.ball.kickerId = null
    this.ball.selfLock = 0
    this.stopBall()
    this.ball.x = px
    this.ball.y = py
    const wall = kind === 'FREE_KICK' ? this.buildWall(side, px, py) : []
    /**
     * 정지 시간은 재개 종류가 정한다.
     *
     * 실제 축구가 그렇다. 스로인은 10초 안에 끝나지만 벽을 세우는
     * 프리킥은 20~40초가 걸린다. 이 화면은 15분을 75초로 압축하므로
     * 12분의 1이다. **벽이 다 서기 전에 공이 나가면 벽을 세운 의미가
     * 없다** — 걸어서 5미터를 가는 데 그만큼 걸린다.
     *
     * 데드볼 총량은 늘지 않았다. 재개 중 스무 명이 계속 뛰던 것을 멈춰
     * 세우니 공을 가지러 가는 선수의 길이 열려 재개 자체가 빨라졌다.
     */
    const wait = kind !== 'FREE_KICK' ? 0.35 : wall.length > 0 ? 0.95 : 0.5
    this.restart = { kind, side, x: px, y: py, wait, takerId: taker?.id ?? null, age: 0, wall }
    if (kind !== 'FREE_KICK') {
      this.audioCues.push({ sequence: this.nextAudioSequence++, kind: 'OUT' })
    }
    // 재개에서 직접 받는 공은 오프사이드가 아니다. 규칙이다
    this.offsideMute = OFFSIDE_MUTE
    this.foulMute = FOUL_MUTE
    /**
     * 누가 신호하는가.
     *
     * 프리킥은 주심의 휘슬이고, 스로인·코너·골킥은 부심의 깃발이다.
     * 오프사이드 프리킥은 `settleFlag` 가 이미 자기 휘슬을 불었으므로
     * 여기서 반칙으로 덮어쓰지 않는다.
     */
    if (kind === 'FREE_KICK') {
      if (this.whistle?.kind !== 'OFFSIDE') this.blowWhistle('FOUL', px, py)
    } else {
      this.flagRestart(px)
    }
  }

  /**
   * 프리킥 벽을 세운다.
   *
   * 경기 규칙 13조 그대로다. 벽은 **공과 자기 골문 중앙을 잇는 선 위**,
   * 공에서 9.15미터 지점에 그 선과 직각으로 선다. 골키퍼는 벽에 서지
   * 않는다 — 벽을 세우는 이유가 골문의 한쪽을 덮는 것인데 골키퍼가 나가
   * 서면 덮을 사람이 없다.
   */
  private buildWall(
    side: 'HOME' | 'AWAY',
    x: number,
    y: number,
  ): Array<{ id: string; x: number; y: number }> {
    const defending: 'HOME' | 'AWAY' = side === 'HOME' ? 'AWAY' : 'HOME'
    const goal = this.ownGoalX(defending)
    const toGoal = Math.hypot(goal - x, GOAL_MID - y) || 1
    const n = wallSize(toGoal)
    if (n <= 0) return []
    const ux = (goal - x) / toGoal
    const uy = (GOAL_MID - y) / toGoal
    const cx = x + ux * WALL_DISTANCE
    const cy = y + uy * WALL_DISTANCE
    return this.players
      .filter((p) => p.side === defending && p.pos !== 'GK')
      .sort((a, b) => dist(a, { x: cx, y: cy }) - dist(b, { x: cx, y: cy }))
      .slice(0, n)
      .map((p, i, arr) => {
        // 어깨를 붙이고 공-골문 선에 직각으로 늘어선다
        const off = (i - (arr.length - 1) / 2) * WALL_GAP
        return {
          id: p.id,
          x: clamp(cx - uy * off, 1, PITCH_W - 1),
          y: clamp(cy + ux * off, 1, PITCH_H - 1),
        }
      })
  }

  /**
   * 데드볼에 선수를 세운다.
   *
   * 급정거가 아니라 감속이다. 멈춘 뒤에는 지금 서 있는 자리를 자기
   * 목표로 삼아, 재개될 때 몸이 홱 꺾이지 않고 다시 출발한다.
   */
  private stand(p: VPlayer, dt: number) {
    const v = Math.hypot(p.vx, p.vy)
    if (v > 0.01) {
      const k = Math.max(0, v - DEAD_BALL_BRAKE * dt) / v
      p.vx *= k
      p.vy *= k
      p.x = clamp(p.x + p.vx * dt, 1, PITCH_W - 1)
      p.y = clamp(p.y + p.vy * dt, 1, PITCH_H - 1)
    } else {
      p.vx = 0
      p.vy = 0
    }
    p.effort = 'WALK'
    p.settled = true
    p.tx = p.x
    p.ty = p.y
    p.stx = p.x
    p.sty = p.y
  }

  /**
   * 재개를 진행한다.
   *
   * **휘슬이 울리면 먼저 모두가 선다**(`DEAD_BALL_FREEZE`). 그 뒤에도
   * 뛰는 사람은 공을 놓으러 가는 선수와 벽을 세우는 최소 인원, 그리고
   * 규칙상 9.15미터 밖으로 물러나야 하는 선수뿐이고, 나머지는 **걸어서**
   * 자리를 잡는다. 실제 축구의 데드볼이 그 모양이다.
   *
   * 전에는 재개를 기다리는 동안에도 전원에게 `setTargets` 와 `movePlayer`
   * 를 돌렸다. 실측으로 21명 중 15.0명이 계속 뛰었고 한 판에 348미터를
   * 데드볼 중에 이동했다 — 공만 멈추고 사람은 안 멈추니 경기가 멈췄다는
   * 것 자체가 화면에서 지워졌다.
   *
   * **끝까지 얼려두지는 않는다.** 대형이 휘슬 순간 모양 그대로 굳으면
   * 재개 뒤에 공격이 시작될 자리가 없어진다. 실측으로 우리 팀의 박스 안
   * 판단이 36판에 7회에서 0회로 사라졌다.
   */
  private updateRestart(state: MatchState, step: number) {
    const r = this.restart
    if (!r) return
    r.wait -= step
    r.age += step

    this.setTargets(state)
    /**
     * 골이 예약돼 있으면 **빨리 재개한다.**
     *
     * 화면은 골을 예약해두고 진짜 공격을 만든 뒤에 보여주는데, 데드볼
     * 동안에는 그 예약의 시계가 멈춘다(그래야 재개를 기다리던 공이
     * 골망으로 순간이동하지 않는다). 반칙이 늘면 그 멈춘 시간이 쌓여
     * 골 장면이 25초 창을 넘겨 사라진다 — 실측으로 서른아홉 골 중
     * 둘이 그렇게 없어졌다. 실제 축구에서도 급한 팀은 벽을 안 기다린다.
     */
    const hurry = this.pending.some((q) => q.willScore)
    if (hurry) r.wait = Math.min(r.wait, 0.1)
    const moving = new Set<string>()
    const taker = this.byId(r.takerId)
    if (taker) {
      taker.tx = r.x
      taker.ty = r.y
      taker.stx = r.x
      taker.sty = r.y
      // 공을 주우러 가는 길이다. 여기서 멈춰 서면 재개가 걸린다
      /**
       * 멀면 뛰어가서 줍는다.
       *
       * 공이 측면으로 더 자주 나가게 만들자 데드볼 비율이 15.2%까지
       * 올라갔다(상한 15%). 늘어난 것은 정지 시간이 아니라 **공을 주우러
       * 가는 거리**다. 실제 축구에서도 급하면 뛰어가서 줍는다.
       */
      taker.effort = hurry || dist(taker, r) > 7 ? 'SPRINT' : 'RUN'
      taker.settled = false
      moving.add(taker.id)
    }
    for (const w of r.wall) {
      const p = this.byId(w.id)
      if (!p || moving.has(p.id)) continue
      p.tx = w.x
      p.ty = w.y
      p.stx = w.x
      p.sty = w.y
      // 벽은 뛰어가서 서는 것이 아니라 걸어가서 줄을 맞춘다
      p.effort = 'JOG'
      p.settled = false
      moving.add(p.id)
    }
    /**
     * 9.15미터 안에 남은 상대는 물러난다.
     *
     * 벽에 서지 않은 선수도 규칙상 그 안에 있을 수 없다. 공이 라인을
     * 넘어 나간 스로인·골킥에는 이 거리가 없다.
     */
    if (r.kind === 'FREE_KICK') {
      const defending: 'HOME' | 'AWAY' = r.side === 'HOME' ? 'AWAY' : 'HOME'
      for (const p of this.players) {
        if (p.side !== defending || p.pos === 'GK' || moving.has(p.id)) continue
        const d = dist(p, r)
        if (d >= WALL_DISTANCE) continue
        const ux = (p.x - r.x) / (d || 1)
        const uy = (p.y - r.y) / (d || 1)
        p.tx = clamp(r.x + ux * WALL_DISTANCE, 1, PITCH_W - 1)
        p.ty = clamp(r.y + uy * WALL_DISTANCE, 1, PITCH_H - 1)
        p.stx = p.tx
        p.sty = p.ty
        p.effort = 'JOG'
        p.settled = false
        moving.add(p.id)
      }
    }

    /**
     * **휘슬이 울린 재개에서만 전원이 선다.**
     *
     * 사용자가 이름을 댄 것이 프리킥·파울·교체다. 스로인·골킥·코너킥은
     * 애초에 휘슬이 없고(부심이 깃발로 방향만 준다) 실제 축구에서도 그
     * 사이에 선수들이 계속 자리를 잡는다. 여기까지 얼리면 데드볼이
     * 경기의 흐름을 통째로 지운다 — 실측으로 우리 팀의 페널티 지역 안
     * 공격 판단이 150판에 25회에서 6회로 사라졌다.
     */
    const frozen = !hurry && r.kind === 'FREE_KICK' && r.age < DEAD_BALL_FREEZE
    for (const p of this.players) {
      if (moving.has(p.id) || !frozen) this.movePlayer(p, step)
      else this.stand(p, step)
    }
    this.separate()

    this.ball.x = r.x
    this.ball.y = r.y
    this.stopBall()

    if (r.wait > 0) return
    // 차는 선수가 공에 닿아야 재개된다. 아무도 못 가면(퇴장 등) 오래
    // 붙잡혀 있을 수 없으므로 보호 시간을 둔다
    if (taker && dist(taker, r) < (hurry ? 6 : 2.6)) {
      this.restart = null
      this.giveTo(taker)
      this.armThrow(r.kind, taker)
    } else if (r.age > (hurry ? 1.6 : 4)) {
      const alt = this.nearestOf(r.side, r) ?? taker
      this.restart = null
      if (alt) {
        this.giveTo(alt)
        this.armThrow(r.kind, alt)
      } else this.ball.mode = 'LOOSE'
    }
  }

  /** 스로인이면 다음 릴리스를 손으로 던지게 표시해둔다 */
  private armThrow(kind: Restart['kind'], taker: VPlayer) {
    if (kind !== 'THROW_IN') return
    this.throwBy = taker.id
    // 던지는 데 오래 안 걸린다. 라인 밖에 오래 서 있으면 대형이 어긋난다
    this.decideIn = 0.25 + this.rng.next() * 0.3
  }

  /**
   * 스로인을 받을 동료를 고른다.
   *
   * 던져서 닿는 거리여야 한다. 20미터 밖으로 던져놓고 아무도 못 받으면
   * 그건 스로인이 아니라 공을 버리는 것이다.
   */
  private chooseThrowTarget(thrower: VPlayer): VPlayer | null {
    const dir = thrower.side === 'HOME' ? 1 : -1
    let best: VPlayer | null = null
    let bestScore = -Infinity
    let nearest: VPlayer | null = null
    for (const p of this.players) {
      if (p.side !== thrower.side || p.id === thrower.id || p.pos === 'GK') continue
      const d = dist(p, thrower)
      if (!nearest || d < dist(nearest, thrower)) nearest = p
      // 실제 스로인 거리는 10~20미터다. 롱스로우도 30미터 남짓이다
      if (d < 5 || d > 20) continue
      const marker = this.players.reduce((m, o) => {
        if (o.side === thrower.side) return m
        return Math.min(m, dist(o, p))
      }, Infinity)
      const score = ((p.x - thrower.x) * dir) * 0.5 + Math.min(marker, 12) * 1.4 - d * 0.2
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    return best ?? nearest
  }

  /**
   * 스로인 — 발이 아니라 손이다.
   *
   * 두 손으로 머리 위에서 던지므로 발로 차는 것보다 확실히 느리고 가깝다.
   * 실제 스로인 거리는 10~20미터, 릴리스 속도는 초속 8~14미터다(패스는
   * 13~26미터다). 머리 위(2.1m)에서 놓으므로 낮은 포물선을 그린다.
   */
  private throwIn(thrower: VPlayer) {
    const to = this.chooseThrowTarget(thrower)
    if (!to) {
      this.decideIn = 0.3
      return
    }
    // 던진 공은 발로 찬 공만큼 정확하지 않다. 받는 선수 발밑을 노린다
    const tx = clamp(to.x + to.vx * 0.25, 1, PITCH_W - 1)
    const ty = clamp(to.y + to.vy * 0.25, 1, PITCH_H - 1)
    const d = Math.hypot(tx - thrower.x, ty - thrower.y)
    const speed = clamp(7 + d * 0.34, 8, 14)

    // 손을 떠나는 높이. 머리 위로 넘겨 던진다
    const release = 2.1
    const t = d / speed
    // 그 시간 안에 땅에 닿도록 수직 속도를 잡는다: release + vz·t − ½g·t² = 0
    const vz = clamp((GRAVITY * t * t * 0.5 - release) / Math.max(t, 0.2), 0, 7)

    // 던진 공도 100% 붙지는 않는다. 거리가 멀수록 나빠진다
    let targetId: string | null = to.id
    const ang = this.rng.next() * Math.PI * 2
    const off = 1.5 + this.rng.next() * 2.5
    let ax = tx
    let ay = ty
    if (this.rng.next() >= clamp(0.95 - Math.max(0, d - 8) * 0.012, 0.7, 0.95)) {
      ax = clamp(tx + Math.cos(ang) * off, -4, PITCH_W + 4)
      ay = clamp(ty + Math.sin(ang) * off, -4, PITCH_H + 4)
      targetId = null
    }

    this.kickBall(thrower, ax, ay, speed, vz, 'PASS', targetId, 'PASS')
    this.ball.z = release
  }

  /** 이 팀이 공격하는 골라인 */
  private goalX(side: 'HOME' | 'AWAY') {
    return side === 'HOME' ? GOAL_LINE_HOME : GOAL_LINE_AWAY
  }

  /** 이 팀이 지키는 골라인 */
  private ownGoalX(side: 'HOME' | 'AWAY') {
    return this.goalX(side === 'HOME' ? 'AWAY' : 'HOME')
  }

  /**
   * 이 자리가 `side` 의 페널티 지역 안인가.
   *
   * 오프사이드를 여기서는 보지 않는다. **정직하게 적어두는 한계다.**
   * 실제 수비진은 공격을 받으면 골 에어리어까지 물러나 골라인 5~6미터
   * 앞에 선다. 우리 수비 블록은 자기 자리에서 공 쪽으로 42%만 끌려오는
   * 모델이라, 상대가 박스 앞까지 밀고 들어와도 라인이 박스 **밖**
   * 83~86미터에 머문다.
   *
   * 그 상태에서 규칙을 그대로 적용하면 **"박스 안으로 주는 패스"가 곧
   * "오프사이드 패스"** 가 되어버린다. 실측으로 여섯 판 슛이 11회로
   * 줄고(기준 12), 슛 거리 중앙값이 32미터가 됐으며, 페널티 지역 안
   * 표본이 4회로 떨어졌다. 규칙을 지키려다 축구를 잃는다.
   *
   * 그래서 박스 안은 판정하지 않는다. 놓치는 것은 실제 오프사이드의
   * 일부이고, 얻는 것은 골대 앞 장면 전부다. 제대로 고치려면 수비
   * 블록이 자기 골대까지 물러나게 만들어야 하고, 그건 압박·태클·실점
   * 연출이 전부 걸린 대형 작업이라 마감 안에 재측정할 수 없다.
   */
  private inBoxOf(side: 'HOME' | 'AWAY', x: number) {
    return Math.abs(x - this.ownGoalX(side)) <= PENALTY_DEPTH
  }

  /**
   * 오프사이드 라인 — **뒤에서 두 번째 수비수**의 x 좌표.
   *
   * `side` 는 **지키는 팀**이다. 골키퍼도 수비수 중 하나로 센다. 실제
   * 규칙이 "마지막에서 두 번째 상대 선수"이지 "골키퍼 앞의 마지막
   * 수비수"가 아니기 때문이다 — 골키퍼가 뛰쳐나오면 필드 플레이어 하나가
   * 마지막이 되고 라인은 그 앞 선수에게 넘어간다.
   *
   * 사람이 둘도 안 남았으면(퇴장이 겹친 극단) 골라인을 라인으로 친다.
   * 그러면 아무도 앞설 수 없어 판정이 나오지 않는다 — 애매할 때 안 부는
   * 쪽으로 기운다.
   */
  offsideLine(side: 'HOME' | 'AWAY'): number {
    const own = this.ownGoalX(side)
    const depths: number[] = []
    for (const p of this.players) {
      if (p.side !== side) continue
      depths.push(Math.abs(p.x - own))
    }
    if (depths.length < 2) return own
    depths.sort((a, b) => a - b)
    const second = depths[1]
    return own === GOAL_LINE_AWAY ? second : own - second
  }

  /**
   * 지금 **수비하는** 팀.
   *
   * 오프사이드 라인은 언제나 수비하는 팀의 것이다. 공을 가진 팀의
   * 공격수가 넘으면 안 되는 선이므로, 화면에 그릴 선도 이 팀 것 하나다.
   * 둘 다 그리면 선이 넷(하프라인·수비라인 표시까지)이 되어 어느 것이
   * 무슨 뜻인지 읽을 수 없다.
   *
   * 공이 주인 없이 굴러가는 동안에는 **마지막으로 찬 팀**을 공격 팀으로
   * 본다. 그 순간마다 선이 반대편으로 튀면 눈이 따라가지 못한다.
   */
  defendingSide(): 'HOME' | 'AWAY' {
    const holder = this.byId(this.ball.holder)
    const attacking = holder?.side ?? this.ball.lastTouch
    return attacking === 'HOME' ? 'AWAY' : 'HOME'
  }

  /**
   * 부심이 서야 할 x.
   *
   * 뒤에서 두 번째 수비수와 나란히 서되, **공이 그보다 골라인에 가까우면
   * 공을 따라간다.** 실제 부심 지침 그대로다. 공이 이미 라인을 넘어간
   * 상황에서 부심이 뒤에 남아 있으면 골라인 판정을 볼 수 없다.
   */
  private arLine(side: 'HOME' | 'AWAY'): number {
    const own = this.ownGoalX(side)
    const line = this.offsideLine(side)
    const b = this.ball
    const deeper = Math.abs(b.x - own) < Math.abs(line - own) ? b.x : line
    return clamp(deeper, 0, PITCH_W)
  }

  /**
   * 심판 셋을 움직인다.
   *
   * **공에 절대 닿지 않는다.** 충돌도, 태클도, 난수 소비도 없다. 시뮬은
   * 이 셋이 있는지조차 모른다.
   *
   * 주심은 대각선으로 뛴다. 실제 주심은 공을 따라 직선으로 쫓지 않고
   * 한쪽 코너에서 반대 코너로 이어지는 대각선 위를 움직인다 — 그래야
   * 주심과 부심이 서로 반대편을 맡아 경기장 전체가 두 사람의 시야에
   * 들어온다. 공을 그대로 따라가게 만들면 주심이 늘 선수 무리 한가운데
   * 서서 스물세 번째 선수처럼 보인다.
   */
  private updateOfficials(step: number) {
    const b = this.ball
    for (const o of this.officials) {
      if (o.flag > 0) o.flag -= step

      let tx: number
      let ty: number
      let top: number
      if (o.kind === 'REFEREE') {
        /**
         * 주심은 **공에서 떨어져 선다.**
         *
         * 처음에는 공의 x를 그대로 따라가게 했더니 실측으로 공과 14센티
         * 까지 붙었다. 그건 심판이 아니라 스물세 번째 선수다. 실제 주심은
         * 공에서 15~20미터를 유지하고 패스 길을 막지 않는다.
         *
         * 서는 쪽은 **공의 반대쪽 절반**이다. 부심 둘이 각자 터치라인을
         * 맡고 있으므로 주심이 공 반대쪽에 서면 셋의 시야가 경기장을 다
         * 덮는다. 이것이 대각선 운영이고, 실제 주심 교육의 기본이다.
         */
        /**
         * 어느 쪽에 설지에는 **여유 구간을 둔다.**
         *
         * 공이 세로 중앙을 넘을 때마다 곧바로 반대쪽으로 바꾸면, 주심이
         * 공을 가로질러 30미터를 달려 건너간다. 그 도중에 공과 스치고
         * (실측 최소 5.9미터) 화면에서는 심판이 갈지자로 흔들린다.
         * 공이 확실히 한쪽으로 간 뒤에만 옮기고, 가운데에서는 지금 있는
         * 쪽을 지킨다.
         */
        const mid = PITCH_H / 2
        const w = this.whistle
        if (w) {
          /**
           * 판정을 내렸으면 **그 자리로 간다.**
           *
           * 반칙 지점에서 30미터 떨어져 서 있는 주심은 판정을 준 사람으로
           * 보이지 않는다. 카드는 선수 코앞까지 가서 들고, 나머지는 몇
           * 걸음 떨어져 벽과 거리를 관리한다.
           */
          const near = w.kind === 'CARD' ? 2.4 : 7
          const dx = o.x - w.x
          const dy = o.y - w.y
          const d = Math.hypot(dx, dy) || 1
          tx = clamp(w.x + (dx / d) * near, 3, PITCH_W - 3)
          ty = clamp(w.y + (dy / d) * near, 3, PITCH_H - 3)
        } else {
          const away = b.y < mid - REF_SWITCH ? 1 : b.y > mid + REF_SWITCH ? -1 : o.y >= mid ? 1 : -1
          tx = clamp(b.x - REF_TRAIL, 5, PITCH_W - 5)
          ty = clamp(b.y + away * REF_STANDOFF, 5, PITCH_H - 5)
        }
        top = REF_SPEED
      } else {
        // 부심은 자기 절반의 터치라인 밖에서 옆걸음만 한다.
        // 위쪽 부심이 우리 진영(HOME 이 지키는 절반)을 맡는다
        const side: 'HOME' | 'AWAY' = o.kind === 'AR_TOP' ? 'HOME' : 'AWAY'
        const half: [number, number] =
          this.ownGoalX(side) === GOAL_LINE_AWAY ? [0, PITCH_W / 2] : [PITCH_W / 2, PITCH_W]
        tx = clamp(this.arLine(side), half[0], half[1])
        ty = o.kind === 'AR_TOP' ? AR_INSET : PITCH_H - AR_INSET
        top = AR_SPEED
      }

      const dx = tx - o.x
      const dy = ty - o.y
      const d = Math.hypot(dx, dy)
      if (d < 0.05) continue
      const move = Math.min(d, top * step)
      o.x += (dx / d) * move
      o.y += (dy / d) * move
    }

    if (this.offside) {
      this.offside.life -= step
      if (this.offside.life <= 0) this.offside = null
    }
    if (this.whistle) {
      this.whistle.life -= step
      if (this.whistle.life <= 0) this.whistle = null
    }
    if (this.offsideMute > 0) this.offsideMute -= step
    if (this.foulMute > 0) this.foulMute -= step

    /**
     * 왜 공이 넘어갔는지 알리는 한 줄.
     *
     * **자기 시계를 따로 갖는다.** 재개는 0.35~0.95초 만에 끝나는 것이
     * 있어서, `restart` 가 살아 있는 동안에만 띄우면 글자를 읽기도 전에
     * 사라진다. 사건이 성립하는 순간 붙잡아 두고 정해진 시간 동안 보여준다.
     *
     * 판정을 만들어내지는 않는다 — `calloutOf` 는 `restart` 와 `whistle`
     * 에 이미 있는 값만 읽는 순수 함수이고, 난수를 쓰지 않는다.
     */
    /**
     * **사건이 새로 생긴 순간에만 정한다. 그 뒤로는 다시 계산하지 않는다.**
     *
     * 매 프레임 다시 계산하면 두 가지가 망가진다.
     *
     * 하나는 표시 시간이다. 되감기가 계속되어 `재개 시간 + 수명` 만큼
     * 글자가 남는다 — 실측으로 프레임의 43.6%를 안내판이 덮었다.
     *
     * 다른 하나가 더 나쁘다. **오프사이드가 도중에 파울로 바뀐다.** 휘슬은
     * 1.2초 살고 재개는 그보다 오래 가는데, 오프사이드 재개의 `kind` 는
     * `FREE_KICK` 이라 휘슬이 꺼지는 순간 남은 것만 보고 "파울"로 읽힌다.
     * 판정이 눈앞에서 바뀌는 것은 없느니만 못하다.
     */
    const r = this.restart
    const w = this.whistle
    if ((r !== null && r !== this.calloutRestart) || (w !== null && w !== this.calloutWhistle)) {
      const now = calloutOf(r, w)
      if (now) this.callout = { ...now, life: CALLOUT_LIFE }
    }
    this.calloutRestart = r
    this.calloutWhistle = w

    if (this.callout) {
      this.callout.life -= step
      if (this.callout.life <= 0) this.callout = null
    }
  }

  /**
   * 이 패스가 오프사이드인가.
   *
   * 규칙 그대로다. 받는 선수가 **공을 찬 순간에**
   * ① 상대 진영에 있고 ② 공보다 앞에 있고 ③ 뒤에서 두 번째 상대보다
   * 앞에 있으면 오프사이드다. 셋 중 하나라도 아니면 아니다.
   *
   * 세 조건 모두 `OFFSIDE_MARGIN` 만큼 확실히 앞서야 한다. 나란히 선
   * 선수는 오프사이드가 아니고(규칙이 그렇다), 우리 좌표는 프레임마다
   * 조금씩 흔들리기 때문이다.
   *
   * **골이 예약된 팀에게는 불지 않는다.** 시뮬이 이미 득점으로 판정한
   * 공격이라 화면이 전개를 만들고 있는 중이고, 여기서 끊으면 만들던
   * 장면을 버리게 된다. 점수판이 그 장면을 기다리고 있어서 골이 늦어질
   * 뿐 사라지지는 않지만, 규칙보다 점수판 일치가 먼저다.
   */
  private isOffside(holder: VPlayer, to: VPlayer): boolean {

    if (this.offsideMute > 0) return false
    if (this.throwBy) return false
    if (to.pos === 'GK') return false
    /**
     * 예약된 골이 **하나라도** 있으면 불지 않는다.
     *
     * 처음에는 공격하는 쪽의 예약만 봤다. 그랬더니 상대의 예약 골이
     * 걸려 있는 동안 우리 쪽 오프사이드가 재개를 걸어 그 유예를 먹었고,
     * 서른아홉 골 중 하나가 장면 없이 지나갔다. 예약 골은 8초 안에
     * 전개를 만들어야 하는데 데드볼 몇 초는 그 예산의 절반이다.
     * 규칙보다 "골에는 장면이 있다"가 먼저다.
     */
    if (this.pending.length > 0) return false

    const dir = holder.side === 'HOME' ? 1 : -1
    // ① 상대 진영에 있어야 한다. 자기 진영에서는 오프사이드가 없다
    if ((to.x - PITCH_W / 2) * dir <= OFFSIDE_MARGIN) return false
    // ② 공보다 앞에 있어야 한다
    if ((to.x - holder.x) * dir <= OFFSIDE_MARGIN) return false
    // ③ 뒤에서 두 번째 상대보다 앞에 있어야 한다
    const other: 'HOME' | 'AWAY' = holder.side === 'HOME' ? 'AWAY' : 'HOME'
    if (this.inBoxOf(other, to.x)) return false
    const line = this.offsideLine(other)
    return (to.x - line) * dir > OFFSIDE_MARGIN
  }

  /**
   * 주심이 휘슬을 분다.
   *
   * 화면에 표시만 하는 것이 아니라 **주심을 그 자리로 보낸다.** 반칙이
   * 난 곳에서 30미터 떨어져 서 있는 주심은 판정을 준 사람으로 안 보인다.
   */
  private blowWhistle(kind: Whistle['kind'], x: number, y: number, red = false) {
    this.whistle = {
      kind,
      x: clamp(x, 2, PITCH_W - 2),
      y: clamp(y, 2, PITCH_H - 2),
      red,
      life: kind === 'CARD' ? CARD_SHOW : WHISTLE_SHOW,
    }
  }

  /**
   * 부심이 깃발로 방향을 가리킨다.
   *
   * 스로인·코너킥·골킥은 주심이 휘슬을 불지 않는다. 그 자리에서 가장
   * 가까운 부심이 깃발을 드는 것이 신호의 전부다. 실제 축구가 그렇다.
   */
  private flagRestart(x: number) {
    const by: Official['kind'] = x <= PITCH_W / 2 ? 'AR_TOP' : 'AR_BOTTOM'
    const ar = this.officials.find((o) => o.kind === by)
    if (ar) ar.flag = FLAG_LIFT
  }

  /**
   * 깃발을 든다. 아직 휘슬은 불지 않는다.
   *
   * 이 순간 경기는 계속 흐른다. 부심의 깃발이 올라가 있고 공은 오프사이드
   * 선수를 향해 날아가는 중이다.
   */
  private raiseFlag(against: 'HOME' | 'AWAY', to: VPlayer) {
    const by: Official['kind'] = to.x <= PITCH_W / 2 ? 'AR_TOP' : 'AR_BOTTOM'
    const ar = this.officials.find((o) => o.kind === by)
    if (ar) ar.flag = FLAG_LIFT
    this.flagged = { against, by }
    this.offsideMute = OFFSIDE_MUTE
  }

  /**
   * 깃발이 올라간 뒤 공이 멎으면 휘슬을 분다.
   *
   * 공이 아직 날아가는 중이면 기다린다. 공이 이미 라인 밖으로 나가
   * 다른 재개가 걸렸으면 그쪽이 먼저다 — 깃발을 내리고 없던 일로 한다.
   * 실제로도 공이 아웃되면 부심은 깃발을 내린다.
   */
  private settleFlag() {
    const f = this.flagged
    if (!f) return
    if (this.restart) {
      this.flagged = null
      return
    }
    if (this.ball.mode === 'PASS' || this.ball.mode === 'SHOT') return

    this.flagged = null
    // 공이 멎은 자리가 곧 프리킥 자리다. 여기까지 공이 실제로 굴러왔으므로
    // 화면에서 튀는 구간이 없다
    const px = clamp(this.ball.x, 3, PITCH_W - 3)
    const py = clamp(this.ball.y, 3, PITCH_H - 3)
    this.offside = { x: px, y: py, by: f.by, life: FLAG_LIFT }
    this.offsideCount += 1
    this.blowWhistle('OFFSIDE', px, py)
    const defending: 'HOME' | 'AWAY' = f.against === 'HOME' ? 'AWAY' : 'HOME'
    this.beginRestart('FREE_KICK', defending, px, py)
    this.offsideMute = OFFSIDE_MUTE
  }

  /**
   * 슛.
   *
   * 골로 끝날 슛은 골대 안쪽을 노리고, 아닌 슛은 골키퍼 정면이나 골대
   * 옆으로 간다. 시뮬이 이미 득점 여부를 정해뒀으므로 여기서는 그 결과에
   * 맞는 궤적을 그리기만 한다.
   */
  private shoot(shooter: VPlayer, willScore: boolean) {
    const gx = this.goalX(shooter.side)
    let gy: number
    if (willScore) {
      // 골대 안쪽. 구석으로 갈수록 그림이 산다
      const corner = this.rng.next() < 0.65 ? 1 : 0
      const sign = this.rng.next() < 0.5 ? -1 : 1
      gy = GOAL_MID + sign * (corner ? 2.2 + this.rng.next() * 1.2 : this.rng.next() * 1.6)
    } else {
      // 막히거나 빗나간다. 멀리서 쏠수록 골대를 벗어나기 쉽다 —
      // 10미터 20% → 25미터 53% → 35미터 75%. 가까운 슛은 골키퍼
      // 정면으로 가서 막히는 그림이 된다
      const dGoal = Math.hypot(gx - shooter.x, GOAL_MID - shooter.y)
      const wide = this.rng.next() < clamp(0.2 + (dGoal - 10) * 0.022, 0.2, 0.8)
      const sign = this.rng.next() < 0.5 ? -1 : 1
      gy = wide
        ? GOAL_MID + sign * (GOAL_HALF + 1 + this.rng.next() * (2 + dGoal * 0.06))
        : GOAL_MID + sign * this.rng.next() * 2
    }

    // 슛은 살짝 뜬다. 크로스바(2.44m) 밑으로 지나가야 하므로 높이 못 준다
    const lift = willScore ? 1.0 + this.rng.next() * 1.8 : 1.0 + this.rng.next() * 3.4
    this.ball.willScore = willScore
    this.kickBall(shooter, gx, clamp(gy, 2, PITCH_H - 2), SHOT_SPEED, lift, 'SHOT', null, 'SHOT')
    this.ball.fromX = shooter.x
    this.ball.fromY = shooter.y
    this.flash('SHOT', shooter.x, shooter.y)
  }

  /** 상대 골대에 가장 가까운 동료. 길게 보낼 때 쓴다 */
  private forwardOutlet(holder: VPlayer): VPlayer | null {
    const gx = this.goalX(holder.side)
    let best: VPlayer | null = null
    let bd = Infinity
    for (const p of this.players) {
      if (p.side !== holder.side || p.id === holder.id || p.pos === 'GK') continue
      const d = dist(p, holder)
      // 발로 닿는 거리여야 한다. 이보다 멀면 패스가 아니라 걷어내기다
      if (d < 6 || d > 48) continue
      const toGoal = Math.hypot(gx - p.x, GOAL_MID - p.y)
      if (toGoal < bd) {
        bd = toGoal
        best = p
      }
    }
    return best
  }

  /** 패스 받을 사람을 고른다. 앞쪽이고 마크가 헐거운 동료 */
  private choosePass(holder: VPlayer): VPlayer | null {
    const dir = holder.side === 'HOME' ? 1 : -1
    let best: VPlayer | null = null
    let bestScore = -Infinity

    for (const p of this.players) {
      if (p.side !== holder.side || p.id === holder.id || p.pos === 'GK') continue
      // 짧은 패스가 기본이다. 매번 롱볼을 때리면 공이 계속 공중에 있다
      const d = dist(p, holder)
      // 진짜 전환 패스는 대각으로 48미터쯤이다. 46에서 자르면 그것부터 죽는다
      if (d < 5 || d > 54) continue

      // 앞으로 갈수록 좋고, 상대가 붙어 있으면 나쁘다
      const forward = (p.x - holder.x) * dir
      const marker = this.players.reduce((m, o) => {
        if (o.side === holder.side) return m
        return Math.min(m, dist(o, p))
      }, Infinity)
      /**
       * **좌우로 벌리는 선택에 값을 준다.**
       *
       * 전에는 이 식에 세로 좌표가 아예 없었다. 앞으로 갈수록 좋고
       * 상대가 멀수록 좋고 가까울수록 좋다 — 셋 다 세로와 무관하다.
       * 그래서 옆으로 벌리는 패스가 **구조적으로 질 수밖에** 없었고,
       * 실측으로 공이 터치라인 13.6미터 안에 있던 시간이 13.2%였다
       * (그 띠가 경기장 폭의 40%다). 실제 축구는 절반이 측면에서 난다.
       *
       * 두 가지에 값을 준다 — 지금 공이 있는 쪽에서 **반대쪽으로 벌리는
       * 것**(전환)과, 받는 선수가 **터치라인 가까이 있는 것**(폭 유지).
       * 앞으로 가는 값보다 작게 두어 전진을 대체하지는 않는다.
       */
      const swing = Math.min(Math.abs(p.y - holder.y), 26) * 0.32
      const wide = Math.max(0, Math.abs(p.y - PITCH_H / 2) - 12) * 0.28
      const score =
        forward * 0.9 + Math.min(marker, 18) * 1.4 - d * 0.25 + swing + wide + this.rng.next() * 6
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    return best
  }

  private pass(holder: VPlayer, to: VPlayer) {
    /**
     * 오프사이드는 찬 **그 순간**의 자리로 정해진다. 공이 날아가는 동안
     * 받는 선수가 내려와도 판정은 바뀌지 않는다 — 규칙이 그렇다.
     *
     * **그런데 여기서 공을 세우지는 않는다.** 실제 축구가 그렇다. 부심은
     * 패스가 나가는 순간 깃발을 들고, 주심은 그 공이 오프사이드 선수에게
     * **닿은 뒤에** 휘슬을 분다. 그래서 깃발이 올라간 채 공이 몇 미터 더
     * 굴러가는 그 장면이 나온다.
     *
     * 처음에는 그 자리에서 바로 프리킥을 놨는데, 공이 패스한 선수 발밑에서
     * 오프사이드 자리까지 **한 프레임에 최대 37미터를 순간이동했다.** 공을
     * 실제로 날려 보내면 도착 지점이 곧 프리킥 자리라 튀는 구간이 없다.
     */
    if (this.isOffside(holder, to)) this.raiseFlag(holder.side, to)

    // 받는 사람이 뛰어갈 자리로 찔러준다
    const lead = 0.35
    let tx = clamp(to.x + to.vx * lead, 2, PITCH_W - 2)
    let ty = clamp(to.y + to.vy * lead, 2, PITCH_H - 2)
    const d = Math.hypot(tx - holder.x, ty - holder.y)

    // 패스는 100% 붙지 않는다. 가까우면 거의 붙고 멀수록 성공률이
    // 떨어지며, 발밑에 상대가 붙은 채로 차면 더 나빠진다.
    // 8미터 0.97 → 20미터 0.83 → 35미터 0.65
    const oppNear = this.players.reduce((m, o) => {
      if (o.side === holder.side || o.pos === 'GK') return m
      return Math.min(m, dist(o, holder))
    }, Infinity)
    let success = 0.97 - Math.max(0, d - 8) * 0.012
    if (oppNear < 3) success -= 0.08
    success = clamp(success, 0.6, 0.97)

    let targetId: string | null = to.id
    if (this.rng.next() >= success) {
      // 빗나간다 — 리시버에 못 미치거나 옆으로 새서 주인 없는 공이 된다.
      // 라인 밖까지 나갈 수 있어야 한다. 여기서 경기장 안으로 가둬버리면
      // 공이 영영 밖으로 나가지 않아 스로인도 코너킥도 생기지 않는다
      // 빗나간 패스가 어디로 가는가.
      //
      // 넓게 흩뿌리면 아무도 없는 곳에 떨어져 주인 없는 공이 경기의
      // 5분의 1을 차지한다. 좁게 두면 반대로 받으려던 동료가 늘 주워서
      // 실패가 실패로 보이지 않는다 — 실측으로 긴 패스 성공률이 100%가
      // 나왔다. 실제 축구의 미스패스 절반은 마크하던 수비수에게 간다.
      //
      // 난수는 분기와 무관하게 셋 다 뽑는다. 조건 안에서 뽑으면 같은
      // 시드에서도 이후 수열이 밀려 재현이 조용히 깨진다
      const ang = this.rng.next() * Math.PI * 2
      const off = 2 + this.rng.next() * 4
      const toMarker = this.rng.next() < 0.72
      const marker = this.players.reduce<VPlayer | null>((m, o) => {
        if (o.side === to.side || o.pos === 'GK') return m
        return !m || dist(o, to) < dist(m, to) ? o : m
      }, null)
      if (toMarker && marker) {
        /**
         * **수비수 발밑에 꽂지 않는다.**
         *
         * 사용자가 지적했다 — *"간혹 다른 편인데 패스를 하는경우도 있어."*
         * 패스 목표를 고르는 모든 경로는 같은 편만 고르므로 의도한 오패스는
         * 없다. 사용자가 본 것은 **빗나간 패스**다. 전에는 빗나간 패스의
         * 72%가 마크하던 수비수의 1.2미터 안으로 날아갔다. 초속 20미터로
         * 날아간 공이 가만히 선 상대의 발에 정확히 닿으면 그건 실수가
         * 아니라 상대에게 건넨 패스로 보인다. 실측 판당 4.5회였다.
         *
         * 이제 수비수와 찬 선수 **사이**에 떨어진다. 수비수가 앞으로 나와
         * 끊어야 잡는 자리다 — 그것이 실제 축구의 인터셉트다.
         */
        const bx = marker.x - holder.x
        const by = marker.y - holder.y
        const bd = Math.hypot(bx, by) || 1
        tx = clamp(marker.x - (bx / bd) * MISS_CUT_GAP + Math.cos(ang) * 1.2, -6, PITCH_W + 6)
        ty = clamp(marker.y - (by / bd) * MISS_CUT_GAP + Math.sin(ang) * 1.2, -6, PITCH_H + 6)
      } else {
        tx = clamp(tx + Math.cos(ang) * off, -6, PITCH_W + 6)
        ty = clamp(ty + Math.sin(ang) * off, -6, PITCH_H + 6)
      }
      targetId = null
    }

    const speed = passSpeed(d)
    this.kickBall(holder, tx, ty, speed, this.loftFor(d, speed), 'PASS', targetId, 'PASS')
  }

  /**
   * 슛을 택할 확률.
   *
   * 실제 축구의 판단이다. 박스 안(골라인에서 16.5m)에서 각이 열려 있으면
   * 대부분 슛이고, 25미터 밖에서는 대부분 패스다. 그 사이가 고민 구간이다.
   * **우리 팀이든 상대든 같은 기준을 쓴다** — 공을 가진 쪽이 팀과 무관하게
   * 이 함수를 거치므로 갈릴 여지가 없다.
   *
   * 박스 안은 수비가 붙어도 84% 이상을 유지한다. 슛을 한 번 포기한 뒤의
   * 판단이 거의 항상 패스(압박 시 96%)라, 예전의 45% 감점은 문전일수록
   * 백패스가 늘어나는 역전 현상을 만들었다.
   *
   * 8m 98% · 16.5m 96% · 20m 59% · 25m 9% · 26m 이상 0%
   */
  private shotWant(p: VPlayer, nearest: number): number {
    const gx = this.goalX(p.side)
    const gd = Math.hypot(gx - p.x, GOAL_MID - p.y)
    /**
     * 각이 닫혀 있으면 못 쏜다. 골라인 옆 코너에서 때리는 것은 축구가
     * 아니다. 다만 **골대 가까이에서는 좁은 각도 쏜다** — 실제 축구에서
     * 페널티 지역 안이면 옆으로 치우쳐도 때린다. 전에는 이 선이 너무
     * 좁아, 박스 안 판단 스물둘 중 여섯이 "각이 없어 패스"로 빠졌다
     * (박스 안 슛 비율 0.73, 기준 0.75).
     */
    if (Math.abs(p.y - GOAL_MID) > 9 + gd * 0.8) return 0
    let want = gd <= 16.5
      ? clamp(1.04 - gd * 0.005, 0.94, 0.98)
      : clamp(0.94 - (gd - 16.5) * 0.1, 0, 0.94)
    // 수비가 발앞에 있어도 문전에서는 슛이 우선이다. 완전히 같은 확률로
    // 두면 압박이 무의미해지므로 막힐 여지만 작게 남긴다
    // 박스 안에서는 감점을 작게 둔다. 대형을 실제 폭으로 넓히자 박스
    // 안에서도 옆으로 치우친 자리가 늘었는데, 거기서까지 패스를 고르면
    // 문전 백패스가 다시 늘어난다(실측 박스 안 슛 비율 0.74, 기준 0.75)
    if (nearest < 1.7) want *= gd <= 16.5 ? 0.95 : 0.88
    return want
  }

  /** 공을 가진 선수가 무엇을 할지 정한다 */
  private decide(holder: VPlayer, dt: number) {
    const nearest = this.players.reduce((m, o) => {
      if (o.side === holder.side || o.pos === 'GK') return m
      return Math.min(m, dist(o, holder))
    }, Infinity)

    // 발밑까지 붙었으면 여유 부릴 시간이 없다. 원터치로 내준다.
    // 이게 없으면 수비수가 몸에 붙었는데 태연히 공을 몰고 다닌다
    if (nearest < 2.6) this.decideIn = Math.min(this.decideIn, 0.06)

    this.decideIn -= dt
    if (this.decideIn > 0) return

    // 스로인은 손으로 던진다. 발로 차면 초속 26미터짜리 롱볼이 나온다
    if (this.throwBy === holder.id) {
      this.throwBy = null
      this.throwIn(holder)
      return
    }

    const target = this.choosePass(holder)

    // 골키퍼는 공을 몰고 나가지 않는다. 잡으면 앞으로 차낸다.
    // 아무도 못 찾으면 가장 가까운 동료에게라도 준다 — 여기서 계속
    // 들고 있으면 경기가 골문 앞에서 멈춘다
    if (holder.pos === 'GK') {
      const out =
        target ??
        this.players.reduce<VPlayer | null>((m, p) => {
          if (p.side !== holder.side || p.pos === 'GK') return m
          return !m || dist(p, holder) < dist(m, holder) ? p : m
        }, null)
      if (out) this.pass(holder, out)
      else this.decideIn = 0.4
      return
    }

    // 시뮬이 예약해둔 슛이 이 팀 것이면 그것부터 처리한다
    const q = this.pending[0]
    if (q && q.side === holder.side) {
      /**
       * 사정거리 안이어도 **전개가 모자라면 아직 안 쏜다.**
       *
       * 이 자리가 골 장면의 주된 통로다. 여기에 전개 조건을 안 걸어두면
       * `tryPendingShot` 쪽만 막아놓아도 소용이 없다 — 실측으로 골 일흔
       * 개가 이 경로로 나갔다. 전개가 덜 찼으면 아래 평범한 판단으로
       * 내려가 상대 진영에서 공을 돌린다. 그동안 전개 시간이 쌓인다
       */
      if (this.canShoot(holder, undefined, this.pendingRange(q.willScore))) {
        if (this.readyToScore(q.side, q.willScore)) {
          this.pending.shift()
          this.shoot(holder, q.willScore)
          return
        }
        /**
         * 전개가 덜 찼는데 **이미 박스 안**이면 공을 지킨다.
         *
         * 여기서 평범한 판단으로 내려가면 골대 앞에서 옆으로 내주게 된다.
         * 실측으로 박스 안 판단 스물둘 중 여섯이 그런 패스였다(슛 비율
         * 0.73, 기준 0.75). 실제 축구의 공격수는 그 자리에서 뒤로 빼지
         * 않고 등지고 버티며 동료가 올라오기를 기다린다. 몇 프레임 뒤에
         * 전개가 차면 그대로 때린다 — 압박을 받으면 그동안 뺏길 수 있고,
         * 그것도 축구다.
         */
        const back: 'HOME' | 'AWAY' = holder.side === 'HOME' ? 'AWAY' : 'HOME'
        if (this.inBoxOf(back, holder.x)) {
          this.decideIn = 0.25
          return
        }
      } else {
        /**
         * 사정거리 밖이다. 그렇다고 여기서 평범하게 옆으로 돌리면 예약이
         * 만료되어 공이 골대 앞으로 순간이동한다. **앞으로 길게 보낸다.**
         *
         * 실측으로 이 장치가 없을 때 슛 거리 최대가 67미터였다 — 자기
         * 진영에서 때린 골이라는 뜻이다.
         */
        const outlet = this.forwardOutlet(holder)
        if (outlet) {
          this.pass(holder, outlet)
          return
        }
      }
    }

    /**
     * 골대에 가까우면 슛이 먼저다.
     *
     * 이 슛은 **시뮬 결과를 건드리지 않는다.** willScore 가 false 이므로
     * 골키퍼에게 막히거나 골대를 벗어난다. 점수판을 올리는 것은 시뮬이
     * 골이라고 알려줄 때뿐이다.
     *
     * 단, 이 팀의 골이 예약돼 있고 전개를 채우는 중이라면 쏘지 않는다.
     * 여기서 빗나가는 슛을 쏘면 골킥·코너로 넘어가 방금까지 쌓아온
     * 공격이 통째로 날아가고, 예약된 골은 다시 처음부터 만들어야 한다
     */
    const buildingForGoal = q && q.side === holder.side && q.willScore
    if (!buildingForGoal && this.rng.next() < this.shotWant(holder, nearest)) {
      this.shoot(holder, false)
      return
    }

    // 쫓기면 빨리 내주고, 여유가 있으면 조금 몰고 간다.
    // 15분에 여든 번쯤 오가야 축구로 보인다 — 내주는 쪽이 기본이다
    const wantPass = nearest < 8 ? 0.96 : 0.72
    if (target && this.rng.next() < wantPass) {
      this.pass(holder, target)
    } else {
      // 내줄 데가 없으면 몰고 가며 다시 살핀다
      this.decideIn = 0.35 + this.rng.next() * 0.45
    }
  }

  /**
   * 압박 게이지.
   *
   * 상대가 발밑까지 붙은 시간이 쌓이면 공을 지킬 수 없다. 둘러싸일수록
   * 빨리 쌓인다. 이것이 없으면 수비수 셋이 몸에 붙어 있는데도 공을 영영
   * 안 뺏기는, 축구에서 있을 수 없는 그림이 나온다.
   */
  private updatePressure(holder: VPlayer, dt: number) {
    // 골키퍼가 공을 잡고 있으면 아무도 못 뺏는다. 규칙(경기 규칙 12조)이
    // 골키퍼가 공을 놓는 것을 방해하지 못하게 한다.
    // 스로인을 던지려는 선수도 마찬가지다 — 공은 아직 죽어 있다
    if (holder.pos === 'GK' || this.throwBy === holder.id) return
    let nearest = Infinity
    let crowd = 0
    let taker: VPlayer | undefined
    for (const o of this.players) {
      if (o.side === holder.side || o.pos === 'GK' || o.recover > 0) continue
      const d = dist(o, holder)
      if (d < nearest) {
        nearest = d
        taker = o
      }
      if (d < 3.2) crowd += 1
    }

    /**
     * 붙어 있는 수비수가 공이 아니라 사람을 맞힌다 — 상대의 반칙.
     *
     * 태클이 성공하는 순간이 아니라 **경합하는 시간**에 건다. 이유는
     * `FOUL_RATE` 주석에 있다.
     */
    if (
      holder.side === 'HOME' &&
      taker &&
      // 상대 수비수는 자기 공격 진영에서 우리를 붙잡지 않는다
      holder.x > FOUL_ZONE &&
      nearest < FOUL_RANGE &&
      this.rng.next() < dt * FOUL_RATE &&
      this.tackleFoul(taker, holder)
    ) {
      return
    }

    // 발끝이 닿는 거리면 터치하는 순간을 노린 태클이 바로 나올 수 있다
    if (taker && nearest < 1.7 && this.rng.next() < dt * 3.2) {
      this.flash('TACKLE', this.ball.x, this.ball.y)
      holder.recover = 0.55
      this.giveTo(taker)
      return
    }

    if (nearest < 2.4) this.pressure += dt * (1 + 0.8 * Math.max(0, crowd - 1))
    else if (nearest > 3.6) this.pressure = Math.max(0, this.pressure - dt * 1.8)

    // 붙잡힌 시간이 쌓여도 뺏긴다. 둘러싸이면 더 빨리
    if (taker && this.pressure > 0.4 && this.rng.next() < dt * (1.6 + crowd * 0.9)) {
      this.flash('TACKLE', this.ball.x, this.ball.y)
      holder.recover = 0.55
      this.giveTo(taker)
    }
  }

  /**
   * 늦게 들어간 태클이 반칙이 된다.
   *
   * **여기서 만드는 것은 상대의 반칙뿐이다.** 근거와 빈도는 `FOUL_RATE`
   * 주석에 적었다. 상대에게 퇴장은 주지 않는다 — 시뮬이 상대 인원을 자기
   * 기록으로 들고 있어 화면이 한 명을 빼면 점수판·브리핑·감독 보고서가
   * 서로 다른 인원을 말하게 된다. 경고까지가 이 계층이 만들 수 있는
   * 전부다.
   */
  private tackleFoul(tackler: VPlayer, victim: VPlayer): boolean {
    if (tackler.side !== 'AWAY') return false
    // 이미 죽어 있는 공에는 반칙이 없다. 예약된 골이 있으면 끊지 않는다 —
    // 골 장면은 8초 안에 전개를 만들어야 하고 데드볼 몇 초가 그 절반이다
    if (this.restart || this.pending.length > 0 || this.foulMute > 0) return false
    const card = this.rng.next() < AWAY_CARD && !tackler.booked
    this.awayFouls += 1
    this.beginRestart(
      'FREE_KICK',
      'HOME',
      clamp(victim.x, 2, PITCH_W - 2),
      clamp(victim.y, 2, PITCH_H - 2),
    )
    if (card) {
      tackler.booked = true
      this.awayCards += 1
      // 주심이 그 선수 앞까지 가서 카드를 든다. 휘슬은 이미 불었다
      this.blowWhistle('CARD', tackler.x, tackler.y, false)
    }
    return true
  }

  /** 각 선수가 지금 가려는 곳을 정한다 */
  private setTargets(state: MatchState) {
    const holder = this.byId(this.ball.holder)
    // 우리가 찬 공이 날아가는 동안에도 우리는 공격 중이다. 공중에 뜬 순간
    // 전원이 수비 대형으로 내려가면 대형이 매 패스마다 앞뒤로 출렁인다
    const inFlight = this.ball.mode === 'PASS' || this.ball.mode === 'SHOT'
    const ballSide: 'HOME' | 'AWAY' | null =
      holder?.side ?? (inFlight ? this.byId(this.ball.targetId)?.side ?? this.ball.lastTouch : null)
    // 굴러가는 공은 지금 자리가 아니라 갈 자리로 쫓아가야 잡는다
    const lead = {
      x: clamp(this.ball.x + this.ball.vx * 0.4, 0, PITCH_W),
      y: clamp(this.ball.y + this.ball.vy * 0.4, 0, PITCH_H),
    }

    /**
     * 무조건 전력으로 뛰는 선수 — 아래 보정에서 제외한다.
     *
     * 패스를 받으러 가는 선수와, 골이 예약된 팀에서 공을 몰고 있는 선수다.
     * 리드 패스는 받는 선수가 **계속 달릴 것**을 전제로 공을 앞에 놓고,
     * 골 연출은 8초 안에 50미터를 밀고 올라가야 장면이 된다. 여기서 한 단
     * 내려가면 공이 사람을 지나쳐 흐르고 골 장면이 깨진다.
     */
    const locked = new Set<string>()

    for (const p of this.players) {
      if (p.pos === 'GK') {
        // 골키퍼가 공을 잡았으면 그 자리에서 찬다. 여기서 골라인으로
        // 되돌리면 공을 든 채 뒷걸음질치는 그림이 된다
        if (holder?.id === p.id) {
          p.tx = p.x
          p.ty = p.y
          p.effort = 'WALK'
          locked.add(p.id)
          continue
        }
        /**
         * 골키퍼는 골문 중앙과 공을 잇는 선 위에 선다.
         *
         * 공이 멀면 페널티 지역 앞까지 나와 있고(스위퍼 키퍼), 가까워지면
         * 골문으로 물러나 골대를 덮는다.
         *
         * **전에는 이 관계가 뒤집혀 있었다.** 공이 가까울수록 앞으로 나오게
         * 돼 있어서, 상대가 우리 박스까지 밀고 들어온 순간 골키퍼가 골라인
         * 11미터 앞에 나가 있었다(실측 중앙값). 골문이 통째로 비어 있었다는
         * 뜻이다. 실제 골키퍼의 위치는 공이 하프라인이면 10m, 25m면 5m,
         * 박스 앞이면 3m, 박스 안이면 1.5~2m다.
         */
        const own = this.goalX(p.side === 'HOME' ? 'AWAY' : 'HOME')
        const toBall = Math.hypot(this.ball.x - own, this.ball.y - GOAL_MID)
        const out = clamp(toBall * 0.2, 1.3, 10)
        const k = p.side === 'HOME' ? 1 : -1
        p.tx = own + out * k
        // 골문 중앙-공 연결선 위의 점. 앞으로 나온 만큼만 옆으로 간다
        const off = ((this.ball.y - GOAL_MID) * out) / Math.max(out, toBall)
        p.ty = clamp(GOAL_MID + off, GOAL_MID - (GOAL_HALF + 2.5), GOAL_MID + (GOAL_HALF + 2.5))
        /**
         * 골키퍼의 노력 단계는 **공이 어디 있나가 아니라 자기 자리까지
         * 얼마나 남았나**로 정한다.
         *
         * 공 위치로 정하면 상대 역습이 시작된 순간 골키퍼가 "공이 머니까
         * 천천히"로 판정되어, 정작 골문으로 물러나야 할 때 걸어서 돌아온다.
         * 골문을 비운 채 실점하는 그림이 되고, 골키퍼 위치를 고쳐놓은
         * 작업이 통째로 되돌아간다.
         */
        p.effort = gkEffort(Math.hypot(p.tx - p.x, p.ty - p.y))
        // 아래 보정에서 뺀다. 골키퍼의 단계는 이 한 줄로만 정해진다
        locked.add(p.id)
        continue
      }

      const dir = p.side === 'HOME' ? 1 : -1
      const attacking = ballSide === p.side

      // 나에게 오는 패스는 내가 받으러 간다. 공은 도착 지점에서 서지
      // 않으므로 제때 가 있지 않으면 그대로 지나쳐 흐른다
      if (this.ball.mode === 'PASS' && this.ball.targetId === p.id) {
        p.tx = clamp(this.ball.toX, 3, PITCH_W - 3)
        p.ty = clamp(this.ball.toY, 3, PITCH_H - 3)
        p.effort = 'SPRINT'
        locked.add(p.id)
        continue
      }

      if (holder && holder.id === p.id) {
        // 공을 몰 때는 앞이 기본이되, 막힌 쪽을 피해 빈 길로 꺾는다.
        // 무작정 직진하면 수비수 무리 속으로 제 발로 파고든다
        let ex = dir * 1.1
        /**
         * 안으로 접는 힘은 **골대가 가까울 때만** 건다.
         *
         * 전에는 세로 중앙을 향하는 힘이 늘 걸려 있었다. 그래서 옆줄에서
         * 공을 잡은 선수가 곧바로 가운데로 파고들었고, 측면 돌파라는
         * 장면이 아예 없었다. 실제 축구의 윙어는 박스 근처까지 옆줄을
         * 타고 가서 거기서 접는다.
         */
        const toGoal = Math.hypot(this.goalX(p.side) - p.x, GOAL_MID - p.y)
        let ey = (GOAL_MID - p.y) * 0.015 * clamp((46 - toGoal) / 30, 0, 1)
        let boxed = 0
        for (const o of this.players) {
          if (o.side === p.side || o.pos === 'GK') continue
          const d = dist(o, p)
          if (d > 9) continue
          const w = (9 - d) / 9
          ex -= ((o.x - p.x) / (d || 1)) * w * 1.5
          ey -= ((o.y - p.y) / (d || 1)) * w * 1.5
          if (d < 3.2) boxed += 1
        }
        const m = Math.hypot(ex, ey) || 1
        // 완전히 갇히면 멀리 못 간다. 몸으로 지키며 내줄 곳을 찾는 그림
        const run = boxed >= 2 ? 5 : 13
        p.tx = clamp(p.x + (ex / m) * run, 4, PITCH_W - 4)
        p.ty = clamp(p.y + (ey / m) * run, 4, PITCH_H - 4)
        // 골이 예약된 팀은 공을 몰고 올라갈 시간이 8초뿐이다. 여기서
        // 속도를 늦추면 골대 앞까지 못 가 골 장면 자체가 사라진다
        if (this.pending[0]?.willScore && this.pending[0].side === p.side) {
          p.effort = 'SPRINT'
          locked.add(p.id)
        } else {
          // 몰고 뛰는 것은 빈 몸으로 뛰는 것보다 느리다(별도로 ×0.76).
          // 갇히면 몸으로 지키며 내줄 곳을 찾는다 — 그때는 뛰지 않는다
          p.effort = boxed >= 2 ? 'JOG' : 'RUN'
        }
        continue
      }

      if (attacking) {
        // 공격 — 팀 전체가 올라간다.
        //
        // 공격할 때 가만히 서 있는 선수는 없다. 수비라인은 하프라인까지
        // 밀고 올라가고 미드필더는 상대 박스 근처까지 들어간다. 전진 폭이
        // 작으면 공만 앞에 가 있고 뒤에 아홉 명이 서 있는 화면이 된다.
        /**
         * 골 예약이 걸린 팀은 더 높이 올라간다.
         *
         * 시뮬은 이미 이 팀이 골을 넣었다고 정했다. 그런데 화면의 이 팀이
         * 자기 진영에 웅크리고 있으면 3~4초 안에 골대 근처로 갈 수가 없고,
         * 연출은 슛 없이 골망 장면으로 때우게 된다. 실제 축구의 역습처럼
         * 앞선을 밀어올려 길게 보낼 자리를 만든다.
         */
        const chasing = this.pending[0]?.willScore && this.pending[0].side === p.side
        const surge = chasing && p.pos !== 'DF' ? 14 : 0
        /**
         * 물러서라고 한 선수는 공격에도 안 올라간다.
         *
         * 전에는 이 지시가 수비할 때만 걸렸다. 공격 전환 때는 그 선수도
         * 남들과 똑같이 30미터를 밀고 올라갔고, 열두 시드로 평균 위치를
         * 재보니 지시가 있을 때와 없을 때가 **53.6m 대 53.7m** 였다 —
         * 화면에서 구분이 안 됐다는 뜻이다. 뒤에 남으라는 지시는 공격
         * 전환에서 가장 눈에 띄어야 한다. 열 명이 올라갈 때 혼자 남는다
         */
        const hold = p.order === 'BACK_OFF' ? 0.3 : 1
        const push = ((p.pos === 'FW' ? 22 : p.pos === 'MF' ? 30 : 32) + surge) * hold
        let tx = p.homeX + push * dir
        let ty = p.homeY
        // 공 없이 자리를 잡는 동안은 조깅이다. 실제 축구에서 공을 안 가진
        // 아홉 명이 전력으로 뛰는 순간은 역습과 침투뿐이다.
        // 골이 예약된 팀의 앞선은 그 역습을 하는 중이다
        p.effort = chasing ? (p.pos === 'DF' ? 'RUN' : 'SPRINT') : 'JOG'

        if (holder) {
          // 공 있는 쪽으로 팀이 쏠리되 **폭 자체는 유지한다.**
          //
          // 각자를 공 쪽으로 끌어당기면 대형이 통째로 접혀 열한 명이 한
          // 덩어리로 몰려다닌다. 실측으로 공이 세로 68m 중 9~55m 구간만
          // 오갔다 — 양쪽 사이드가 통째로 비어 있었다는 뜻이다.
          //
          // 실제 축구는 블록을 옮기지 접지 않는다. 중심을 옮기고 서로의
          // 간격은 그대로 둔다. 공격할 때는 오히려 더 벌린다
          const shift = (holder.y - PITCH_H / 2) * (p.pos === 'DF' ? 0.3 : 0.42)
          ty = PITCH_H / 2 + (p.homeY - PITCH_H / 2) * 0.98 + shift

          const d = dist(p, holder)
          // 물러서라고 한 선수는 받으러 나오지도 않는다
          if (d < 24 && p.pos !== 'DF' && p.order !== 'BACK_OFF') {
            // 가까우면 받을 각을 만든다 — 겹치지 않게 벌려 선다
            const away = p.y > holder.y ? 1 : -1
            /**
             * 각을 만들되 **자기 줄의 좌우 자리를 버리지 않는다.**
             *
             * 전에는 여기서 대형 좌표를 통째로 버리고 `holder.y ± 8` 로
             * 덮어썼다. 홀더는 대개 가운데 있으므로, 24미터 안의 비수비수
             * 전원이 가운데로 모였다 — 실측으로 공이 세로 중앙 16미터 띠
             * 안에 있던 시간이 54.1%였다(그 띠는 폭의 24%다).
             */
            const angle = clamp(holder.y + away * (8 + (p.pos === 'FW' ? 4 : 0)), 4, PITCH_H - 4)
            ty = clamp(angle * 0.45 + ty * 0.55, 4, PITCH_H - 4)
            const short = clamp(holder.x + (p.pos === 'FW' ? 14 : 8) * dir, 4, PITCH_W - 4)
            /**
             * 받으러 내려오되 제 자리를 버리지는 않는다.
             *
             * 이 제한이 없으면 골키퍼가 공을 잡는 순간 공격수가 공 근처로
             * 내려온다. 실측으로 우리 골키퍼가 x=5 에서 공을 들고 있을 때
             * 최전방이 x=25 였다 — 열한 명이 자기 진영 25미터 안에 다
             * 몰려 있었다는 뜻이다. 실제 축구는 골키퍼가 공을 잡으면
             * 공격수가 하프라인 근처에 서서 길게 오기를 기다린다.
             */
            const floor = p.homeX - (p.pos === 'FW' ? 8 : 20) * dir
            tx = dir > 0 ? Math.max(short, floor) : Math.min(short, floor)
            // 받을 자리로 들어가는 움직임이다. 여기만 뛴다
            p.effort = 'RUN'
          }
          // 수비라인은 공보다 너무 뒤처지지 않는다. 압축된 블록을 유지한다
          if (p.pos === 'DF') {
            const lineCap = holder.x - 34 * dir
            tx = dir > 0 ? Math.max(tx, lineCap) : Math.min(tx, lineCap)
          }
        }

        p.tx = clamp(tx, 3, PITCH_W - 3)
        p.ty = clamp(ty, 3, PITCH_H - 3)
      } else {
        // 수비 — 추격조 세 명은 공에 달려들고 나머지는 자리를 지킨다.
        // 공을 가진 선수가 몰고 가므로 지금 자리가 아니라 갈 자리를 노린다
        const level = this.pressOf(p.side, state)
        const rank = this.chasersOf(p.side, level).indexOf(p.id)
        // 주인 없이 굴러가는 공은 지금 자리로 가면 이미 지나가 있다
        const ahead = 0.45
        const px = holder ? holder.x + holder.vx * ahead : lead.x
        const py = holder ? holder.y + holder.vy * ahead : lead.y
        const back = PRESS_BACKUP[level]

        if (rank === 0) {
          /**
           * 가장 가까운 한 명. 압박이 강하면 공까지 가고, 약하면 앞을
           * 막아서기만 한다.
           *
           * 주인 없는 공에는 물러설 이유가 없다 — 그건 압박이 아니라
           * 세컨드볼 경합이고, 안 주우면 상대가 줍는다.
           */
          const off = holder ? PRESS_STANDOFF[level] : 0
          const gx = px - p.x
          const gy = py - p.y
          const gd = Math.hypot(gx, gy) || 1
          const keep = Math.min(off, gd)
          p.tx = px - (gx / gd) * keep
          p.ty = py - (gy / gd) * keep
          p.effort = 'SPRINT'
        } else if (rank === 1) {
          // 두 번째는 뒤를 받친다 — 제쳐져도 바로 다음이 붙는다
          p.tx = px - back * dir
          p.ty = py + (p.y > py ? back * 1.2 : -back * 1.2)
          p.effort = 'RUN'
        } else if (rank === 2) {
          p.tx = px - back * 2.2 * dir
          p.ty = py + (p.y > py ? back * 2 : -back * 2)
          p.effort = 'RUN'
        } else {
          // 블록을 옮기는 여덟 명은 뛰지 않는다. 수비 대형은 걸어서 밀린다
          p.effort = 'JOG'
          // 나머지는 블록을 유지한 채 공 쪽으로 통째로 이동한다.
          // 이게 헐거우면 패스 한 번에 압박이 풀려 아무도 안 붙는 화면이
          // 된다. 실제 수비 블록은 공에서 20미터 안쪽에 모여 있다.
          //
          // **물러서라고 한 선수는 미드필더여도 수비수처럼 선다.** 공을
          // 덜 따라가고 자기 골대 쪽에 더 붙는다 — 화면에서 그 한 명만
          // 뒤에 남아 있는 것이 보인다
          const back = p.order === 'BACK_OFF'
          const compact = clamp(
            (p.pos === 'DF' || back ? 0.42 : 0.72) + PRESS_COMPACT[level],
            0.2,
            0.9,
          )
          let tx = p.homeX + (this.ball.x - p.homeX) * compact

          // 수비할 때는 자기 골대 쪽에 머문다. 상대가 자기 진영에서 공을
          // 돌린다고 우리 수비라인이 하프라인을 넘어가면 축구가 아니다
          const limit = p.pos === 'DF' || back ? -9 : 16
          tx =
            dir > 0
              ? Math.min(tx, PITCH_W / 2 + limit)
              : Math.max(tx, PITCH_W / 2 - limit)

          p.tx = clamp(tx, 3, PITCH_W - 3)
          // 수비 블록도 접는 것이 아니라 옮긴다. 공 쪽으로 중심을 옮기되
          // 좁힐 때조차 서로의 간격은 남긴다 — 백 넷의 폭은 공이 어디
          // 있든 30미터 안팎을 유지한다
          const shift = (this.ball.y - PITCH_H / 2) * 0.6
          // 좁힐 때조차 0.9 는 남긴다. 0.8 이면 백 넷의 폭이 24미터로
          // 줄어 측면이 통째로 비고, 상대가 옆으로 벌릴 곳이 사라진다
          p.ty = clamp(PITCH_H / 2 + (p.homeY - PITCH_H / 2) * 0.9 + shift, 3, PITCH_H - 3)
        }
      }

      /**
       * 골문 앞을 지켜라 — 자기 골대에서 이 거리 밖으로 못 나간다.
       *
       * 공격일 때도 걸린다. **공이 반대편에 있어도 골문 앞에 남아 있는
       * 것이 보여야** 감독이 자기가 무엇을 시켰는지 확인할 수 있다.
       * 팀 전체가 올라가는데 한 명만 안 올라가는 그림이 이 지시다.
       *
       * 공을 직접 몰거나 받으러 가는 선수는 위에서 `continue` 로 빠져
       * 여기 오지 않는다 — 수비수가 공을 걷어내러 나가는 것까지 막으면
       * 그건 축구가 아니라 말뚝이다.
       */
      if (p.order === 'HOLD') {
        const own = this.goalX(p.side === 'HOME' ? 'AWAY' : 'HOME')
        const far = own === GOAL_LINE_AWAY ? HOLD_RANGE : PITCH_W - HOLD_RANGE
        p.tx = own === GOAL_LINE_AWAY ? Math.min(p.tx, far) : Math.max(p.tx, far)
      }
    }

    /**
     * 노력 단계 보정 — 자리까지 남은 거리와 감독 지시.
     *
     * 단계 자체는 "지금 무엇을 하는 중인가"가 정하고, 여기서는 그것을
     * 상황에 맞게 한 단씩만 올리고 내린다.
     */
    for (const p of this.players) {
      if (locked.has(p.id)) continue
      const gap = Math.hypot(p.tx - p.x, p.ty - p.y)
      // 회복 주행 — 대형에서 크게 뒤처졌으면 한 단 올려 따라붙는다
      if (gap > RECOVER_GAP) p.effort = raise(p.effort)
      // 아껴 뛰어라 — 한 단 내린다. 최고 속도에 따로 배수를 곱하면
      // 단계와 이중으로 곱해져 그 선수만 눈에 띄게 굼떠진다
      if (p.order === 'CONSERVE') p.effort = lower(p.effort)
      // 거의 다 왔으면 한 단 낮춰 마무리한다. 여기서 전원을 걷게 만들면
      // 공을 향해 달려들던 선수까지 3미터 앞에서 걸어 압박이 죽는다
      if (gap < EASE_GAP) p.effort = lower(p.effort)
    }
  }

  /**
   * 이 팀이 지금 얼마나 세게 누르는가 (0·1·2).
   *
   * 우리 팀은 감독이 건 레버가 그대로 내려온다. 상대는 레버가 없으므로
   * 성향에서 읽는다 — 다 걸고 나온 팀은 높이 누르고, 버스를 세운 팀은
   * 물러서서 지연시킨다. 같은 성향이 이미 상대의 대형 위치도 정하고
   * 있으므로(`mood`) 화면에서 두 가지가 같은 방향으로 보인다.
   */
  private pressOf(side: 'HOME' | 'AWAY', state: MatchState): 0 | 1 | 2 {
    if (side === 'HOME') return state.tactics.press
    return state.opponent === 'ALL_OUT' ? 2 : state.opponent === 'PARK_BUS' ? 0 : 1
  }

  /**
   * 공에 달려들 추격조 세 명.
   *
   * 매 프레임 거리순으로 다시 뽑으면 두 선수의 순위가 오락가락할 때마다
   * 역할이 뒤바뀌어 전원이 갈지자로 뛴다. 한 번 정한 추격조는 잠깐
   * 유지하고, 공 주인이 바뀔 때 새로 짠다.
   */
  private chasersOf(side: 'HOME' | 'AWAY', level: 0 | 1 | 2): string[] {
    if (this.clock - this.chaseAt[side] > 0.7) {
      this.chaseIds[side] = this.players
        // 골문 앞을 지키라고 했거나 물러서라고 한 선수는 공에 달려들지
        // 않는다. **이게 지시가 눈에 보이는 자리다** — 열 명이 공으로
        // 몰려가는데 한 명만 자기 자리를 지키고 서 있다
        .filter((p) => p.side === side && p.pos !== 'GK' && p.order !== 'HOLD' && p.order !== 'BACK_OFF')
        .sort((a, b) => dist(a, this.ball) - dist(b, this.ball))
        .slice(0, PRESS_CHASERS[level])
        .map((p) => p.id)
      this.chaseAt[side] = this.clock
    }
    return this.chaseIds[side]
  }

  private movePlayer(p: VPlayer, dt: number) {
    if (p.recover > 0) {
      p.recover -= dt
      p.vx *= 0.85
      p.vy *= 0.85
      p.x += p.vx * dt
      p.y += p.vy * dt
      return
    }

    const dx = p.stx - p.x
    const dy = p.sty - p.y
    const d = Math.hypot(dx, dy)
    // 공을 몰고 뛰는 선수는 빈 몸으로 뛰는 선수보다 느리다.
    // 이것 때문에 수비수가 따라붙을 수 있고, 압박이 실제로 작동한다
    const carrying = this.ball.mode === 'HELD' && this.ball.holder === p.id
    /**
     * 지금 하는 일이 속도 상한을 정한다.
     *
     * 전에는 이 항이 없어서 목표가 5미터만 넘으면 예외 없이 최고 속도로
     * 뛰었다 — 목표까지 평균 13미터였으니 사실상 전원이 늘 전력질주였다.
     */
    const top =
      p.top * (0.62 + 0.38 * clamp(p.stamina, 0, 100) / 100) * (carrying ? 0.76 : 1) * EFFORT[p.effort]

    /**
     * 멈추는 문턱과 다시 출발하는 문턱을 따로 둔다(히스테리시스).
     *
     * 하나로 두면 그 값 근처에서 매 프레임 섰다 갔다를 반복해 제자리에서
     * 떠는 그림이 된다.
     */
    const stop = p.pos === 'GK' ? GK_STOP : STOP_GAP[p.effort]
    const go = p.pos === 'GK' ? GK_RESTART : RESTART_GAP[p.effort]
    if (p.settled) {
      if (d > go) p.settled = false
    } else if (d < stop) {
      p.settled = true
    }

    let wx = 0
    let wy = 0
    if (!p.settled) {
      // 빨리 뛰던 선수일수록 멀리서부터 속도를 줄인다
      const slow = SLOW_FROM[p.effort]
      const floor = Math.min(WALK, top)
      const speed = d < slow ? floor + (d / slow) * (top - floor) : top
      wx = (dx / d) * speed
      wy = (dy / d) * speed
    }

    const step = ACCEL * dt
    const ax = wx - p.vx
    const ay = wy - p.vy
    const am = Math.hypot(ax, ay)
    if (am > step) {
      p.vx += (ax / am) * step
      p.vy += (ay / am) * step
    } else {
      p.vx = wx
      p.vy = wy
    }
    p.x = clamp(p.x + p.vx * dt, 1, PITCH_W - 1)
    p.y = clamp(p.y + p.vy * dt, 1, PITCH_H - 1)
  }

  /**
   * 공에 물리를 적용한다.
   *
   * 뜬 공은 중력으로 떨어져 튀고, 땅에 있는 공은 잔디 마찰로 감속한다.
   * 이것이 없으면 공이 목표 지점에 닿는 순간 단번에 선다.
   */
  private stepBall(dt: number) {
    const b = this.ball

    if (b.z > 0 || b.vz > 0) {
      b.vz -= GRAVITY * dt
      b.z += b.vz * dt
      const drag = Math.max(0, 1 - AIR_DRAG * dt)
      b.vx *= drag
      b.vy *= drag
      if (b.z <= 0) {
        b.z = 0
        // 잔디에 떨어지며 튄다. 튈 때마다 수직 속도가 줄어 결국 구른다
        const grip = bounceGrip(Math.abs(b.vz))
        b.vz = -b.vz * BOUNCE
        if (b.vz < 0.7) b.vz = 0
        b.vx *= grip
        b.vy *= grip
      }
    }

    if (b.z <= 0.001) {
      const sp = Math.hypot(b.vx, b.vy)
      if (sp > 0) {
        const next = Math.max(0, sp - (ROLL_DECEL + ROLL_DRAG * sp) * dt)
        b.vx = (b.vx / sp) * next
        b.vy = (b.vy / sp) * next
      }
    }

    b.x += b.vx * dt
    b.y += b.vy * dt
  }

  /**
   * 지나가는 공을 잡는다.
   *
   * 공이 도착 지점에 서기를 기다리는 것이 아니다. 발이 닿는 사람이
   * 가져가고, 아무도 못 닿으면 공은 그대로 지나쳐 흐른다. 인터셉트도
   * 여기서 저절로 나온다 — 패스 길목에 서 있으면 잡힌다.
   */
  private tryCollect() {
    const b = this.ball
    if (b.z > REACH_HEIGHT) return
    // 시뮬이 골로 판정한 슛은 아무도 못 막는다. 점수판이 이미 올라갔다
    if (b.mode === 'SHOT' && b.willScore) return

    const sp = Math.hypot(b.vx, b.vy)
    // 빠른 공은 잡기 어렵고, 굴러 죽어가는 공은 걸어가서 줍는다
    const base = 1.05 + 1.25 * clamp(1 - sp / 24, 0, 1)

    let best: VPlayer | undefined
    let bd = Infinity
    for (const p of this.players) {
      if (p.recover > 0) continue
      if (b.selfLock > 0 && p.id === b.kickerId) continue
      let reach = base
      // 골키퍼는 손을 쓴다
      if (p.pos === 'GK') reach += 1.1
      // 받으려던 동료는 어디로 올지 알고 있다
      if (p.id === b.targetId) reach += 0.8
      const d = dist(p, b)
      if (d <= reach && d < bd) {
        bd = d
        best = p
      }
    }
    if (!best) return

    // 골키퍼가 슛을 막았다
    if (b.mode === 'SHOT' && best.pos === 'GK') {
      this.flash('SAVE', b.x, b.y)
      if (this.rng.next() < 0.55) {
        this.giveTo(best)
      } else {
        // 쳐냈다. 공이 옆으로 튀어나가 다시 주인 없는 공이 된다
        const ang = (this.rng.next() - 0.5) * 1.6
        const away = best.side === 'HOME' ? 1 : -1
        const v = 7 + this.rng.next() * 5
        b.mode = 'LOOSE'
        b.holder = null
        b.targetId = null
        b.kickerId = null
        b.selfLock = 0
        b.willScore = false
        b.vx = Math.cos(ang) * v * away
        b.vy = Math.sin(ang) * v
        b.vz = 2
      }
      return
    }

    // 상대 팀이 날아가는 공을 채갔으면 인터셉트다
    if (b.mode === 'PASS' && best.side !== b.lastTouch) {
      this.flash('TACKLE', b.x, b.y)
    }
    this.giveTo(best)
  }

  /**
   * 슛이 골라인을 넘었는지 본다.
   *
   * 골대 안이면 골이고, 골대 밖이면 checkOut 이 골킥으로 처리한다.
   */
  private resolveShot(): boolean {
    const b = this.ball
    const gx = this.goalX(b.lastTouch)
    const crossed = gx === GOAL_LINE_HOME ? b.x >= GOAL_LINE_HOME : b.x <= GOAL_LINE_AWAY
    if (!crossed) return false
    // 크로스바는 2.44미터다
    const inPosts = Math.abs(b.y - GOAL_MID) < GOAL_HALF && b.z < 2.44
    if (!inPosts) return false

    if (b.willScore) {
      // 골망에 꽂힌다. 공은 골 안에 그대로 두고 잠시 멈춘다
      b.mode = 'LOOSE'
      b.holder = null
      b.targetId = null
      this.stopBall()
      b.x = gx === GOAL_LINE_HOME ? PITCH_W + 0.8 : -0.8
      this.flash('GOAL', b.x, b.y)
      this.beginCelebration(b.lastTouch, b.x, b.y)
      return true
    }

    // 시뮬은 골이 아니라고 했는데 공이 골문 안으로 들어오고 있다.
    // 골키퍼가 자리를 비운 드문 경우다 — 골라인에서 걷어내 코너로 만든다.
    // 여기서 그냥 통과시키면 점수판이 안 오르는 유령 골이 나온다
    this.flash('SAVE', b.x, b.y)
    this.beginRestart('CORNER', b.lastTouch, gx, b.y < PITCH_H / 2 ? 0 : PITCH_H)
    return true
  }

  private moveBall(dt: number) {
    const b = this.ball

    if (b.mode === 'HELD') {
      const h = this.byId(b.holder)
      if (!h) {
        b.mode = 'LOOSE'
        return
      }
      // 공은 발밑에서 진행 방향으로 조금 앞서 있다
      const sp = Math.hypot(h.vx, h.vy)
      const ux = sp > 0.4 ? h.vx / sp : h.side === 'HOME' ? 1 : -1
      const uy = sp > 0.4 ? h.vy / sp : 0
      b.x += (h.x + ux * CONTROL_DIST - b.x) * Math.min(1, dt * 18)
      b.y += (h.y + uy * CONTROL_DIST - b.y) * Math.min(1, dt * 18)
      this.stopBall()
      return
    }

    b.selfLock -= dt
    this.stepBall(dt)

    // 골이 먼저다. 라인을 넘는 순간 판정하지 않으면 공이 관중석까지
    // 들어갔다 되돌아 나온다
    if (b.mode === 'SHOT' && this.resolveShot()) return
    if (this.checkOut()) return
    this.tryCollect()
  }

  /**
   * 겹침 방지.
   *
   * 두 사람이 같은 점 위에 서 있으면 사람이 아니라 표식으로 보인다.
   * 몸이 닿을 거리면 서로 밀어낸다.
   */
  private separate() {
    for (let a = 0; a < this.players.length; a++) {
      for (let b = a + 1; b < this.players.length; b++) {
        const p = this.players[a]
        const q = this.players[b]
        const dx = q.x - p.x
        const dy = q.y - p.y
        const d = Math.hypot(dx, dy)
        if (d >= 1.4 || d < 1e-6) continue
        const push = Math.min(0.08, (1.4 - d) / 2)
        const ux = dx / d
        const uy = dy / d
        p.x = clamp(p.x - ux * push, 1, PITCH_W - 1)
        p.y = clamp(p.y - uy * push, 1, PITCH_H - 1)
        q.x = clamp(q.x + ux * push, 1, PITCH_W - 1)
        q.y = clamp(q.y + uy * push, 1, PITCH_H - 1)
      }
    }
  }

  /** 관전 장면을 dt 초만큼 진행시킨다 */
  advance(state: MatchState, dt: number) {
    const step = Math.min(dt, 0.05)
    this.clock += step

    for (const f of this.flashes) f.life -= step
    this.flashes = this.flashes.filter((f) => f.life > 0)

    // 심판은 데드볼에도 움직인다. 세리머니·재개·교체 중에 셋만 얼어붙어
    // 있으면 그 순간마다 화면에 붙여놓은 그림처럼 보인다
    this.updateOfficials(step)

    // 쓰러진 선수는 세리머니·데드볼 중에도 시간이 간다. 여기서 멈추면
    // 골 뒤에 쓰러진 선수가 몇 초 더 누워 있다
    for (const d of this.downed) d.life -= step
    this.downed = this.downed.filter((d) => d.life > 0)

    // 나가는 선수는 터치라인까지 걸어 나간다
    for (const l of this.leaving) {
      l.life -= step
      const k = Math.min(1, step * 2.2)
      l.x += (l.tx - l.x) * k
      l.y += (l.ty - l.y) * k
    }
    this.leaving = this.leaving.filter((l) => l.life > 0)

    /**
     * 교체 — 플레이가 잠깐 멈춘다.
     *
     * 시뮬은 계속 돌아간다. 멈추는 것은 화면의 공뿐이다. 이 몇 초가
     * 없으면 선수가 그 자리에서 소리 없이 다른 사람으로 바뀐다.
     *
     * 들어오는 선수만 움직인다 — 터치라인에서 자기 자리로 뛰어 들어간다.
     * **나머지 스물한 명은 선다.** 교체는 주심이 경기를 멈추고 진행하는
     * 것이라 그동안 다른 선수가 자리를 옮기지 않는다.
     */
    // 공이 날아가는 중이면 도착할 때까지 기다렸다 멈춘다. 공중에서
    // 얼어붙은 공은 고장난 화면과 구분되지 않는다
    const flying = this.ball.mode === 'PASS' || this.ball.mode === 'SHOT'
    if (this.subPause > 0 && !flying) {
      this.subPause -= step
      this.setTargets(state)
      for (const p of this.players) {
        if (p.side !== 'HOME' || !this.entering.includes(p.num)) {
          this.stand(p, step)
          continue
        }
        p.stx += (p.tx - p.stx) * Math.min(1, step * 5)
        p.sty += (p.ty - p.sty) * Math.min(1, step * 5)
        this.movePlayer(p, step)
      }
      if (this.subPause <= 0) this.entering = []
      return
    }

    // 세리머니 중에는 공이 골망에 있고 선수들은 제자리로 돌아간다
    if (this.celebration) {
      this.celebration.life -= step
      for (const p of this.players) {
        p.tx = p.homeX
        p.ty = p.homeY
        p.stx = p.homeX
        p.sty = p.homeY
        // 킥오프 자리로 돌아가는 길이다. 여기서 전력으로 뛰는 사람은 없다
        p.effort = 'JOG'
        this.movePlayer(p, step)
      }
      this.ball.x = this.celebration.x
      this.ball.y = this.celebration.y
      if (this.celebration.life <= 0) {
        const restartFor = this.celebration.side === 'HOME' ? 'AWAY' : 'HOME'
        this.celebration = null
        this.kickoff(restartFor)
      }
      return
    }

    // 공이 밖으로 나갔다. 규칙대로 다시 넣을 때까지 경기는 멈춰 있다.
    //
    // 골 예약의 시계도 함께 멈춘다. 점수판은 실제 골 장면이 나올 때까지
    // 기다리므로 데드볼 중에 예약 시간이 끝날 이유가 없다. 여기서 시간을
    // 줄이면 스로인·골킥을 준비하는 도중 공이 골망으로 순간이동해
    // "아웃되려던 공이 갑자기 실점"으로 보인다.
    if (this.restart) {
      this.updateRestart(state, step)
      return
    }

    this.setTargets(state)

    // 목표를 부드럽게 따라간다. 역할이 바뀌어 목표가 반대편으로 튀어도
    // 몸이 홱 꺾이지 않고 사람처럼 방향을 눌러서 바꾼다
    const follow = Math.min(1, step * 5)
    for (const p of this.players) {
      p.stx += (p.tx - p.stx) * follow
      p.sty += (p.ty - p.sty) * follow
    }

    const holder = this.byId(this.ball.holder)
    if (holder && this.ball.mode === 'HELD') {
      this.updatePressure(holder, step)
      // 휘슬이 불렸으면 이 프레임은 여기서 끝이다. 아래로 내려가면 이미
      // 놓아둔 공을 `moveBall` 이 다시 굴리고 `tryPendingShot` 이 집어간다
      if (this.restart) return
      // 방금 태클로 주인이 바뀌었을 수 있다
      const now = this.byId(this.ball.holder)
      if (now && this.ball.mode === 'HELD') this.decide(now, step)
    }

    for (const p of this.players) this.movePlayer(p, step)
    this.separate()
    this.moveBall(step)
    // 공이 멎었으면 들고 있던 깃발이 휘슬이 된다
    this.settleFlag()
    // 공이 움직인 뒤에 센다. 전개 시간은 "지금 공이 어디 있나"의 함수다
    this.updateAttackTime(step)
    this.reconcileOwner(step)
    this.tryPendingShot(step)
  }
}
