import { BASE, XG } from './constants'
import type { Rng } from './rng'
import type { Coefficients } from './tactics'

/** 한 틱 분량의 난수 18개. 슬롯 이름은 소비 순서를 그대로 따른다 */
export interface TickDraws {
  behind: number
  behindShot: number
  homeAttempt: number
  homeEnter: number
  homeShot: number
  awayAttempt: number
  awayEnter: number
  awayShot: number
  setPiece: number
  setPieceShot: number
  foul: number
  foulTarget: number
  card: number
  penalty: number
  penaltyShot: number
  sendOff: number
  injury: number
  injuryTarget: number
}

/**
 * 매 틱 정확히 18개를 고정 순서로 뽑는다.
 *
 * 조건 분기 안에서 뽑으면 분기가 갈릴 때마다 이후 수열이 밀려 재현이
 * 조용히 깨진다. 필요 없는 슬롯도 반드시 뽑아서 버린다.
 *
 * 이 순서를 바꾸면 저장된 모든 시드의 결과가 달라진다.
 */
export function drawTick(rng: Rng): TickDraws {
  return {
    behind: rng.next(),
    behindShot: rng.next(),
    homeAttempt: rng.next(),
    homeEnter: rng.next(),
    homeShot: rng.next(),
    awayAttempt: rng.next(),
    awayEnter: rng.next(),
    awayShot: rng.next(),
    setPiece: rng.next(),
    setPieceShot: rng.next(),
    foul: rng.next(),
    foulTarget: rng.next(),
    card: rng.next(),
    penalty: rng.next(),
    penaltyShot: rng.next(),
    sendOff: rng.next(),
    injury: rng.next(),
    injuryTarget: rng.next(),
  }
}

/**
 * 한 틱의 공격 판정 4채널.
 *
 * 우리 공격 1개, 상대 3개(배후·오픈플레이·세트피스).
 * 세트피스를 별도 채널로 두는 이유는 라인을 내릴 때 늘어나는 실점 경로가
 * 여기뿐이기 때문이다. 이것이 없으면 라인 낮음이 지배 전략이 된다.
 */
export interface AttackOutcome {
  homeGoals: number
  awayGoals: number
  /**
   * 분석 화면이 읽는 득점 경로.
   *
   * 판정에 새 값을 보태지 않고, 이미 참이 된 채널의 이름만 기록한다.
   * 따라서 난수 소비와 득점 결과에는 영향이 없다.
   */
  homeGoalCauses: Array<'BUILD_UP'>
  awayGoalCauses: Array<'BEHIND' | 'OPEN_PLAY' | 'SET_PIECE'>
  /** 화면의 양상 지표가 읽는다. 판정에는 쓰이지 않는다 */
  homeAttempt: number
  awayAttempt: number
  homeShot: number
  awayShot: number
  setPiece: number
  behind: number
}

export function resolveAttacks(
  d: TickDraws,
  c: Coefficients,
  homeFactor: number,
  minDefenderSpeed: number,
): AttackOutcome {
  // 한 틱은 경기 화면의 한 순간이다. 먼저 확정된 득점 뒤에 같은 순간의
  // 다른 공격 채널이 또 득점으로 굳지 않도록 하나의 득점만 인정한다.
  let goalClaimed = false
  const o: AttackOutcome = {
    homeGoals: 0,
    awayGoals: 0,
    // 아래 원인 배열은 이미 난 득점을 설명할 뿐, 어느 판정에도 다시 들어가지 않는다.
    homeGoalCauses: [],
    awayGoalCauses: [],
    homeAttempt: 0,
    awayAttempt: 0,
    homeShot: 0,
    awayShot: 0,
    setPiece: 0,
    behind: 0,
  }

  // 상대 배후 침투 — 우리 수비수 중 가장 느린 선수가 확률을 직접 올린다
  const speedPenalty = 1 + (75 - minDefenderSpeed) / 100
  if (d.behind < BASE.B0 * c.behind * speedPenalty) {
    o.behind += 1
    o.awayShot += 1
    // 일대일까지 갈 확률 0.75, 그 슛의 xG 0.185 → 합쳐서 0.139
    if (d.behindShot < XG.oneOnOne * XG.shotSelectOneOnOne) {
      o.awayGoals += 1
      o.awayGoalCauses.push('BEHIND')
      goalClaimed = true
    }
  }

  // 우리 공격 — 폭이 시도 "횟수"에 곱해진다
  if (d.homeAttempt < BASE.A0 * c.widthK) {
    o.homeAttempt += 1
    if (d.homeEnter < BASE.P_ENTER * c.openness) {
      o.homeShot += 1
      if (!goalClaimed && d.homeShot < XG.boxCentre * c.entryXg * homeFactor) {
        o.homeGoals += 1
        o.homeGoalCauses.push('BUILD_UP')
        goalClaimed = true
      }
    }
  }

  // 상대 오픈플레이 — 골문 앞을 지키라는 지시가 마무리를 깎는다.
  // 상대가 오는 횟수는 그대로고 넣는 확률만 준다
  if (d.awayAttempt < BASE.O0 * c.oppOpen) {
    o.awayAttempt += 1
    if (d.awayEnter < BASE.P_ENTER_OPP) {
      o.awayShot += 1
      if (!goalClaimed && d.awayShot < XG.boxCentre * c.oppShotXg) {
        o.awayGoals += 1
        o.awayGoalCauses.push('OPEN_PLAY')
        goalClaimed = true
      }
    }
  }

  // 세트피스 — 라인을 내릴수록 늘어난다. 화면에서는 코너 횟수로 읽힌다.
  //
  // 골문 앞을 지키라는 지시는 세트피스를 **덜 내주는** 것이 아니라 내준
  // 세트피스에서 **덜 먹는다**(`c.oppShotXg`). 코너는 그대로 오지만
  // 골문 앞에 남은 사람이 헤딩을 따낸다. 지시가 없으면 1.0이다
  if (d.setPiece < BASE.S0 * c.setPiece) {
    o.setPiece += 1
    if (!goalClaimed && d.setPieceShot < XG.setPiece * c.oppShotXg) {
      o.awayGoals += 1
      o.awayGoalCauses.push('SET_PIECE')
      goalClaimed = true
    }
  }

  return o
}
