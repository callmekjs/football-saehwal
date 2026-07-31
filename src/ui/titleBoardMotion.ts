/**
 * 첫 화면 전술판의 움직임.
 *
 * 사용자가 정했다 — *"점들 각각 전술적으로 움직이는 거."* 제자리에서 떠는
 * 것은 살아 있는 것이 아니다. 축구에서 공이 없는 스물한 명이 움직이는
 * 이유는 **공의 위치** 하나다.
 *
 * ## 무엇이 「전술적」인가
 *
 * 1. **블록이 통째로 공을 따라간다.** 공이 왼쪽으로 가면 양 팀이 다 왼쪽으로
 *    민다. 오른쪽 수비수가 제자리에 남아 있으면 그 팀은 가로로 찢어진다.
 * 2. **공이 깊이 들어오면 두 팀이 함께 내려온다.** 우리 수비는 물러서고
 *    상대 공격수도 따라 내려온다. 한쪽만 움직이면 사이가 비어버린다.
 * 3. **공을 안 가진 쪽에서 가장 가까운 한 명이 나가서 잡는다.** 이게 압박이다.
 *    스물두 명이 다 같은 간격으로 움직이면 아무도 공을 뺏지 않는다.
 * 4. **골키퍼는 거의 안 움직인다.** 필드 선수와 같은 폭으로 흔들리면
 *    골키퍼가 아니라 열한 번째 필드 선수다.
 *
 * ## 브라우저를 모른다
 *
 * 시간 `t` 를 받아 그 순간의 자리를 돌려주는 **순수 함수**다.
 * `requestAnimationFrame` 도 `Date` 도 여기 없다 — 그건 그리는 쪽 일이고,
 * 그래야 이 규칙을 검사로 확인할 수 있다.
 *
 * 대형 자체는 그 판의 실제 대형이라 **자리를 바꾸지는 않는다.** 움직임은
 * 기준 자리에서의 밀림이며, 공이 가운데로 돌아오면 원래 대형이 다시 보인다.
 */
import type { BoardDot } from './titleBoard'

/** 경기장 치수(m). `src/sim` 과 같은 좌표계다 */
const LENGTH = 105
const WIDTH = 68

/** 한 명이 지금 서 있는 자리 */
export interface MovingDot extends BoardDot {
  /** 지금 공을 가지고 있는가. 화면이 이 선수를 밝게 그린다 */
  onBall: boolean
}

export interface BoardFrame {
  ours: MovingDot[]
  theirs: MovingDot[]
  ball: { x: number; y: number }
  /** 지금 공을 가진 쪽 */
  side: 'ours' | 'theirs'
}

/** 자리에서 밀리는 정도. 역할마다 다르다 */
const PULL: Record<BoardDot['pos'], { x: number; y: number }> = {
  // 골키퍼는 골문을 비울 수 없다
  GK: { x: 0.06, y: 0.12 },
  DF: { x: 0.17, y: 0.26 },
  MF: { x: 0.2, y: 0.3 },
  FW: { x: 0.17, y: 0.24 },
}

/** 공을 잡으러 나가는 한 명이 공까지 가는 비율 */
const CLOSE_DOWN = 0.45
/** 압박하러 나가는 거리의 한계(m). 이보다 멀면 안 나간다 */
const CLOSE_RANGE = 34

/**
 * 한 번의 소유 흐름.
 *
 * 자리 번호로 적는다 — 등번호로 적으면 포메이션이 바뀔 때 없는 선수를
 * 가리킨다. `[쪽, 역할, 그 역할 중 몇 번째]` 이고, 모자라면 앞으로 돌아간다.
 *
 * 흐름은 축구 한 장면이다. 뒤에서 풀어 옆으로 벌리고 → 앞으로 넣었다가
 * → 뺏기고 → 역습을 맞고 → 걷어내 다시 뒤에서 시작한다. 이 순서라야
 * 「우리가 밀어 올렸다가 급히 내려오는」 움직임이 나온다.
 */
type Leg = readonly ['ours' | 'theirs', BoardDot['pos'], number]

const SCRIPT: readonly Leg[] = [
  ['ours', 'GK', 0],
  ['ours', 'DF', 1],
  ['ours', 'MF', 1],
  ['ours', 'DF', 0],
  ['ours', 'MF', 0],
  ['ours', 'FW', 0],
  // 여기서 넘어간다
  ['theirs', 'DF', 2],
  ['theirs', 'MF', 1],
  ['theirs', 'FW', 0],
  // 걷어내고 다시 뒤에서
  ['ours', 'DF', 3],
  ['ours', 'MF', 2],
]

