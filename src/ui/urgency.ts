import { TOTAL_TICKS } from '../sim/constants'
import { meanStamina } from '../sim/squad'
import type { MatchState } from '../sim/types'

/**
 * 「지금 위험」 — 이 경기에서 지금 가장 급한 것 한 줄.
 *
 * 디자인 핸드오프의 핵심 결정이다. 원문 그대로 — *"경고를 여러 개 띄우지
 * 않고 우선순위 하나만 문장으로 보여준다"*.
 *
 * **왜 하나만 보여주는가.** 한 판이 75초다. 경고를 셋 띄우면 감독은 셋 다
 * 안 읽는다. 지금 가장 급한 것 하나를 문장으로 주면 그건 읽고 누른다.
 *
 * **색만으로 구분하지 않는다.** 색을 못 가리는 사람에게도 전해져야 하므로
 * 등급(`tone`)이 바뀌면 **문장도 함께** 바뀐다. 화면은 여기에 삼각형
 * 마커까지 더해 세 겹으로 구분한다.
 *
 * 순수 함수다. `Date` · `Math.random` · 브라우저를 쓰지 않으므로 같은
 * 상태에는 언제나 같은 문장이 나오고 검사로 고정할 수 있다.
 */

export type UrgencyTone = 'DANGER' | 'WARN' | 'CALM'

export interface Urgency {
  /** 무엇이 급한가 */
  id: string
  tone: UrgencyTone
  text: string
}

/** 이 아래면 지친 것으로 본다. 부상 임계(25)보다 먼저 경고한다 */
const SPENT = 45

/** 팀 평균이 이 아래면 교체를 생각할 때다 */
const TEAM_TIRED = 52

/**
 * 상대 슈팅이 우리보다 이만큼 많으면 밀리고 있는 것이다.
 *
 * 핸드오프 원안은 **기대 득점(xG) 차이 0.8**이었다. 우리 엔진은 xG 를
 * 기록하지 않는다 — 없는 값을 지어내면 화면이 거짓말을 하게 되므로,
 * 실제로 기록하는 **슈팅 수**로 같은 판단을 만든다. 한 판 750틱에 우리
 * 슈팅이 대여섯 번이라 세 번 차이면 뚜렷이 밀리는 것이다.
 */
const SHOT_GAP = 3

/**
 * 지금 화면에 띄울 경고 하나. 위에서부터 먼저 걸리는 것이 이긴다.
 *
 * 순서가 곧 설계다. 되돌릴 수 없는 사건(퇴장)이 가장 위이고, 아직
 * 되돌릴 수 있는 것(교체)이 아래다.
 */
export function urgencyOf(state: MatchState): Urgency {
  const onPitch = state.players.filter((s) => s.onPitch && !s.out)
  const spent = onPitch.filter((s) => s.stamina < SPENT)

  // 1. 퇴장은 되돌릴 수 없다. 경고 보유자가 있으면 더 급하다
  if (state.tactics.press === 2 && spent.length > 0) {
    return {
      id: 'press-spent',
      tone: 'DANGER',
      text: '압박 강 + 체력 소진 — 반칙과 퇴장 위험',
    }
  }

  // 2. 실제로 밀리고 있는가. 기록에 있는 슈팅 수로만 판단한다
  if (state.stats.awayShot - state.stats.homeShot >= SHOT_GAP) {
    return {
      id: 'outshot',
      tone: 'DANGER',
      text: '상대가 더 많이 두드리고 있습니다 — 배후를 먼저 막으세요',
    }
  }

  // 3. 라인 낮음의 대가. 이 시뮬레이션의 핵심 반전이라 해당할 때만 꺼낸다
  if (state.tactics.line === 0) {
    return {
      id: 'low-line',
      tone: 'WARN',
      text: '내려앉아 있습니다 — 세트피스를 계속 내줍니다',
    }
  }

  // 4. 아직 되돌릴 수 있다. 교체 카드가 남아 있을 때만 말한다
  if (meanStamina(state.players) < TEAM_TIRED && state.subsLeft > 0) {
    return {
      id: 'team-tired',
      tone: 'WARN',
      text: '평균 체력이 떨어졌습니다 — 교체를 고려하세요',
    }
  }

  return { id: 'calm', tone: 'CALM', text: '균형을 유지하고 있습니다' }
}

/**
 * 남은 실제 시간(초).
 *
 * **경기 분(88:12)과 다른 값이다.** 핸드오프가 둘을 일부러 갈라놨다 —
 * *"경기 분과 실제 남은 초를 분리해 시간 압박을 몸으로 느끼게 한다"*.
 * 화면의 88분은 경기 안의 시각이고, 이 숫자는 감독에게 실제로 남은 시간이다.
 */
export function secondsLeft(tick: number): number {
  return Math.max(0, Math.ceil((TOTAL_TICKS - tick) / 10))
}

/** 남은 시간의 급함. 색과 문장이 함께 바뀌는 기준이다 */
export function clockTone(seconds: number): UrgencyTone {
  if (seconds <= 15) return 'DANGER'
  if (seconds <= 30) return 'WARN'
  return 'CALM'
}

/** 0~1. 진행 바가 줄어드는 비율 */
export function clockRatio(tick: number): number {
  return Math.max(0, Math.min(1, (TOTAL_TICKS - tick) / TOTAL_TICKS))
}
