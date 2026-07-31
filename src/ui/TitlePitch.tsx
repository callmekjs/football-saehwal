/**
 * 첫 화면의 전술판.
 *
 * 사용자가 정했다 — *"딱 첫 페이지만 봐도 사용자가 아 이거 축구
 * 시뮬레이션이구나 알 수 있도록 만들어줘."*
 *
 * **부르는 이미지 파일이 없다.** 선 몇 개와 원 스물두 개를 그린 인라인
 * SVG 다. 이 저장소는 선수 사진·엠블럼·유니폼을 하나도 두지 않기로 했다.
 *
 * 좌표는 `src/sim` 것을 그대로 받는다 — x 는 우리 골문 0 에서 상대 골문
 * 105, y 는 터치라인 0 에서 68 이다. 세로로 세우면서 **우리 골문을 아래**
 * 로 놓는다. 보는 사람이 자기 팀을 아래에 두고 위로 공격하는 것이 축구
 * 중계의 기본 시점이다.
 */
import { useEffect, useState } from 'react'
import type { BoardDot } from './titleBoard'
import { boardFrame, type BoardFrame, type MovingDot } from './titleBoardMotion'

/** 실제 경기장 치수(m). 선을 눈대중으로 긋지 않으려고 적어둔다 */
const PITCH = { width: 68, length: 105, box: 40.32, boxDepth: 16.5, six: 18.32, sixDepth: 5.5, goal: 7.32, circle: 9.15 }

/** 그리는 판. 세로로 길다 */
const VIEW = { w: 260, h: 372, pad: 9 }
const IN_W = VIEW.w - VIEW.pad * 2
const IN_H = VIEW.h - VIEW.pad * 2

/** 터치라인 좌표 → 화면 가로 */
const px = (y: number) => VIEW.pad + (y / PITCH.width) * IN_W
/** 골문 좌표 → 화면 세로. 우리 골문(x=0)이 아래다 */
const py = (x: number) => VIEW.h - VIEW.pad - (x / PITCH.length) * IN_H
/** 가로 길이(m) → 화면 길이 */
const sw = (m: number) => (m / PITCH.width) * IN_W
/** 세로 길이(m) → 화면 길이 */
const sh = (m: number) => (m / PITCH.length) * IN_H

const CENTER_X = px(PITCH.width / 2)

/** 한 명 */
function Dot({ side, dot }: { side: 'ours' | 'theirs'; dot: MovingDot }) {
  return (
    <g
      className={dot.onBall ? `${side} on-ball` : side}
      transform={`translate(${px(dot.y)} ${py(dot.x)})`}
    >
      <circle r="11" />
      <text dy="3.6">{dot.num}</text>
    </g>
  )
}

/**
 * 흐르는 시간.
 *
 * `requestAnimationFrame` 은 탭이 안 보이면 멈춘다. 여기서는 그게 맞다 —
 * 안 보이는 첫 화면을 계속 다시 그릴 이유가 없다. 경기 진행이 절대 시각을
 * 쓰는 것과는 다른 얘기다(그쪽은 탭 전환이 일시정지 치트가 되면 안 된다).
 *
 * 움직임에 멀미가 나는 사람에게는 아예 안 돌린다. 그때는 시각 0의 한 장면,
 * 곧 **기준 대형 그대로**가 보인다.
 */
function useBoardClock(): number {
  const [t, setT] = useState(0)
  const still =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (still) return
    let raf = 0
    let start = 0
    const step = (now: number) => {
      if (start === 0) start = now
      setT((now - start) / 1000)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [still])

  return still ? 0 : t
}

export interface TitlePitchProps {
  ours: readonly BoardDot[]
  theirs: readonly BoardDot[]
}

export function TitlePitch({ ours, theirs }: TitlePitchProps) {
  const frame: BoardFrame = boardFrame(ours, theirs, useBoardClock())

  return (
    <svg
      className="title-pitch-art"
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      role="img"
      aria-label="양 팀 스물두 명이 선 전술판"
    >
      <defs>
        <marker id="tp-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
      </defs>

      <rect className="tp-turf" x="0" y="0" width={VIEW.w} height={VIEW.h} rx="6" />
      {/* 잔디 줄무늬. 잔디를 깎은 자국이라 눈에 겨우 보일 만큼만 */}
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={i}
          className="tp-mow"
          x="0"
          y={(VIEW.h / 8) * i}
          width={VIEW.w}
          height={VIEW.h / 8}
          opacity={i % 2 === 0 ? 0.5 : 0}
        />
      ))}

      <g className="tp-line" fill="none">
        <rect x={VIEW.pad} y={VIEW.pad} width={IN_W} height={IN_H} />
        <line x1={VIEW.pad} y1={py(PITCH.length / 2)} x2={VIEW.w - VIEW.pad} y2={py(PITCH.length / 2)} />
        <circle cx={CENTER_X} cy={py(PITCH.length / 2)} r={sw(PITCH.circle)} />
        <circle className="tp-spot" cx={CENTER_X} cy={py(PITCH.length / 2)} r="2" />

        {/* 우리 쪽(아래)과 상대 쪽(위). 같은 치수를 위아래로 한 번씩 */}
        {[0, 1].map((side) => {
          const near = side === 0
          const boxY = near ? py(PITCH.boxDepth) : VIEW.pad
          const sixY = near ? py(PITCH.sixDepth) : VIEW.pad
          const goalY = near ? VIEW.h - VIEW.pad : VIEW.pad - 5
          return (
            <g key={side}>
              <rect
                x={CENTER_X - sw(PITCH.box) / 2}
                y={boxY}
                width={sw(PITCH.box)}
                height={sh(PITCH.boxDepth)}
              />
              <rect
                x={CENTER_X - sw(PITCH.six) / 2}
                y={sixY}
                width={sw(PITCH.six)}
                height={sh(PITCH.sixDepth)}
              />
              <rect
                className="tp-goal"
                x={CENTER_X - sw(PITCH.goal) / 2}
                y={goalY}
                width={sw(PITCH.goal)}
                height="5"
              />
            </g>
          )
        })}
      </g>

      <g className="tp-dots">
        {frame.theirs.map((d) => (
          <Dot key={`a${d.num}`} side="theirs" dot={d} />
        ))}
        {frame.ours.map((d) => (
          <Dot key={`h${d.num}`} side="ours" dot={d} />
        ))}
      </g>

      {/* 공. 지금 어디를 놓고 스물두 명이 움직이는지가 이 점 하나로 읽힌다 */}
      <circle
        className="tp-ball"
        cx={px(frame.ball.y)}
        cy={py(frame.ball.x)}
        r="4"
      />
    </svg>
  )
}