/** 한 다리에 쓰는 시간(초). 패스가 날아가는 시간 + 잡고 있는 시간 */
const PASS_SEC = 1.1
const HOLD_SEC = 1.3
const LEG_SEC = PASS_SEC + HOLD_SEC

export const LOOP_SEC = SCRIPT.length * LEG_SEC

/**
 * 잔움직임의 각속도.
 *
 * 한 바퀴에 **정수 번** 흔들리도록 맞춘다. 아무 숫자나 쓰면 판 전체가
 * 영원히 같은 자리로 안 돌아와, 오래 켜 둔 화면에서 값이 조금씩 밀린다.
 */
const FIDGET_X = (Math.PI * 2 * 5) / LOOP_SEC
const FIDGET_Y = (Math.PI * 2 * 4) / LOOP_SEC

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
/** 가감속. 선형으로 움직이면 기계처럼 보인다 */
const ease = (u: number) => u * u * (3 - 2 * u)

function pick(dots: readonly BoardDot[], leg: Leg): BoardDot {
  const line = dots.filter((d) => d.pos === leg[1])
  if (line.length === 0) return dots[0]
  return line[leg[2] % line.length]
}

/**
 * 그 순간의 판.
 *
 * `t` 는 초다. 흐름은 `LOOP_SEC` 마다 되풀이되므로 아무 때나 들어와도 된다.
 */
export function boardFrame(
  ours: readonly BoardDot[],
  theirs: readonly BoardDot[],
  t: number,
): BoardFrame {
  const loop = ((t % LOOP_SEC) + LOOP_SEC) % LOOP_SEC
  const index = Math.floor(loop / LEG_SEC)
  const within = loop - index * LEG_SEC

  const from = SCRIPT[index]
  const to = SCRIPT[(index + 1) % SCRIPT.length]
  const fromDot = pick(from[0] === 'ours' ? ours : theirs, from)
  const toDot = pick(to[0] === 'ours' ? ours : theirs, to)

  // 잡고 있는 동안은 공이 그 선수 발밑에, 패스 동안은 날아간다
  const flying = within > HOLD_SEC
  const u = flying ? ease((within - HOLD_SEC) / PASS_SEC) : 0
  const ball = {
    x: fromDot.x + (toDot.x - fromDot.x) * u,
    y: fromDot.y + (toDot.y - fromDot.y) * u,
  }
  // 패스가 절반을 넘어가면 받는 쪽이 이미 소유한 것으로 본다.
  // 그래야 뺏기는 순간 두 팀의 움직임이 함께 뒤집힌다
  const side = (u > 0.5 ? to[0] : from[0]) as 'ours' | 'theirs'
  const holder = u > 0.5 ? toDot : fromDot

  // 블록이 통째로 공 쪽으로 밀린다
  const shiftX = ball.x - LENGTH / 2
  const shiftY = ball.y - WIDTH / 2

  const place = (dots: readonly BoardDot[], mine: boolean): MovingDot[] => {
    // 공을 안 가진 쪽에서 가장 가까운 한 명이 나가서 잡는다
    let presser = -1
    if (!mine) {
      let best = CLOSE_RANGE
      dots.forEach((d, i) => {
        if (d.pos === 'GK') return
        const gap = Math.hypot(d.x - ball.x, d.y - ball.y)
        if (gap < best) {
          best = gap
          presser = i
        }
      })
    }

    return dots.map((d, i) => {
      const pull = PULL[d.pos]
      let x = d.x + shiftX * pull.x
      let y = d.y + shiftY * pull.y

      if (i === presser) {
        x += (ball.x - x) * CLOSE_DOWN
        y += (ball.y - y) * CLOSE_DOWN
      }

      // 자기 자리 안의 잔움직임. 공이 멀어도 가만히 선 사람은 없다.
      // 등번호로 위상을 갈라 스물두 명이 같은 박자로 흔들리지 않게 한다
      const phase = d.num * 1.37 + (mine ? 0 : 2.1)
      x += Math.sin(loop * FIDGET_X + phase) * 0.7
      y += Math.cos(loop * FIDGET_Y + phase * 1.3) * 0.9

      return {
        ...d,
        x: clamp(x, 1.5, LENGTH - 1.5),
        y: clamp(y, 1.5, WIDTH - 1.5),
        onBall: d.num === holder.num && mine === (side === 'ours'),
      }
    })
  }

  return { ours: place(ours, side === 'ours'), theirs: place(theirs, side === 'theirs'), ball, side }
}
