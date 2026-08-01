import { useCallback, useEffect, useRef, useState } from 'react'
import { Pitch } from './Pitch'
import {
  AwayPanel,
  ORDER_LABELS,
  PlayerDataCard,
  SquadPanel,
} from './SquadPanel'
import { BENCH, effectivePos, getPlayer, meanStamina } from '../sim/squad'
import { homeCaptainNumber } from '../captain'
import { carryToNextHalf, judge, secondHalfSeed } from '../sim/engine'
import { useMatch } from './useMatch'
import type { FormationId } from '../sim/formations'
import { AnalysisPanel } from './AnalysisPanel'
import { PRESETS, presetOf } from '../analysis/presets'
import { buildBriefing, type Briefing } from '../analysis/briefing'
import { buildHalftime } from '../analysis/halftime'
import { scoreboardScore } from './scoreboard'
import { isMuted, setMuted, whistle } from './sound'
import {
  nextOpponentView,
  opponentViewOf,
  withOpponentView,
} from './visibleOpponent'
import {
  addedTimeOf,
  breakLabel,
  clockOf,
  endLabel,
  halfLabel,
  inAddedTime,
  kickoffMinute,
  minuteAt,
  type Half,
} from '../matchClock'
import { commentaryFor } from './commentary'
import {
  BREAK_WARN_SECONDS,
  breakMessage,
  breakRatio,
  breakTone,
  formatBreak,
  useBreakClock,
} from './breakClock'
import { opponentInfo } from '../analysis/opponents'
import { clockRatio, clockTone, secondsLeft, urgencyOf } from './urgency'
import { leverToast, presetToast, subToast, useToast, type ToastMessage } from './toast'
import type { FinishedMatch } from './recordMatch'
import type {
  MatchAbility,
  Decision,
  OpponentId,
  Level,
  MatchState,
  PlayerOrder,
  Problem,
} from '../sim/types'

const LEVER_LABELS = {
  LINE: ['낮음', '보통', '높음'],
  PRESS: ['약', '중', '강'],
  WIDTH: ['좁게', '보통', '넓게'],
} as const


/**
 * 급수 타임에 주장이 전하는 상황.
 *
 * 감독은 벤치에서 판을 다 볼 수 없다. 실제로도 이 시간에 안에서 뛴
 * 선수가 와서 무엇이 벌어지고 있는지 말해준다. 그 순간을 화면으로
 * 옮긴 것이다.
 *
 * **문장은 전부 실제 값에서 나온다**(`src/analysis/briefing.ts`).
 * 지어낸 말이 아니라 명단·국면 데이터·확률 상수를 읽은 결과다.
 *
 * 할 말이 열 줄을 넘을 수 있어서 **급한 넷만 세워두고 나머지는 접는다.**
 * 오른쪽 열은 세로가 넉넉하지 않고, 열네 줄을 한꺼번에 펴면 벽처럼 보여
 * 한 줄도 안 읽힌다.
 */
/**
 * 급수 타임 머리줄 — 남은 시간이 여기 붙는다.
 *
 * 급수 타임에 끝이 없으면 그건 경기 안의 장면이 아니라 설정 메뉴다. 실제
 * 쿨링브레이크는 주심이 끊는다.
 *
 * 다만 **1분을 강제로 기다리게 하지 않는다.** 처음 보는 사람이 이 화면에
 * 쓰는 시간은 1~3분이고, 축구를 보기도 전에 대기 화면에서 나가면 아무것도
 * 전달되지 않는다. 아래 재개 버튼은 언제나 살아 있고, 이 시계는 "안 누르면
 * 알아서 시작한다"는 뜻이다.
 *
 * **시계를 따로 상자에 담지 않고 머리줄에 얹은 이유**가 있다. 오른쪽 열은
 * 주장의 브리핑 열네 줄과 재개 버튼으로 이미 꽉 차 있어서, 상자 하나를
 * 더 놓으면 그만큼 버튼이 화면 밖으로 밀려난다. 이미 있는 줄에 얹으면
 * 세로가 거의 늘지 않는다.
 *
 * 남은 시간은 **숫자 · 막대 · 문장** 셋으로 함께 말한다. 마지막 15초에
 * 색이 바뀌지만 색은 셋 중 하나일 뿐이다 — 문장이 같이 바뀌므로 색을
 * 못 보아도 곧 시작한다는 것을 알 수 있다.
 */
function BreakHead({ title, half, remaining }: { title: string; half: Half; remaining: number }) {
  const tone = breakTone(remaining)
  return (
    <>
      <h2 className="break-head">
        <span className="break-head-word">
          급수 타임 · {title}
          <small>
            {tone === 'CALM'
              ? `${breakLabel(half)} · 경기 시계 정지`
              : breakMessage(remaining)}
          </small>
        </span>
        <span className="break-head-clock">
          <b role="timer" aria-label={`경기 재개까지 ${remaining}초`}>
            {formatBreak(remaining)}
          </b>
          <small>자동 재개까지</small>
        </span>
      </h2>
      <div className="break-track" aria-hidden>
        <i style={{ width: `${breakRatio(remaining) * 100}%` }} />
      </div>
      {/*
        읽어주는 것은 경고가 켜지는 그 순간 한 번뿐이다. 남은 초를 매초
        읽어주면 화면을 못 보는 사람은 브리핑을 한 줄도 못 듣는다.
      */}
      <span className="sr-only" role="status">
        {tone === 'WARN' ? '곧 경기가 재개됩니다' : ''}
      </span>
    </>
  )
}

