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
import type { BoardDot } from './titleBoard'

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

/** 한 선의 양 끝을 잡아 살짝 휜 패스 길을 만든다 */
function passPath(a: BoardDot, b: BoardDot, bend: number): string {
  const [x1, y1] = [px(a.y), py(a.x)]
  const [x2, y2] = [px(b.y), py(b.x)]
  const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2]
  // 두 점을 잇는 선의 수직 방향으로 밀어 곡선을 만든다
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const [nx, ny] = [-(y2 - y1) / len, (x2 - x1) / len]
  return `M ${x1} ${y1} Q ${mx + nx * bend} ${my + ny * bend} ${x2} ${y2}`
}

/** 같은 줄에서 가장 멀리 떨어진 두 명. 둘을 잇는 패스가 가장 잘 보인다 */
function widestPair(dots: readonly BoardDot[], pos: BoardDot['pos']): [BoardDot, BoardDot] | null {
  const line = dots.filter((d) => d.pos === pos).sort((a, b) => a.y - b.y)
  if (line.length < 2) return null
  return [line[0], line[line.length - 1]]
}

export interface TitlePitchProps {
  ours: readonly BoardDot[]
  theirs: readonly BoardDot[]
}

export function TitlePitch({ ours, theirs }: TitlePitchProps) {
  const theirPass = widestPair(theirs, 'MF') ?? widestPair(theirs, 'DF')
  const ourPass = widestPair(ours, 'DF') ?? widestPair(ours, 'MF')

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

      {/* 공이 도는 길. 늘 참인 것만 그린다 — 같은 줄 안에서 공을 돌린다 */}
      <g className="tp-pass" fill="none">
        {theirPass && (
          <path className="theirs" d={passPath(theirPass[0], theirPass[1], 26)} markerEnd="url(#tp-head)" />
        )}
        {ourPass && (
          <path className="ours" d={passPath(ourPass[1], ourPass[0], 26)} markerEnd="url(#tp-head)" />
        )}
      </g>

      <g className="tp-dots">
        {theirs.map((d) => (
          <g key={`a${d.num}`} className="theirs" transform={`translate(${px(d.y)} ${py(d.x)})`}>
            <circle r="11" />
            <text dy="3.6">{d.num}</text>
          </g>
        ))}
        {ours.map((d) => (
          <g key={`h${d.num}`} className="ours" transform={`translate(${px(d.y)} ${py(d.x)})`}>
            <circle r="11" />
            <text dy="3.6">{d.num}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}
