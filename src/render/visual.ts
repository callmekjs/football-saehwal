import { createRng, type Rng } from '../sim/rng'
import { getFormation, slotsForTenMen } from '../sim/formations'
import { getPlayer } from '../sim/squad'
import { TOTAL_TICKS } from '../sim/constants'
import type { MatchState, PlayerOrder, Position } from '../sim/types'

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
const AWAY_SHAPE: Array<[Position, number, number]> = [
  ['GK', 103, 34],
  ['DF', 84, 12],
  ['DF', 86, 27],
  ['DF', 86, 41],
  ['DF', 84, 56],
  ['MF', 66, 14],
  ['MF', 64, 29],
  ['MF', 64, 39],
  ['MF', 66, 54],
  ['FW', 46, 27],
  ['FW', 46, 41],
]
const AWAY_NUMS = [1, 2, 5, 4, 3, 7, 8, 10, 6, 9, 11]

const TOP_SPEED: Record<Position, number> = { GK: 5.2, DF: 7.4, MF: 7.6, FW: 8.0 }

export class VisualMatch {
  players: VPlayer[] = []
  ball: VBall
  flashes: Flash[] = []
  /** 골이 들어간 뒤의 세리머니. 이 동안은 경기가 멈춰 있다 */
  celebration: Celebration | null = null
  /** 공이 밖으로 나가 재개를 기다리는 중 */
  restart: Restart | null = null
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
    const tenMen = state.homeCount < 11
    const onPitch = state.players.filter((s) => s.onPitch && !s.out)
    /**
     * 자리 수는 실제 인원을 넘지 않는다.
     *
     * 열 명용 배치는 자리가 열 개다. 부상이나 추가 퇴장으로 아홉 명이
     * 되면 남는 자리에 **등번호 0번인 유령이 그려졌다.** 화면에서 실제로
     * 봤다 — 우리 팀이 열 명이라고 적혀 있는데 피치에는 0번이 뛰고 있었다.
     */
    const slots = (tenMen ? slotsForTenMen(state.formation) : getFormation(state.formation).slots)
      .slice(0, onPitch.length)

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
    const taken: Array<(typeof onPitch)[number] | null> = new Array(slots.length).fill(null)
    const rest: typeof onPitch = []
    for (const s of onPitch) {
      const prev = keep.get(`H${getPlayer(s.id).num}`)
      const k = prev?.slot
      if (k !== undefined && k >= 0 && k < slots.length && taken[k] === null) taken[k] = s
      else rest.push(s)
    }
    for (const s of rest) {
      const pos = getPlayer(s.id).pos
      let k = taken.findIndex((v, i) => v === null && slots[i].pos === pos)
      if (k < 0) k = taken.findIndex((v) => v === null)
      if (k >= 0) taken[k] = s
    }

    taken.forEach((s, i) => {
      if (!s) return
      const slot = slots[i]
      const num = getPlayer(s.id).num
      const id = `H${num}`
      const prev = keep.get(id)
      // 새로 들어온 선수는 터치라인에서 걸어 들어온다
      const entry = this.entryAt.get(id)
      this.entryAt.delete(id)
      next.push({
        id,
        num,
        side: 'HOME',
        pos: slot.pos,
        x: prev?.x ?? entry?.x ?? slot.x,
        y: prev?.y ?? entry?.y ?? slot.y,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        tx: slot.x,
        ty: slot.y,
        stx: prev?.stx ?? entry?.x ?? slot.x,
        sty: prev?.sty ?? entry?.y ?? slot.y,
        slot: i,
        homeX: slot.x,
        homeY: slot.y,
        top: TOP_SPEED[slot.pos],
        stamina: s.stamina,
        booked: s.booked,
        order: s.order,
        recover: prev?.recover ?? 0,
        effort: prev?.effort ?? 'JOG',
        settled: prev?.settled ?? false,
      })
    })