function CaptainBrief({ briefing }: { briefing: Briefing }) {
  return (
    <div className="captain-brief">
      <p className="captain-who">
        <span className="captain-num" aria-hidden>
          {briefing.speaker}
        </span>
        <span>
          <b>{briefing.speaker}번</b> 주장이 지금 상황을 전합니다
        </span>
      </p>

      <ul className="captain-lines">
        {briefing.core.map((line) => (
          <li key={line.id} data-tone={line.tone === 'ALERT' ? 'alert' : undefined}>
            <span className="captain-topic">{line.topic}</span>
            {line.text}
          </li>
        ))}
      </ul>

      {briefing.more.length > 0 && (
        <details className="captain-more">
          <summary>이어서 듣기 · {briefing.more.length}줄</summary>
          <ul className="captain-lines">
            {briefing.more.map((line) => (
              <li key={line.id} data-tone={line.tone === 'ALERT' ? 'alert' : undefined}>
                <span className="captain-topic">{line.topic}</span>
                {line.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export function Levers({
  tactics,
  locked,
  onSet,
  onPreset,
}: {
  tactics: MatchState['tactics']
  locked: boolean
  onSet: (t: 'LINE' | 'PRESS' | 'WIDTH', v: Level) => void
  /** 프리셋 한 번으로 레버 셋을 세운다. 토스트 문구가 달라 따로 받는다 */
  onPreset?: (name: string, v: readonly [Level, Level, Level]) => void
}) {
  const rows = [
    ['LINE', '수비라인', tactics.line],
    ['PRESS', '압박', tactics.press],
    ['WIDTH', '수비 폭', tactics.width],
  ] as const

  const matched = presetOf(tactics)

  return (
    <section className="panel tactics-panel">
      <h2>
        전술
        {matched ? (
          <span className="tactics-now">{matched.name}</span>
        ) : (
          <span className="tactics-now off">직접 맞춤</span>
        )}
      </h2>

      {/*
        원탭 프리셋 — 핸드오프의 2순위다.

        원문: *"레버 3개를 각각 고를 시간이 없다는 전제로 원탭 프리셋을
        둔다"*. 75초에 세 번 탭할 여유가 없다. 실제 축구도 "역습으로 간다"고
        하지 "라인 낮음 압박 약 폭 보통으로 간다"고 하지 않는다.

        시안은 카드 셋(잠그기·균형·밀어올리기)이었지만 지시대로 **우리
        프리셋 다섯을 그대로 쓴다.** 시안의 셋은 레버를 0/1/2로 미는 단축일
        뿐이라, 이름이 붙은 우리 전술이 감독에게 더 많은 것을 말해준다.
      */}
      <div className="tactics-presets">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className="preset-card"
            aria-pressed={matched?.name === p.name}
            disabled={locked}
            onClick={() => {
              if (onPreset) onPreset(p.name, p.v)
              else {
                onSet('LINE', p.v[0])
                onSet('PRESS', p.v[1])
                onSet('WIDTH', p.v[2])
              }
            }}
          >
            <strong>{p.name}</strong>
            <small>{p.hint}</small>
          </button>
        ))}
      </div>

      {/*
        레버는 접지 않는다.

        전에는 `<details>` 안에 숨어 있었다. 프리셋이 뼈대를 세우고 레버로
        다듬는 것이 감독이 실제로 하는 일인데, 다듬는 쪽이 두 번 눌러야
        나오면 75초 안에는 아무도 안 연다.

        3분할 세그먼트에 미끄러지는 표시자를 둔다. 지금 어디에 있는지가
        **위치**로 보여야 색을 못 가려도 읽힌다.
      */}
      <div className="lever-list">
        {rows.map(([key, label, value]) => (
          <div key={key} className="lever-row">
            <span className="lever-name">{label}</span>
            <div className="lever-seg" data-value={value}>
              <i className="lever-mark" aria-hidden style={{ left: `${value * 33.34}%` }} />
              {LEVER_LABELS[key].map((text, i) => (
                <button
                  key={text}
                  className="lever-opt"
                  aria-pressed={value === i}
                  disabled={locked}
                  onClick={() => onSet(key, i as Level)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * 방금 무엇을 눌렀는지 알려주는 한 줄.
 *
 * 되돌릴 수 없는 게임이라 **지금** 알아야 다음 지시로 만회할 수 있다.
 * 경기장을 보고 있으면 칩 테두리가 바뀐 것은 눈에 안 들어온다.
 */
function Toast({ message }: { message: ToastMessage | null }) {
  if (!message) return null
  return (
    // `key` 로 같은 문장을 다시 눌러도 등장 애니메이션이 다시 돈다
    <div className="toast" key={message.seq} role="status">
      <strong>{message.text}</strong>
      <small>되돌릴 수 없습니다</small>
    </div>
  )
}

/**
 * 경기 기록. 좌우로 마주보는 막대다.
 *
 * 전부 엔진이 실제로 센 횟수다. 레버를 당기면 몇 초 안에 이 숫자가
 * 움직이고, 그것이 "내가 뭘 바꿨는지"를 알려주는 주 채널이다.
 */
export function StatBars({ state, half }: { state: MatchState; half: Half }) {
  const s = state.stats
  const rows: Array<[string, number, number, boolean]> = [
    ['공격 전개', s.homeAttempt, s.awayAttempt, false],
    ['슈팅', s.homeShot, s.awayShot, false],
    ['세트피스 위험', 0, s.setPiece, true],
    ['배후 침투', 0, s.behind, true],
  ]

  return (
    <section className="panel stat-panel">
      <h2>
        {halfLabel(half)} 경기 기록 <small>이 반만</small>
      </h2>
      <div className="stat-rows">
        {rows.map(([label, home, away, oneSided]) => {
          const total = home + away
          const hp = total === 0 ? 0.5 : home / total
          return (
            <div key={label} className="stat-row">
              <div className="stat-head">
                <span>{oneSided ? '' : home}</span>
                <span>{label}</span>
                <span style={{ color: oneSided && away > 0 ? 'var(--away)' : undefined }}>
                  {away}
                </span>
              </div>
              <div className="stat-track">
                <div style={{ flex: hp, background: 'var(--accent)', borderRadius: 3 }} />
                <div style={{ flex: 1 - hp, background: 'var(--away)', borderRadius: 3 }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Log({ state, half }: { state: MatchState; half: Half }) {
  const shown = state.log.filter((e) => e.kind !== 'FOUL').slice(-8).reverse()
  return (
    <section className="panel log-panel">
      <h2>경기 이벤트</h2>
      <div className="log-rows">
        {shown.length === 0 && <span className="log-empty">아직 주요 장면이 없습니다</span>}
        {shown.map((e, i) => (
          <div key={`${e.tick}-${i}`} className="log-row">
            <span className="log-min">
              {Math.floor(minuteAt(e.tick, half))}'
            </span>
            <span
              style={{
                color:
                  e.kind === 'GOAL'
                    ? 'var(--accent)'
                    : e.kind === 'CONCEDE'
                      ? 'var(--away)'
                      : 'var(--text)',
              }}
            >
              {commentaryFor(e)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Bench({
  state,
  locked,
  half,
  picked,
  onPick,
  onSub,
}: {
  state: MatchState
  /** 끝난 경기에는 교체할 수 없다 */
  locked: boolean
  /** 전반이 끝난 것과 경기가 끝난 것은 다른 말이다 */
  half: Half
  /**
   * 지금 고른 선수. **위에서 내려온다.**
   *
   * 전에는 이 패널 안에만 있었다. 그래서 옆의 배치판은 감독이 누구를
   * 들여보내려는지 알 수 없었고, 배치판 카드를 눌러도 교체가 되지 않았다.
   */
  picked: string | null
  onPick: (id: string | null) => void
  onSub: (out: string, inId: string) => string | null
}) {
  const [note, setNote] = useState<string | null>(null)
  const setPicked = onPick

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 2200)
    return () => clearTimeout(t)
  }, [note])

  useEffect(() => {
    if (locked) onPick(null)
  }, [locked, onPick])

  const onPitch = state.players.filter((s) => s.onPitch && !s.out)
  const captain = homeCaptainNumber(state.players)
  const inactiveStarters = state.players.filter(
    (s) => !s.onPitch && !BENCH.some((player) => player.id === s.id),
  )
  /**
   * 이 칸에는 두 종류가 섞인다.
   *
   * 하나는 **뛰다가 나간 선수**이고, 다른 하나는 감독이 **처음부터 선발에서
   * 뺀 선수**다. 둘 다 「교체됨」이라고 부르면, 교체 카드를 쓴 적이 없는
   * 감독이 자기가 두 장을 썼다고 읽는다. 축구에서 교체는 뛰던 사람이 나가는
   * 일이다.
   *
   * 실제로 교체가 있었는지는 경기 기록이 안다.
   */
  const substitutedOut = new Set(
    // 교체 기록은 들어온 선수를 `target`, 나간 선수를 `detail` 에 담는다
    state.log.flatMap((event) => (event.kind === 'SUB' && event.detail ? [event.detail] : [])),
  )
  const pickedState = picked
    ? state.players.find((player) => player.id === picked) ?? null
    : null
  const canEnter =
    pickedState !== null &&
    !pickedState.onPitch &&
    !pickedState.out &&
    state.subsLeft > 0 &&
    !locked

  return (
    <section className="panel bench-panel">
      <h2>
        벤치 · 교체 카드 {state.subsLeft}장
        {locked ? (
          <span style={{ color: 'var(--dim)', fontWeight: 400 }}> — {endLabel(half)}</span>
        ) : canEnter ? (
          <span style={{ color: 'var(--accent)' }}> — 나갈 선수 선택</span>
        ) : pickedState ? (
          <span style={{ color: 'var(--accent)' }}> — 선수 데이터</span>
        ) : (
          <span style={{ color: 'var(--dim)', fontWeight: 400 }}> — 들어올 선수 먼저</span>
        )}
      </h2>

      {/* 교체는 6초 뒤에 반영된다. 그 사이 아무 표시가 없으면 안 눌린 줄 안다 */}
      {state.pendingSubs.length > 0 && (
        <div className="bench-pending">
          {state.pendingSubs.map((p) => (
            <span key={p.in}>
              {getPlayer(p.out).num}번 → {getPlayer(p.in).num}번 ·{' '}
              {Math.max(0, Math.ceil((p.atTick - state.tick) / 10))}초 뒤 투입
            </span>
          ))}
        </div>
      )}
      <div className="bench-body">
        {pickedState && (
          <PlayerDataCard
            state={pickedState}
            isCaptain={getPlayer(pickedState.id).num === captain}
          />
        )}
        <div className="bench-row">
          {BENCH.map((b) => {
            const s = state.players.find((p) => p.id === b.id)!
            return (
              <button
                key={b.id}
                className="chip bench-chip"
                aria-pressed={picked === b.id}
                data-unavailable={s.onPitch || s.out ? 'on' : undefined}
                disabled={locked}
                onClick={() => setPicked(picked === b.id ? null : b.id)}
              >
                <span className="bench-num">{b.num}</span>
                <span className="bench-sub">
                  {s.out ? '이탈' : s.onPitch ? '출전 중' : `${b.pos} · 속도 ${b.speed}`}
                </span>
              </button>
            )
          })}
        </div>

        {inactiveStarters.length > 0 && (
          <>
            {/* 제목도 실제 구성을 따라간다. 교체가 없었는데 「교체」라고 적으면
                감독이 안 쓴 카드를 썼다고 읽는다 */}
            <span className="bench-history-label">
              {inactiveStarters.some((s) => s.out || substitutedOut.has(s.id))
                ? '교체·이탈 선수'
                : '선발에서 뺀 선수'}
            </span>
            <div className="bench-row">
              {inactiveStarters.map((s) => {
                const player = getPlayer(s.id)
                return (
                  <button
                    key={s.id}
                    className="chip bench-chip"
                    aria-pressed={picked === s.id}
                    disabled={locked}
                    onClick={() => setPicked(picked === s.id ? null : s.id)}
                  >
                    <span className="bench-num">{player.num}</span>
                    <span className="bench-sub">
                      {s.out ? '경기 이탈' : substitutedOut.has(s.id) ? '교체됨' : '선발 제외'}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {canEnter && (
          <div className="bench-row">
            {onPitch.map((s) => {
              const p = getPlayer(s.id)
              return (
                <button
                  key={s.id}
                  className="chip bench-chip"
                  onClick={() => {
                    const err = onSub(s.id, pickedState.id)
                    setNote(err ?? `${p.num}번 → ${getPlayer(pickedState.id).num}번`)
                    setPicked(null)
                  }}
                >
                  <span className="bench-num">{p.num}</span>
                  <span className="bench-sub">체력 {Math.round(s.stamina)}</span>
                </button>
              )
            })}
          </div>
        )}

        {note && <span className="bench-note">{note}</span>}
      </div>
    </section>
  )
}

/**
 * 긴급 바 — 남은 시간 · 지금 위험 · 교체 카드.
 *
 * 세 칸이 서로 다른 종류의 압박을 전한다. 왼쪽은 **시간**(줄어든다),
 * 가운데는 **판단**(지금 무엇이 급한가), 오른쪽은 **자원**(쓸 수 있는
 * 카드가 몇 장 남았나). 셋 다 되돌릴 수 없는 것들이다.
 *
 * 색만으로 구분하지 않는다 — 등급이 바뀌면 삼각형 마커와 문장이 함께
 * 바뀐다. `urgency.ts` 의 검사가 그 규칙을 지킨다.
 */
function UrgencyBar({ state, cards }: { state: MatchState; cards: number }) {
  const left = secondsLeft(state.tick)
  const tone = clockTone(left)
  const danger = urgencyOf(state)
  /**
   * 시안은 카드를 세 장으로 그렸지만 **국면마다 다르다**(3·3·2·2·2).
   * 상수로 박으면 두 장짜리 국면에서 쓰지도 않은 카드가 하나 남아 보인다.
   * 국면이 준 처음 장수를 그대로 쓴다.
   */
  const used = Math.max(0, cards - state.subsLeft)

  return (
    <div className="urgency">
      <div className="urgency-clock" data-tone={tone.toLowerCase()}>
        <span className="urgency-label">남은 시간</span>
        {/*
          경기 분(88:12)이 아니라 **실제로 남은 초**다. 둘을 일부러 갈라
          놓았다 — 화면의 88분은 경기 안의 시각이고 이 숫자는 감독에게
          진짜로 남은 시간이다.
        */}
        <b role="timer" aria-label={`남은 시간 ${left}초`}>
          {left}
          <i>초</i>
        </b>
        <span className="urgency-gauge">
          <i style={{ width: `${clockRatio(state.tick) * 100}%` }} />
        </span>
      </div>

      <div className="urgency-risk" data-tone={danger.tone.toLowerCase()}>
        {/* 색을 못 가리는 사람을 위한 두 번째 신호. 색이 아니라 모양이다 */}
        <span className="urgency-mark" aria-hidden />
        <span className="urgency-body">
          <span className="urgency-label">지금 위험</span>
          {/*
            등급이 올라간 순간에만 읽어준다. 매 틱 읽으면 화면 낭독기가
            75초 내내 같은 문장을 반복한다
          */}
          <strong role={danger.tone === 'DANGER' ? 'status' : undefined}>{danger.text}</strong>
        </span>
      </div>

      <div className="urgency-cards">
        <span className="urgency-label">교체 카드</span>
        <span className="urgency-chips" aria-label={`교체 카드 ${state.subsLeft}장 남음`}>
          {Array.from({ length: cards }, (_, i) => (
            <i key={i} data-used={i < used ? 'on' : undefined} />
          ))}
        </span>
      </div>
    </div>
  )
}

/**
 * 선수단 스트립 — 열한 명의 상태를 한 줄에.
 *
 * 배치판이 **어디에 서 있는가**를 보여준다면 이쪽은 **각자 어떤 상태인가**다.
 * 지친 선수와 지시가 걸린 선수가 한눈에 튀어야 75초 안에 누구를 뺄지 정할
 * 수 있다.
 *
 * 시안에는 선수 평점이 있지만 우리 엔진에 평점이 없다. **없는 값을
 * 지어내지 않는다** — 실제로 있는 체력을 그 자리에 쓴다.
 */
function SquadStrip({ state }: { state: MatchState }) {
  const onPitch = state.players.filter((s) => s.onPitch && !s.out)
  const mean = onPitch.length === 0 ? 100 : meanStamina(state.players)
  const meanTone = mean < 45 ? 'danger' : mean < 60 ? 'warn' : 'calm'

  return (
    <section className="squad-strip" aria-label="선수단 상태">
      <div className="strip-head">
        <span className="strip-label">선수단</span>
        <b data-tone={meanTone}>{Math.round(mean)}</b>
        <small>평균 체력</small>
      </div>
      <div className="strip-list">
        {onPitch.map((s) => {
          const p = getPlayer(s.id)
          const stamina = Math.round(s.stamina)
          // 세 단계로 나눈다. 색과 함께 숫자도 보이므로 색을 못 봐도 읽힌다
          const tone = stamina < 45 ? 'danger' : stamina < 60 ? 'warn' : 'calm'
          const order = s.order === 'NONE' ? null : ORDER_LABELS[s.order].name
          return (
            <div key={s.id} className="strip-cell" data-tone={tone}>
              <span className="strip-pos">{effectivePos(s)}</span>
              <span className="strip-mark" data-warn={s.booked ? 'on' : undefined}>
                {p.num}
              </span>
              <span className="strip-bar" aria-hidden>
                <i style={{ width: `${Math.max(0, Math.min(100, stamina))}%` }} />
              </span>
              <span className="strip-stam">{stamina}</span>
              {/* 지시가 없으면 빈 자리를 남긴다. 칸 높이가 들쭉날쭉하면 눈이 걸린다 */}
              <span className="strip-order">{order ?? ''}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** 좁은 화면에서만 쓰는 탭. 넓은 화면은 네 영역을 한꺼번에 편다 */
type ControlTab = 'TACTICS' | 'SQUAD' | 'AWAY' | 'INFO'

const CONTROL_TABS: Array<{ id: ControlTab; label: string }> = [
  { id: 'TACTICS', label: '전술' },
  { id: 'SQUAD', label: '선수' },
  { id: 'AWAY', label: '상대' },
  { id: 'INFO', label: '기록' },
]

/**
 * 경기가 끝난 순간 한 번만 알린다.
 *
 * 종료 화면은 다시 그려진다. 그릴 때마다 저장하면 목록이 같은 줄로
 * 채워지므로, 붙는 순간 한 번만 부르고 그 뒤로는 조용하다.
 */
function FinishReporter({ onReport }: { onReport: (delta: number | null) => void }) {
  const reported = useRef(false)
  useEffect(() => {
    if (reported.current) return
    reported.current = true
    onReport(null)
    // onReport 는 매 렌더 새로 만들어질 수 있다. 붙을 때 한 번이 전부다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export function MatchScreen({
  problem,
  startHalf,
  opponent = 'USA',
  starters,
  roster,
  onFinish,
  onExit,
  onRetry,
  onReplay,
}: {
  problem: Problem
  /** 감독이 고른 선발. 없으면 명단의 기본 선발 */
  starters?: ReadonlySet<string>
  /** 다시 뽑은 명단. 없으면 기본 능력 */
  roster?: ReadonlyMap<string, MatchAbility>
  /**
   * 경기가 완전히 끝났을 때 한 번.
   *
   * `delta` 는 150판 비교가 끝나야 나오므로 처음에는 `null` 로 오고,
   * 분석이 끝나면 같은 판으로 한 번 더 온다. 기록이 분석을 기다리다가
   * 사용자가 화면을 떠나면 판 자체가 사라지기 때문이다.
   */
  onFinish?: (finished: FinishedMatch) => void
  /**
   * 플레이어가 **어느 반부터** 시작할지 고른 값.
   *
   * 전반을 고르면 전반을 뛰고 하프타임을 거쳐 후반까지 이어진다. 후반을
   * 고르면 후반 하나만 뛴다.
   */
  startHalf: Half
  /**
   * 오늘 만난 상대가 우리보다 센가 약한가. 국면 선택 화면에서 고른다.
   *
   * 경기 중에는 못 바꾼다 — 지고 있다고 상대를 약하게 바꿀 수 있으면
   * 그건 난이도가 아니다.
   */
  opponent?: OpponentId
  onExit: () => void
  /**
   * 다시 도전. 없으면 **같은 시작 조건으로** 처음부터 다시 한다.
   *
   * 시작 조건(체력·경고·앞 감독이 걸어둔 지시와 전술)은 국면 시드에서
   * 뽑으므로, 같은 시드로 다시 시작하면 방금 본 것과 똑같은 판이 나온다.
   * 새 판을 받으려면 바깥에서 시드를 바꿔줘야 한다.
   */
  onRetry?: () => void
  /**
   * **같은 판 다시.** 시드를 그대로 두고 화면만 처음으로 되돌린다.
   *
   * 체력·경고·앞 감독이 걸어둔 지시·상대가 전부 똑같은 자리에 다시 앉는다.
   * 달라지는 것은 감독의 판단 하나뿐이라, 보고서에서 읽은 원인을 실제로
   * 시험해볼 수 있다. 이것이 없으면 사활이 아니라 확률 놀이다.
   */
  onReplay?: () => void
}) {
  /**
   * 지금 뛰고 있는 반.
   *
   * 전반에서 시작하면 하프타임을 지나 2가 된다. 사용자가 지적했다 —
   * *"전반전이 끝나면 후반전으로 넘어가야지 계속 전반전에만 있어."*
   */
  const [half, setHalf] = useState<Half>(startHalf)
  /** 전반을 마친 기록. 종료 보고서에서 두 반을 합치는 데 쓴다 */
  const [firstHalf, setFirstHalf] = useState<{ state: MatchState; decisions: Decision[] } | null>(
    null,
  )
  // 감독 보고서가 쓰는 시각 기준. 지금 뛰는 반이 정한다
  const kickoff = kickoffMinute(half)
  const {
    state,
    phase,
    start,
    reset,
    setLever,
    setFormation,
    substitute,
    setOrder,
    setPosition,
    startNextHalf,
    decisions,
  } = useMatch(problem, opponent, { starters, roster })
  /**
   * 사활 복기는 JSON의 기본값이 아니라 이 판에 실제로 뽑힌 시작 상태를 쓴다.
   *
   * 같은 국면도 시드에 따라 체력·경고·물려받은 지시가 달라진다. 종료 뒤
   * 현재 상태만 보면 그 차이가 사라지므로 첫 렌더의 상태를 보관한다.
   */
  const initialSnapshot = useRef({
    key: `${problem.id}-${problem.seed}-${opponent}`,
    state,
  })
  const snapshotKey = `${problem.id}-${problem.seed}-${opponent}`
  if (initialSnapshot.current.key !== snapshotKey) {
    initialSnapshot.current = { key: snapshotKey, state }
  }
  const [activeTab, setActiveTab] = useState<ControlTab>('TACTICS')
  /**
   * 150판 비교 결과를 기록에 이미 넘겼는가.
   *
   * `AnalysisPanel` 안에도 같은 빗장이 있지만 여기에도 둔다. 이 한 줄이
   * 기록을 늘리는 마지막 문이라, 위쪽에서 무엇이 새더라도 여기서 멈춘다.
   * 경기가 끝나는 순간의 한 건(`FinishReporter`)은 이 빗장과 무관하다 —
   * 그 둘을 `upsert` 로 합치는 것은 의도된 설계다.
   */
  const deltaReported = useRef(false)
  /**
   * 교체로 **들어올** 선수.
   *
   * 전에는 벤치 패널 안에만 있었다. 그래서 벤치에서 선수를 고른 뒤 화면에서
   * 가장 크고 위에 있는 배치판 카드를 눌러도 배치판은 그 사실을 몰랐고,
   * 「나갈 선수 선택」이라고 적힌 바로 아래에서 선수 상세만 열렸다.
   * 두 패널이 같은 것을 보게 위로 올렸다.
   */
  const [benchPick, setBenchPick] = useState<string | null>(null)
  const objective =
    problem.objective.type === 'SURVIVE' ? '리드를 지켜라' : '동점 이상을 만들어라'

  /**
   * 무엇을 눌렀는지 확인시켜 주는 한 줄. **화면 전용이다.**
   *
   * 결정 이력에 남지 않고 경기 결과에도 닿지 않는다. 토스트가 떠 있든
   * 없든 경기는 똑같이 흘러간다.
   */
  const { toast, show } = useToast()

  /**
   * 레버 하나를 바꾸고 무엇을 바꿨는지 알린다.
   *
   * 지시가 거부되면 거부 사유를 대신 띄운다. 종료 휘슬이 이미 울린 뒤인데
   * 화면만 뒤처져 있는 경우가 그렇다 — "압박 → 강"이라고 알려 놓고 아무
   * 일도 일어나지 않는 것이 가장 나쁘다.
   */
  const setLeverLoud = useCallback(
    (type: 'LINE' | 'PRESS' | 'WIDTH', value: Level) => {
      const reason = setLever(type, value)
      show(reason ?? leverToast(type, value))
    },
    [setLever, show],
  )

  /** 포메이션은 평소에 조용하다. 막혔을 때만 이유를 말한다 */
  const setFormationLoud = useCallback(
    (value: FormationId) => {
      const reason = setFormation(value)
      if (reason) show(reason)
    },
    [setFormation, show],
  )

  /**
   * 프리셋 — 레버 셋을 한 번에 세운다.
   *
   * 토스트는 **한 번만** 띄운다. 레버마다 띄우면 셋이 연달아 덮어써서
   * 마지막 것만 보이고, 감독은 "폭만 바뀌었나" 로 읽는다.
   */
  const applyPreset = useCallback(
    (name: string, v: readonly [Level, Level, Level]) => {
      // 하나가 막히면 셋 다 막힌 것이다. 첫 사유를 그대로 보여주고 멈춘다
      const reason = setLever('LINE', v[0])
      if (reason) {
        show(reason)
        return
      }
      setLever('PRESS', v[1])
      setLever('WIDTH', v[2])
      show(presetToast(name))
    },
    [setLever, show],
  )

  /** 교체는 카드를 태운다. 누가 바뀌었는지가 가장 중요하다 */
  const substituteLoud = useCallback(
    (out: string, inId: string): string | null => {
      const reason = substitute(out, inId)
      if (!reason) {
        show(subToast(getPlayer(out).num, getPlayer(inId).num))
        setBenchPick(null)
      }
      return reason
    },
    [substitute, show],
  )

  /**
   * 지금 「나갈 선수」를 기다리고 있는가, 기다린다면 누가 들어오는가.
   *
   * 벤치에서 고른 선수가 실제로 들어올 수 있을 때만 값이 있다. 이 값이
   * 있는 동안 배치판 카드를 누르면 상세를 여는 대신 그 선수가 나간다.
   * 교체는 그대로 **두 단계**다 — 들어올 선수 한 번, 나갈 선수 한 번.
   */
  const benchPickState = benchPick
    ? state.players.find((player) => player.id === benchPick) ?? null
    : null
  const subIn =
    benchPickState &&
    !benchPickState.onPitch &&
    !benchPickState.out &&
    state.subsLeft > 0 &&
    phase !== 'DONE'
      ? benchPickState.id
      : null

  /** 배치판에서 고른 「나갈 선수」. 벤치 줄에서 고르는 것과 같은 곳에 도착한다 */
  const substituteOut = useCallback(
    (out: string): string | null => (subIn ? substituteLoud(out, subIn) : '들어올 선수를 먼저 고르세요'),
    [subIn, substituteLoud],
  )

  /**
   * 연출이 지금까지 실제로 보여준 골.
   *
   * 시뮬은 확률로 득점을 정하는데, 그 순간의 경기 상황이 골을 그릴 수
   * 있는 상황이 아닌 경우가 절반이 넘는다. 그래서 연출은 골을 예약해두고
   * 공격 장면을 만든 다음 보여주고, 점수판은 그 장면에 맞춰 오른다.
   *
   * **이 값을 그대로 점수판에 쓰지 않는다.** 아래 `scoreboardScore` 가
   * 종료 휘슬 뒤에는 시뮬 값으로 바꿔치기한다 — 장면을 못 만든 채
   * 경기가 끝나면 이 값이 영영 안 오르기 때문이다.
   *
   * **승패 판정은 어느 쪽도 쓰지 않는다.** 아래 `judge(state, ...)` 는
   * 시뮬의 점수를 그대로 읽는다.
   */
  /**
   * 경기 재개. **버튼과 자동 시작이 같은 문을 쓴다.**
   *
   * 시간이 다 되어 저절로 시작하는 길을 따로 만들면 한쪽에만 생기는 고장이
   * 반드시 나온다 — 예컨대 자동으로 시작할 때만 탭이 전술로 안 넘어가서,
   * 경기가 시작됐는데 화면에는 상대 배치가 떠 있는 식이다.
   *
   * `start()` 는 `phase !== 'READY'` 면 아무 일도 하지 않으므로, 버튼을
   * 누른 직후에 시계가 0이 되어 두 번 불려도 안전하다.
   */
  const resume = useCallback(() => {
    start()
    setActiveTab('TACTICS')
  }, [start])

  /** 급수 타임 1분. 경기 시계(750틱)와는 무관한 화면 전용 시계다 */
  const breakLeft = useBreakClock(phase === 'READY', resume)

  const [scene, setScene] = useState<[number, number]>(problem.score)
  useEffect(() => setScene(problem.score), [problem])
  const shown = scoreboardScore(phase === 'DONE', state.score, scene)

  /**
   * 상대 성향과 대형은 보이는 점수보다 먼저 답을 말하면 안 된다.
   *
   * 엔진은 골이 난 틱에 즉시 대형을 바꾸지만, 점수판은 골 장면을
   * 기다린다. 장면이 따라오기 전에는 직전 상대 정보를 유지한다.
   */
  const [opponentView, setOpponentView] = useState(() => opponentViewOf(state))
  useEffect(() => {
    setOpponentView((previous) => nextOpponentView(previous, state, shown))
  }, [
    state.opponent,
    state.away.formation,
    state.score[0],
    state.score[1],
    shown[0],
    shown[1],
  ])
  const visibleOpponentState = withOpponentView(state, opponentView)

  /**
   * 소리 — 전부 **덤**이다.
   *
   * 꺼도 아무 기능을 잃지 않는다. 휘슬이 울리는 사건은 화면에도 이미
   * 표시된다(주심이 달려가고, 카드를 들고, 깃발이 오르고, 문구가 뜬다).
   */
  const [mutedNow, setMutedNow] = useState(isMuted)

  /**
   * 주심의 휘슬 — 반칙·페널티킥·부상.
   *
   * 시뮬 기록에서 읽는다. 새로 생긴 항목만 본다.
   */
  const blownTo = useRef(0)
  useEffect(() => {
    const log = state.log
    if (log.length <= blownTo.current) {
      blownTo.current = log.length
      return
    }
    let blow = false
    for (let i = blownTo.current; i < log.length; i++) {
      const kind = log[i].kind
      // 반칙은 프리킥 선언이고, 페널티와 부상도 주심이 경기를 멈춘다
      if (kind === 'FOUL' || kind === 'PENALTY' || kind === 'INJURY') blow = true
    }
    blownTo.current = log.length
    if (blow) whistle(1)
  }, [state.log])

  /** 경기 시작과 끝. 종료는 실제 경기처럼 두 번 분다 */
  const lastPhase = useRef(phase)
  useEffect(() => {
    if (lastPhase.current !== phase) {
      if (phase === 'RUNNING') whistle(1)
      else if (phase === 'DONE') whistle(2)
      lastPhase.current = phase
    }
  }, [phase])
  useEffect(() => {
    if (phase === 'DONE') setActiveTab('INFO')
  }, [phase])

  const passed = judge(state, problem.objective)
  const activePreset = presetOf(state.tactics)
  const setup = `${state.formation} · ${activePreset?.name ?? '직접 맞춤'}`
  const orderCount = state.players.filter((s) => s.onPitch && !s.out && s.order !== 'NONE').length
  /**
   * 하프타임 주장 정리. **전반이 끝났을 때만** 만든다.
   *
   * 후반이 끝난 것은 경기가 끝난 것이라 정리할 "다음 반"이 없다. 그때는
   * 감독 보고서가 전체를 분석한다.
   */
  const halftime = phase === 'DONE' && half === 1 ? buildHalftime(problem, state) : null

  /**
   * 후반으로 넘어간다.
   *
   * 점수·체력·경고·교체 카드를 그대로 물려받은 상태로 후반 급수 타임에
   * 들어간다. 전반 기록은 따로 챙겨둬야 종료 보고서에서 두 반을 합칠 수
   * 있다.
   */
  const goSecondHalf = useCallback(() => {
    setFirstHalf({ state, decisions: [...decisions.current] })
    setHalf(2)
    setActiveTab('TACTICS')
    startNextHalf(carryToNextHalf(state), secondHalfSeed(problem.seed))
  }, [state, decisions, startNextHalf, problem.seed])

  return (
    <div
      className="match-screen"
      data-finished={phase === 'DONE' && half === 2 ? 'true' : undefined}
    >
      <header className="match-scorebar">
        <button className="match-back" onClick={onExit} aria-label="국면 선택으로">
          ←
        </button>
        {/*
          음소거는 **눈에 보여야 한다.** 갑자기 소리가 나면 끄는 방법을
          찾다가 탭을 닫는 사람이 있다.
        */}
        <button
          className="match-mute"
          onClick={() => {
            const next = !mutedNow
            setMuted(next)
            setMutedNow(next)
            // 켠 순간 한 번 들려줘야 켜졌다는 것을 안다
            if (!next) whistle(1, true)
          }}
          aria-pressed={mutedNow}
          aria-label={mutedNow ? '소리 켜기' : '소리 끄기'}
          title={mutedNow ? '소리 켜기' : '소리 끄기'}
        >
          {mutedNow ? '🔇' : '🔊'}
        </button>
        <div className="match-clock">
          <span>{clockOf(state.tick, half)}</span>
          {inAddedTime(state.tick, half) && (
            <b title={`추가시간 ${addedTimeOf(half)}분`}>+{addedTimeOf(half)}</b>
          )}
        </div>
        <div className="match-score">
          <span>우리</span>
          <strong>
            {shown[0]} – {shown[1]}
          </strong>
          <span>상대</span>
        </div>
        {/* 넓은 화면에서만. 좁은 화면은 아래 요약 줄이 같은 일을 한다 */}
        <div className="match-meta">
          <span>
            목표<b>{objective}</b>
          </span>
          <span>
            현재 설정<b>{setup}</b>
          </span>
        </div>
        {/*
          급수 타임 동안에는 이 자리에 남은 시간이 붙는다.

          점수판은 화면 맨 위에 **붙박이로 따라다니는** 유일한 줄이다.
          좁은 화면에서 급수 타임 상자는 페이지 아래쪽에 있어서, 여기에
          없으면 전술을 고르다가 아무 예고 없이 휘슬을 듣게 된다.
          교체 장수는 벤치 머리줄과 아래 요약에도 있으므로 이 1분 동안만
          자리를 비켜준다.
        */}
        {phase === 'READY' ? (
          <span className="match-break" data-tone={breakTone(breakLeft).toLowerCase()}>
            급수 <b>{formatBreak(breakLeft)}</b>
          </span>
        ) : (
          <span className="match-subs">교체 카드 {state.subsLeft}장</span>
        )}
      </header>

      {/*
        긴급 바 — 디자인 개편의 핵심이다.

        핸드오프 원문: *"경고를 여러 개 띄우지 않고 우선순위 하나만 문장으로
        보여준다"*. 한 판이 75초라 경고를 셋 띄우면 셋 다 안 읽힌다.

        **경기가 흐르는 동안에만 뜬다.** 급수 타임에는 시계가 멈춰 있고
        주장 브리핑이 같은 일을 더 자세히 하므로 두 개를 겹쳐 놓지 않는다.
      */}
      {phase === 'RUNNING' && <UrgencyBar state={state} cards={problem.subsLeft} />}

      {/* 좁은 화면 전용 요약 줄 */}
      <div className="match-brief">
        <div>
          <span>현재 상황</span>
          <strong>{problem.title}</strong>
        </div>
        <div>
          <span>목표</span>
          <strong>{objective}</strong>
        </div>
        <div>
          <span>현재 설정</span>
          <strong>{setup}</strong>
        </div>
      </div>

      {/*
        탭은 **좁은 화면 전용**이다. 넓은 화면은 좌우 패널을 동시에 펴므로
        한 번에 하나만 여는 탭이 오히려 방해가 된다.
      */}
      <nav className="control-tabs" aria-label="감독 메뉴">
        {CONTROL_TABS.map((tab) => (
          <button
            key={tab.id}
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/*
        넓은 화면의 3열 배치.

        가운데가 경기장이고 가장 큰 면적을 갖는다. 왼쪽은 **우리 선수를
        누르는 곳**, 오른쪽은 상대 배치와 지금 눌러야 할 버튼이다. 좁은
        화면에서는 열이 무너지고 위 탭이 한 영역씩 연다.
      */}
      <div className="match-grid" data-tab={activeTab}>
        <div className="match-col left">
          <div className="pane" data-pane="SQUAD">
            <SquadPanel
              state={state}
              locked={phase === 'DONE'}
              onOrder={setOrder}
              onPosition={setPosition}
              onFormation={setFormationLoud}
              subIn={subIn}
              onSubOut={substituteOut}
            />
          </div>
          <div className="pane" data-pane="SQUAD">
            <Bench
              state={state}
              locked={phase === 'DONE'}
              half={half}
              picked={benchPick}
              onPick={setBenchPick}
              onSub={substituteLoud}
            />
          </div>
        </div>

        <div className="match-col center">
          <div className="pane center-info" data-pane="INFO">
            <StatBars state={state} half={half} />
            <Log state={state} half={half} />
          </div>

          <div className="panel pitch-card">
            <Pitch
              state={visibleOpponentState}
              seed={problem.seed}
              half={half}
              live={phase === 'RUNNING'}
              /**
               * 하프타임에 진영을 맞바꾼다.
               *
               * 사용자가 정했다 — *"전반전 급수 타임을 했으면 후반전
               * 넘어갈때 반대진형에서 시작하는거 (실제 축구처럼)."*
               *
               * **전반을 실제로 뛴 판에서만이다.** 후반만 골라 시작하면
               * 바꿀 전반이 없으므로 그대로 그린다.
               */
              flipped={half === 2 && firstHalf !== null}
              onScore={setScene}
            />
          </div>

          <div className="pane" data-pane="TACTICS">
            <Levers
              tactics={state.tactics}
              locked={phase === 'DONE'}
              onSet={setLeverLoud}
              onPreset={applyPreset}
            />
          </div>
        </div>

        <div className="match-col right">
          <div className="pane" data-pane="AWAY">
            {/*
              오늘 만난 상대가 누구인가.

              경기 중에는 못 바꾼다 — 지고 있다고 상대를 약하게 만들 수
              있으면 그건 난이도가 아니다. 그래서 버튼이 아니라 표시다.
              순위는 전부 창작한 숫자이며 실존 팀·국가를 쓰지 않는다.
            */}
            <p className="away-rank" data-level={opponentInfo(opponent).tier.toLowerCase()}>
              <b>
                {opponentInfo(opponent).name}
                <i>{opponentInfo(opponent).rank}위</i>
              </b>
              <span>{opponentInfo(opponent).tag}</span>
            </p>
            <AwayPanel state={visibleOpponentState} />
          </div>

          {/*
            킥오프 전은 급수 타임이다. 실제 축구에서 주심이 경기를 잠시
            세우고 양 팀이 물을 마시는 그 시간이며, 감독이 선수들을 불러
            모아 지시할 수 있는 몇 안 되는 순간이다.
            이 설정이 있어야 "왜 경기 전에 다 만질 수 있는가"가 설명된다.
          */}
          {phase === 'READY' && (
            <section className="panel side-note break-note" data-tone={breakTone(breakLeft).toLowerCase()}>
              {/*
                국면 제목도 목표도 시작 시각도 이미 점수판과 국면 카드에
                떠 있다. 같은 말을 여기 다시 적으면 그만큼 주장의 말과
                경기 재개 버튼이 화면 밖으로 밀려난다. 머리줄 하나로 접었다.
              */}
              <BreakHead title={problem.title} half={half} remaining={breakLeft} />
              <div className="side-note-body">
                <CaptainBrief briefing={buildBriefing(problem, state)} />
                <button
                  className="kickoff-button"
                  data-hot={breakLeft <= BREAK_WARN_SECONDS ? 'on' : undefined}
                  onClick={resume}
                >
                  경기 재개
                  <small>바로 시작할 수 있습니다 · 재개 후 시계는 멈추지 않습니다</small>
                </button>
              </div>
            </section>
          )}

          {phase === 'RUNNING' && (
            <section className="panel side-note">
              <h2>현재 설정</h2>
              <div className="side-note-body">
                <div className="side-facts">
                  <span>
                    포메이션<b>{state.formation}</b>
                  </span>
                  <span>
                    전술<b>{activePreset?.name ?? '직접 맞춤'}</b>
                  </span>
                  <span>
                    선수 지시<b>{orderCount}명</b>
                  </span>
                  <span>
                    교체<b>{state.subsLeft}장</b>
                  </span>
                </div>
                <ul className="side-orders">
                  {state.players
                    .filter((s) => s.onPitch && !s.out && s.order !== 'NONE')
                    .map((s) => (
                      <li key={s.id}>
                        {getPlayer(s.id).num}번 ·{' '}
                        {ORDER_LABELS[s.order as Exclude<PlayerOrder, 'NONE'>].name}
                      </li>
                    ))}
                  {orderCount === 0 && <li className="dim">개별 지시 없음</li>}
                </ul>
                <small>시계는 멈추지 않고, 결정은 되돌릴 수 없습니다.</small>
              </div>
            </section>
          )}

          {phase === 'DONE' && half === 1 && halftime && (
            /**
             * 하프타임 — 아직 경기가 끝나지 않았다.
             *
             * 여기서 승패를 선고하면 안 된다. 후반 45분이 통째로 남아
             * 있고, 0-1로 지고 있어도 뒤집을 시간이 있다. 주장이 전반을
             * 정리해주고 감독은 후반 지시를 걸러 간다.
             */
            <section className="panel side-note halftime">
              <h2>{endLabel(half)}</h2>
              <div className="side-note-body">
                <div className="halftime-talk">
                  <strong>
                    <i className="ht-num">{halftime.speaker}</i>
                    {halftime.headline}
                  </strong>
                  <ul>
                    {halftime.lines.map((l) => (
                      <li key={l.id} className={`ht-${l.tone.toLowerCase()}`}>
                        {l.text}
                      </li>
                    ))}
                  </ul>
                </div>
                <button className="kickoff-button" onClick={goSecondHalf}>
                  후반 시작
                  <small>후반 급수 타임에서 지시를 다시 내릴 수 있습니다</small>
                </button>
              </div>
            </section>
          )}

          {phase === 'DONE' && half === 2 && (
            <section className={`panel side-note result ${passed ? 'passed' : 'failed'}`}>
              <h2>{endLabel(half)}</h2>
              <div className="side-note-body">
                <strong className="result-verdict">
                  {problem.objective.type === 'SURVIVE'
                    ? passed
                      ? '리드를 지켜냈습니다'
                      : '리드를 지키지 못했습니다'
                    : passed
                      ? '동점을 만들었습니다'
                      : '따라잡지 못했습니다'}
                </strong>
                <span>
                  {problem.title} · {objective}
                </span>
                <small>아래 감독 보고서에서 무엇이 결과를 갈랐는지 볼 수 있습니다.</small>
                {/*
                  ★ **같은 판 다시 — 이 게임이 사활인 이유다.**

                  바둑 사활문제집의 핵심은 *"틀렸지? 같은 자리 다시 놔봐"* 다.
                  답을 알고 같은 자리에 다시 앉아야 배운 것이 확인된다.

                  전에는 재도전이 **시드를 옮겼다.** 매번 다른 판이라 보고서에서
                  원인을 읽어도 그것을 써먹을 자리가 없었다. 그러면 확률 놀이지
                  퍼즐이 아니다. 이제 두 갈래를 나눠 둔다 — **같은 판**은 배운
                  것을 시험하는 자리, **새 판**은 다른 상황을 만나는 자리다.

                  같은 판은 체력·경고·앞 감독이 걸어둔 지시·상대까지 전부
                  똑같다. 달라지는 것은 감독의 판단 하나뿐이다.
                */}
                <div className="retry-pair">
                  <button
                    className="kickoff-button"
                    onClick={() => {
                      setActiveTab('TACTICS')
                      if (onReplay) onReplay()
                      else reset()
                    }}
                  >
                    같은 판 다시
                    <small>똑같은 조건 · 판단만 바꿔봅니다</small>
                  </button>
                  <button
                    className="kickoff-button ghost"
                    onClick={() => {
                      setActiveTab('TACTICS')
                      if (onRetry) onRetry()
                      else reset()
                    }}
                  >
                    새 판
                    <small>같은 국면 · 새로운 시작 조건</small>
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {/*
        선수단 스트립 — 열한 명을 한 줄에 펼친다.

        핸드오프 5순위. 위 배치판은 **어디에 서 있는가**를 보여주고 이쪽은
        **각자 어떤 상태인가**를 보여준다. 배치판에서 열한 명의 체력을 읽으려면
        카드를 하나씩 눈으로 훑어야 하는데, 한 줄로 세워두면 지친 선수가
        한눈에 튄다. 75초 안에 누구를 뺄지 정해야 하는 화면이다.

        **누르는 곳이 아니다.** 시안은 여기서 지시를 돌려가며 걸게 했지만,
        우리는 이미 배치판에 두 단계 탭(선수 1탭 → 행동 1탭)과 드래그가
        있다. 조작 경로를 둘로 만들면 어느 쪽이 진짜인지 흐려지고, 지시는
        되돌릴 수 없어서 돌려 걸기가 특히 위험하다. 여기서는 읽기만 한다.
      */}
      {phase !== 'DONE' && <SquadStrip state={state} />}

      {/* 감독 보고서는 길다. 열 안에 밀어 넣지 않고 아래에 통째로 편다 */}
      {/*
        경기가 **완전히** 끝났을 때만 편다. 전반이 끝난 것은 경기가 끝난
        것이 아니라 아직 45분이 남은 것이라, 여기서 판단 평가를 내면
        뒤집을 시간이 남았는데 결론을 선고하는 셈이다.
      */}
      {phase === 'DONE' && half === 2 && (
        <div className="match-report">
          <FinishReporter
            onReport={(delta) =>
              onFinish?.({
                problem,
                final: state,
                opponent,
                half: firstHalf ? 1 : 2,
                decisions:
                  decisions.current.length + (firstHalf ? firstHalf.decisions.length : 0),
                delta,
                at: Date.now(),
              })
            }
          />
          <AnalysisPanel
            problem={problem}
            initialState={initialSnapshot.current.state}
            finalState={state}
            passed={passed}
            decisions={decisions.current}
            kickoff={kickoff}
            kickoffHalf={firstHalf ? 1 : 2}
            firstHalf={firstHalf ? firstHalf.decisions : null}
            firstHalfState={firstHalf ? firstHalf.state : null}
            opponent={opponent}
            onDelta={(delta, compare) => {
              // 한 판에 한 번. 이 문이 열려 있으면 기록이 60초마다 한 건씩 는다
              if (deltaReported.current) return
              deltaReported.current = true
              onFinish?.({
                problem,
                final: state,
                opponent,
                half: firstHalf ? 1 : 2,
                decisions:
                  decisions.current.length + (firstHalf ? firstHalf.decisions.length : 0),
                delta,
                ...(compare ? { compare } : {}),
                at: Date.now(),
              })
            }}
            onReplay={() => {
              setActiveTab('TACTICS')
              // 판을 다시 하면 그 판의 결과를 다시 넘길 수 있어야 한다
              deltaReported.current = false
              if (onReplay) onReplay()
              else reset()
            }}
            onRetry={() => {
              setActiveTab('TACTICS')
              deltaReported.current = false
              if (onRetry) onRetry()
              else reset()
            }}
          />
        </div>
      )}

      {/* 화면 맨 아래 고정. 경기장을 가리지 않는 자리다 */}
      <Toast message={toast} />
    </div>
  )
}
