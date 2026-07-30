import { useCallback, useEffect, useRef, useState } from 'react'
import { Pitch } from './Pitch'
import { AwayPanel, ORDER_LABELS, SquadPanel } from './SquadPanel'
import { BENCH, getPlayer } from '../sim/squad'
import { carryToNextHalf, judge, secondHalfSeed } from '../sim/engine'
import { useMatch } from './useMatch'
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
import type {
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
}: {
  tactics: MatchState['tactics']
  locked: boolean
  onSet: (t: 'LINE' | 'PRESS' | 'WIDTH', v: Level) => void
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
          <span style={{ color: 'var(--accent)' }}> · {matched.name}</span>
        ) : (
          <span style={{ color: 'var(--dim)', fontWeight: 400 }}> · 직접 맞춤</span>
        )}
      </h2>
      <div className="tactics-presets">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className="chip tactic-preset"
            aria-pressed={matched?.name === p.name}
            disabled={locked}
            onClick={() => {
              onSet('LINE', p.v[0])
              onSet('PRESS', p.v[1])
              onSet('WIDTH', p.v[2])
            }}
          >
            <strong>{p.name}</strong>
            <small>{p.hint}</small>
          </button>
        ))}
      </div>
      <details className="advanced-tactics">
        <summary>라인 · 압박 · 폭 세부 조정</summary>
        <div className="lever-list">
          {rows.map(([key, label, value]) => (
            <div key={key} className="lever-row">
              <span>{label}</span>
              <div className="lever-options">
                {LEVER_LABELS[key].map((text, i) => (
                  <button
                    key={text}
                    className="chip"
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
      </details>
    </section>
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
  onSub,
}: {
  state: MatchState
  /** 끝난 경기에는 교체할 수 없다 */
  locked: boolean
  /** 전반이 끝난 것과 경기가 끝난 것은 다른 말이다 */
  half: Half
  onSub: (out: string, inId: string) => string | null
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 2200)
    return () => clearTimeout(t)
  }, [note])

  useEffect(() => {
    if (locked) setPicked(null)
  }, [locked])

  const onPitch = state.players.filter((s) => s.onPitch && !s.out)

  return (
    <section className="panel bench-panel">
      <h2>
        벤치 · 교체 카드 {state.subsLeft}장
        {locked ? (
          <span style={{ color: 'var(--dim)', fontWeight: 400 }}> — {endLabel(half)}</span>
        ) : picked ? (
          <span style={{ color: 'var(--accent)' }}> — 나갈 선수 선택</span>
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
        <div className="bench-row">
          {BENCH.map((b) => {
            const s = state.players.find((p) => p.id === b.id)!
            const used = s.onPitch || s.out
            return (
              <button
                key={b.id}
                className="chip bench-chip"
                aria-pressed={picked === b.id}
                disabled={locked || used || state.subsLeft <= 0}
                onClick={() => setPicked(picked === b.id ? null : b.id)}
              >
                <span className="bench-num">{b.num}</span>
                <span className="bench-sub">
                  {b.pos} · 속도 {b.speed}
                </span>
              </button>
            )
          })}
        </div>

        {picked && (
          <div className="bench-row">
            {onPitch.map((s) => {
              const p = getPlayer(s.id)
              return (
                <button
                  key={s.id}
                  className="chip bench-chip"
                  onClick={() => {
                    const err = onSub(s.id, picked)
                    setNote(err ?? `${p.num}번 → ${getPlayer(picked).num}번`)
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

/** 좁은 화면에서만 쓰는 탭. 넓은 화면은 네 영역을 한꺼번에 편다 */
type ControlTab = 'TACTICS' | 'SQUAD' | 'AWAY' | 'INFO'

const CONTROL_TABS: Array<{ id: ControlTab; label: string }> = [
  { id: 'TACTICS', label: '전술' },
  { id: 'SQUAD', label: '선수' },
  { id: 'AWAY', label: '상대' },
  { id: 'INFO', label: '기록' },
]

export function MatchScreen({
  problem,
  startHalf,
  opponent = 'USA',
  onExit,
  onRetry,
}: {
  problem: Problem
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
  } = useMatch(problem, opponent)
  const [activeTab, setActiveTab] = useState<ControlTab>('TACTICS')
  const objective =
    problem.objective.type === 'SURVIVE' ? '리드를 지켜라' : '동점 이상을 만들어라'

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
    <div className="match-screen">
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
              onFormation={setFormation}
            />
          </div>
          <div className="pane" data-pane="SQUAD">
            <Bench state={state} locked={phase === 'DONE'} half={half} onSub={substitute} />
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
              onScore={setScene}
            />
          </div>

          <div className="pane" data-pane="TACTICS">
            <Levers tactics={state.tactics} locked={phase === 'DONE'} onSet={setLever} />
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
                <button
                  className="kickoff-button"
                  onClick={() => {
                    setActiveTab('TACTICS')
                    if (onRetry) onRetry()
                    else reset()
                  }}
                >
                  다시 도전
                  <small>같은 국면 · 새로운 시작 조건</small>
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* 감독 보고서는 길다. 열 안에 밀어 넣지 않고 아래에 통째로 편다 */}
      {/*
        경기가 **완전히** 끝났을 때만 편다. 전반이 끝난 것은 경기가 끝난
        것이 아니라 아직 45분이 남은 것이라, 여기서 판단 평가를 내면
        뒤집을 시간이 남았는데 결론을 선고하는 셈이다.
      */}
      {phase === 'DONE' && half === 2 && (
        <div className="match-report">
          <AnalysisPanel
            problem={problem}
            decisions={decisions.current}
            kickoff={kickoff}
            firstHalf={firstHalf ? firstHalf.decisions : null}
            opponent={opponent}
          />
        </div>
      )}
    </div>
  )
}
