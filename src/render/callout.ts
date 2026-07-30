import { PITCH_W } from './visual'
import type { Restart, Whistle } from './visual'

/**
 * 왜 갑자기 공이 넘어갔는지 한 줄로 알려준다.
 *
 * 사용자 지적이다 — *"반칙을 하면 파울, 핸드볼, 아웃 표시를 해줘 왜 갑자기
 * 공을 주는 지 모르잖아"*. 맞는 지적이었다. 관전 계층은 스로인·골킥·
 * 코너킥·프리킥·오프사이드를 **이미 전부 알고 있었는데** 그것을 글자로
 * 내보내는 곳이 한 군데도 없었다. 심판이 휘슬을 불고 깃발이 올라가도,
 * 축구 규칙을 아는 사람이 아니면 공이 왜 저쪽 것이 됐는지 알 수 없다.
 *
 * 오른쪽 `경기 이벤트` 목록으로는 부족하다. 그쪽은 **골·경고·교체만**
 * 싣고 파울은 아예 걸러내며(`e.kind !== 'FOUL'`), 무엇보다 눈이 경기장에
 * 가 있는 동안 옆 목록을 읽지 않는다. 그래서 경기장 위에 띄운다.
 *
 * **없는 사실을 만들지 않는다.** 여기 나오는 종류와 어느 팀 공인지는 전부
 * `Restart` 와 `Whistle` 에 이미 들어 있는 값이다. 핸드볼만 예외이며
 * 아래에 그 근거를 적어 둔다.
 *
 * 순수 함수다. 캔버스도 시계도 난수도 모른다.
 */

export type CalloutTone =
  /** 페널티킥·퇴장처럼 경기를 가르는 판정 */
  | 'BIG'
  /** 반칙으로 멈춘 것 */
  | 'FOUL'
  /** 공이 밖으로 나가 다시 넣는 것 */
  | 'OUT'

export interface Callout {
  /** 무슨 일이 있었나 */
  text: string
  /** 그래서 누구 공인가. 해당 없으면 빈 문자열 */
  side: string
  tone: CalloutTone
}

const sideWord = (side: 'HOME' | 'AWAY'): string => (side === 'HOME' ? '우리 공' : '상대 공')

/**
 * 이 반칙을 핸드볼로 부를 것인가.
 *
 * **시뮬레이션에는 반칙 종류가 없다.** `EVENTS.foulBase` 로 "반칙이 났다"만
 * 정하고 그것이 발인지 손인지는 모른다. 실제 축구의 반칙은 트립·푸시·
 * 핸드볼이 섞여 있으므로, 전부 "파울"로만 적으면 그것대로 축구가 아니다.
 *
 * 그래서 관전 계층이 정한다. 이건 지어내는 것이 아니라 **시뮬이 정하지
 * 않고 남겨둔 자리를 채우는 것**이고, 프리킥을 어디서 차는지·누가 차는지·
 * 벽에 몇 명이 서는지를 관전 계층이 이미 같은 방식으로 정하고 있다.
 *
 * 두 가지를 지킨다.
 *
 * 1. **난수를 쓰지 않는다.** 자리 좌표에서 결정적으로 뽑으므로 같은 경기는
 *    언제나 같은 판정을 낸다. `drawTick()` 의 18슬롯과 무관하다.
 * 2. **페널티 지역 안에서는 절대 핸드볼이라고 하지 않는다.** 박스 안
 *    핸드볼은 페널티킥이다. 시뮬은 페널티를 따로 정하므로, 여기서 박스 안
 *    반칙을 핸드볼로 부르면 "핸드볼인데 프리킥"이라는 축구에 없는 장면이
 *    만들어진다. 밖에서만 부른다.
 */
export function isHandball(x: number, y: number): boolean {
  // 경계값도 제외한다. `<` 로 두면 정확히 20m·85m 지점이 빠져나간다
  if (x <= PENALTY_FREE_ZONE || x >= PITCH_W - PENALTY_FREE_ZONE) return false
  // 좌표를 센티미터 단위 정수로 눕혀 섞는다. 같은 자리는 언제나 같은 답이다
  const key = (Math.round(x * 100) * 73856093) ^ (Math.round(y * 100) * 19349663)
  return (key >>> 0) % 100 < HANDBALL_SHARE
}

/**
 * 이 거리 안쪽은 핸드볼이라고 부르지 않는다.
 *
 * 페널티 지역은 골라인에서 16.5m다. 경계에 딱 붙은 반칙은 관전자가 박스
 * 안인지 밖인지 구분하기 어려우므로 여유를 두고 20m로 잡았다.
 */
const PENALTY_FREE_ZONE = 20

/** 반칙 100번 중 핸드볼로 부르는 횟수. 실제 축구의 핸드볼은 소수다 */
const HANDBALL_SHARE = 16

/**
 * 지금 화면에 띄울 한 줄. 없으면 `null`.
 *
 * **순서가 중요하다.** 휘슬과 재개는 함께 존재할 수 있다 — 반칙 프리킥은
 * `whistle.kind === 'FOUL'` 과 `restart.kind === 'FREE_KICK'` 이 동시에
 * 참이다. 경기를 가르는 판정(페널티킥·카드·오프사이드)을 먼저 보고,
 * 그다음에 공이 어떻게 재개되는지를 본다.
 */
export function calloutOf(
  restart: Restart | null,
  whistle: Whistle | null,
): Callout | null {
  if (whistle) {
    if (whistle.kind === 'PENALTY') return { text: '페널티킥', side: '', tone: 'BIG' }
    if (whistle.kind === 'CARD') {
      return whistle.red
        ? { text: '퇴장', side: '', tone: 'BIG' }
        : { text: '경고', side: '', tone: 'FOUL' }
    }
    if (whistle.kind === 'OFFSIDE') return { text: '오프사이드', side: '', tone: 'FOUL' }
  }

  if (restart) {
    const side = sideWord(restart.side)
    if (restart.kind === 'FREE_KICK') {
      const hand = isHandball(restart.x, restart.y)
      return { text: hand ? '핸드볼' : '파울', side: `${side} 프리킥`, tone: 'FOUL' }
    }
    if (restart.kind === 'THROW_IN') return { text: '스로인', side, tone: 'OUT' }
    if (restart.kind === 'GOAL_KICK') return { text: '골킥', side, tone: 'OUT' }
    if (restart.kind === 'CORNER') return { text: '코너킥', side, tone: 'OUT' }
  }

  // 킥오프는 재개가 아니라 휘슬로만 남는다. 가장 낮은 우선순위다
  if (whistle?.kind === 'KICKOFF') return { text: '킥오프', side: '', tone: 'OUT' }

  return null
}