    const awayLimit = state.awayCount === 11 ? 11 : 10
    AWAY_SHAPE.slice(0, awayLimit).forEach(([pos, x, y], i) => {
      const num = AWAY_NUMS[i]
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
        top: TOP_SPEED[pos],
        stamina: 84,
        booked: false,
        // 지시는 우리 팀에게만 내린다
        order: 'NONE',
        recover: prev?.recover ?? 0,
        effort: prev?.effort ?? 'JOG',
        settled: prev?.settled ?? false,
      })
    })

    this.players = next
    this.lastFormation = state.formation
    this.lastLineup = this.lineupOf(state).join(',')
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
    if (state.tick >= TOTAL_TICKS) this.displayScore = [...state.score] as [number, number]

    // 대형을 다시 짜기 전에 읽어야 한다. 다시 짜고 나면 빠진 선수가
    // 목록에서 사라져 어디에 쓰러졌는지 알 방법이 없다
    this.captureDowned(state)

    // **명단이 바뀌면** 다시 짠다. 인원 수만 보면 열한 명이 열한 명으로
    // 유지되는 교체를 놓친다 — 그게 "교체가 화면에 안 나온다"의 정체였다
    if (state.formation !== this.lastFormation || this.lineupOf(state).join(',') !== this.lastLineup) {
      this.rebuild(state)
    }

    const onPitch = state.players.filter((s) => s.onPitch && !s.out)
    const slots = state.homeCount < 11
      ? slotsForTenMen(state.formation)
      : getFormation(state.formation).slots

    // 체력·경고를 갱신한다. 지친 선수는 실제로 느려진다
    const byNum = new Map(onPitch.map((s) => [`H${getPlayer(s.id).num}`, s]))
    const lineShift = (state.tactics.line - 1) * 8
    const widthScale = 0.8 + state.tactics.width * 0.18
    for (const v of this.players) {
      if (v.side !== 'HOME') continue
      const s = byNum.get(v.id)
      if (!s) continue
      v.stamina = s.stamina
      v.booked = s.booked
      v.order = s.order
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
    AWAY_SHAPE.forEach(([pos, x, y], i) => {
      const v = this.byId(`A${AWAY_NUMS[i]}`)
      if (!v) return
      v.homeX = pos === 'GK' ? x : x + mood
      v.homeY = y
    })

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
      this.queueShot(scored > 0 ? 'HOME' : 'AWAY', true)
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
    const tx = clamp(to.x + to.vx * 0.3, 2, PITCH_W - 2)
    const ty = clamp(to.y + to.vy * 0.3, 2, PITCH_H - 2)
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
    if (side === 'HOME') this.displayScore[0] += 1
    else this.displayScore[1] += 1
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
    this.restart = { kind, side, x: px, y: py, wait: 0.35, takerId: taker?.id ?? null, age: 0 }
  }

  /**
   * 재개를 진행한다.
   *
   * 차는 선수가 공까지 걸어가고, 나머지는 각자 자리를 잡는다. 공이 나간
   * 순간 전원이 얼어붙으면 정지 화면이 되고, 아무도 안 멈추면 공이 밖에
   * 나갔다는 것 자체가 안 보인다.
   */
  private updateRestart(state: MatchState, step: number) {
    const r = this.restart
    if (!r) return
    r.wait -= step
    r.age += step

    this.setTargets(state)
    const taker = this.byId(r.takerId)
    if (taker) {
      taker.tx = r.x
      taker.ty = r.y
      taker.stx = r.x
      taker.sty = r.y
      // 공을 주우러 가는 길이다. 여기서 멈춰 서면 재개가 걸린다
      taker.effort = 'RUN'
      taker.settled = false
    }
    for (const p of this.players) this.movePlayer(p, step)
    this.separate()

    this.ball.x = r.x
    this.ball.y = r.y
    this.stopBall()

    if (r.wait > 0) return
    // 차는 선수가 공에 닿아야 재개된다. 아무도 못 가면(퇴장 등) 오래
    // 붙잡혀 있을 수 없으므로 보호 시간을 둔다
    if (taker && dist(taker, r) < 2.6) {
      this.restart = null
      this.giveTo(taker)
      this.armThrow(r.kind, taker)
    } else if (r.age > 4) {
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
      if (d < 5 || d > 46) continue

      // 앞으로 갈수록 좋고, 상대가 붙어 있으면 나쁘다
      const forward = (p.x - holder.x) * dir
      const marker = this.players.reduce((m, o) => {
        if (o.side === holder.side) return m
        return Math.min(m, dist(o, p))
      }, Infinity)
      const score = forward * 0.9 + Math.min(marker, 18) * 1.4 - d * 0.25 + this.rng.next() * 6
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    return best
  }

  private pass(holder: VPlayer, to: VPlayer) {
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
        tx = clamp(marker.x + Math.cos(ang) * 1.2, -6, PITCH_W + 6)
        ty = clamp(marker.y + Math.sin(ang) * 1.2, -6, PITCH_H + 6)
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
   * 8m 92% · 12m 82% · 16.5m 57% · 20m 38% · 25m 10% · 27m 이상 0%
   */
  private shotWant(p: VPlayer, nearest: number): number {
    const gx = this.goalX(p.side)
    const gd = Math.hypot(gx - p.x, GOAL_MID - p.y)
    // 각이 닫혀 있으면 못 쏜다. 골라인 옆 코너에서 때리는 것은 축구가 아니다
    if (Math.abs(p.y - GOAL_MID) > 7 + gd * 0.7) return 0
    let want = clamp(1.15 - (gd - 6) * 0.055, 0, 0.92)
    // 코앞에 몸을 던지면 쏠 각이 없다. 이때는 내주는 것이 정답이다
    if (nearest < 1.7) want *= 0.45
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
        let ey = (PITCH_H / 2 - p.y) * 0.015
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
            ty = clamp(holder.y + away * (8 + (p.pos === 'FW' ? 4 : 0)), 4, PITCH_H - 4)
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
        const rank = this.chasersOf(p.side).indexOf(p.id)
        // 주인 없이 굴러가는 공은 지금 자리로 가면 이미 지나가 있다
        const ahead = 0.45
        const px = holder ? holder.x + holder.vx * ahead : lead.x
        const py = holder ? holder.y + holder.vy * ahead : lead.y

        if (rank === 0) {
          p.tx = px
          p.ty = py
          // 가장 가까운 한 명만 공을 향해 전력으로 달려든다
          p.effort = 'SPRINT'
        } else if (rank === 1) {
          // 두 번째는 뒤를 받친다 — 제쳐져도 바로 다음이 붙는다
          p.tx = px - 4 * dir
          p.ty = py + (p.y > py ? 5 : -5)
          p.effort = 'RUN'
        } else if (rank === 2) {
          p.tx = px - 9 * dir
          p.ty = py + (p.y > py ? 8 : -8)
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
          const compact = p.pos === 'DF' || back ? 0.42 : 0.72
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
          p.ty = clamp(PITCH_H / 2 + (p.homeY - PITCH_H / 2) * 0.8 + shift, 3, PITCH_H - 3)
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
    void state
  }

  /**
   * 공에 달려들 추격조 세 명.
   *
   * 매 프레임 거리순으로 다시 뽑으면 두 선수의 순위가 오락가락할 때마다
   * 역할이 뒤바뀌어 전원이 갈지자로 뛴다. 한 번 정한 추격조는 잠깐
   * 유지하고, 공 주인이 바뀔 때 새로 짠다.
   */
  private chasersOf(side: 'HOME' | 'AWAY'): string[] {
    if (this.clock - this.chaseAt[side] > 0.7) {
      this.chaseIds[side] = this.players
        // 골문 앞을 지키라고 했거나 물러서라고 한 선수는 공에 달려들지
        // 않는다. **이게 지시가 눈에 보이는 자리다** — 열 명이 공으로
        // 몰려가는데 한 명만 자기 자리를 지키고 서 있다
        .filter((p) => p.side === side && p.pos !== 'GK' && p.order !== 'HOLD' && p.order !== 'BACK_OFF')
        .sort((a, b) => dist(a, this.ball) - dist(b, this.ball))
        .slice(0, 3)
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
     */
    // 공이 날아가는 중이면 도착할 때까지 기다렸다 멈춘다. 공중에서
    // 얼어붙은 공은 고장난 화면과 구분되지 않는다
    const flying = this.ball.mode === 'PASS' || this.ball.mode === 'SHOT'
    if (this.subPause > 0 && !flying) {
      this.subPause -= step
      this.setTargets(state)
      for (const p of this.players) {
        if (p.side !== 'HOME' || !this.entering.includes(p.num)) continue
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
      // 방금 태클로 주인이 바뀌었을 수 있다
      const now = this.byId(this.ball.holder)
      if (now && this.ball.mode === 'HELD') this.decide(now, step)
    }

    for (const p of this.players) this.movePlayer(p, step)
    this.separate()
    this.moveBall(step)
    // 공이 움직인 뒤에 센다. 전개 시간은 "지금 공이 어디 있나"의 함수다
    this.updateAttackTime(step)
    this.reconcileOwner(step)
    this.tryPendingShot(step)
  }
}
