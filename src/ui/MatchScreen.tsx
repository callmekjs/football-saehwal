import { useEffect, useRef, useState } from 'react'
import { Pitch } from './Pitch'
import { AwayPanel, ORDER_LABELS, SquadPanel } from './SquadPanel'
import { BENCH, getPlayer } from '../sim/squad'
import { judge } from '../sim/engine'
import { TOTAL_TICKS } from '../sim/constants'
import { useMatch } from './useMatch'
import { AnalysisPanel } from './AnalysisPanel'
import { PRESETS, presetOf } from '../analysis/presets'
import { buildBriefing, type Briefing } from '../analysis/briefing'
import { useVoice, type VoiceHandle } from './useVoice'
import { applyCommand, parseCommand } from './voice'
import { scoreboardScore } from './scoreboard'
import type { Level, MatchState, PlayerOrder, Problem } from '../sim/types'

const LEVER_LABELS = {
  LINE: ['낮음', '보통', '높음'],
  PRESS: ['약', '중', '강'],
  WIDTH: ['좁게', '보통', '넓게'],
} as const

/** 경기 내 시계. 국면 시작 분에서 15분이 흐른다 */
function clockOf(tick: number, kickoff: number): string {
  const minutes = kickoff + (tick / TOTAL_TICKS) * 15
  const m = Math.floor(minutes)
  const s = String(Math.floor((minutes - m) * 60)).padStart(2, '0')
  return `${m}:${s}`
}

/**
 * 90분을 넘겼는가.
 *
 * 후반은 90분에 끝나지 않는다. 90분을 채우고 주심이 정한 추가시간을 더
 * 뛴다. 중계 화면은 이때 시계를 그대로 흘려보내면서 `+3` 을 따로 띄운다 —
 * 시계만 보면 "왜 아직 안 끝나지?"가 되고, 시계를 90:00에 세우면 남은
 * 시간을 읽을 수 없다. 둘을 나란히 두는 것이 실제 중계의 방식이다.
 */
const inAddedTime = (tick: number, kickoff: number) =>
  kickoff + (tick / TOTAL_TICKS) * 15 >= 90

/** 이 국면의 추가시간(분). 90분을 넘겨 끝나는 만큼이다 */
export const addedTimeOf = (kickoff: number) => kickoff + 15 - 90

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
function CaptainBrief({ briefing, voice }: { briefing: Briefing; voice: VoiceHandle }) {
  return (
    <div className="captain-brief">
      <p className="captain-who">
        <span className="captain-num" aria-hidden>
          {briefing.speaker}
        </span>
        <span>
          <b>{briefing.speaker}번</b> 주장이 상황을 전합니다
        </span>

        {/*
          마이크는 주장 줄 오른쪽 끝에 붙는다. 따로 한 줄을 쓰면 그만큼
          경기 재개 버튼이 아래로 밀린다.

          **지원하지 않는 브라우저에서는 아예 없다.** 파이어폭스에서
          회색 버튼이 하나 놓여 있는 것보다 없는 편이 낫다 — 탭으로 하던
          길은 그대로 살아 있으므로 잃는 기능이 없다.
        */}
        {voice.supported && !voice.denied && (
          <button
            type="button"
            className="captain-mic"
            aria-pressed={voice.listening}
            aria-label="누르고 있는 동안 음성으로 지시"
            title="누르고 있는 동안 듣습니다 — 예: 4번 내려 · 역습 · 4-4-2"
            onPointerDown={(e) => {
              e.preventDefault()
              voice.press()
            }}
            onPointerUp={voice.release}
            onPointerLeave={voice.release}
            onPointerCancel={voice.release}
          >
            <span aria-hidden>●</span>
            {voice.listening ? '듣는 중' : '눌러서 말하기'}
          </button>
        )}
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
          <summary>더 듣기 · {briefing.more.length}줄</summary>
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

      {/*
        들은 말과 한 일을 **둘 다** 보여준다.

        음성의 진짜 문제는 안 들리는 것이 아니라 **잘못 들리는 것**이다.
        무엇으로 들렸는지가 화면에 없으면, 엉뚱한 지시가 걸려도 왜 그랬는지
        알 수 없다. 자리를 늘 비워 두어 글자가 뜰 때 아래가 밀리지 않는다.

        아직 말하기 전에는 그 자리에 **무슨 말을 받는지**를 적는다. 정해진
        몇 마디만 알아듣는데 그게 무엇인지 화면에 없으면, 되는 기능도 없는
        기능이 된다. 어차피 비워 둘 자리라 높이가 늘지 않는다.
      */}
      {voice.supported && (
        <p className="captain-voice" role="status">
          {voice.denied ? (
            <span className="captain-voice-off">
              마이크를 쓸 수 없습니다 — 탭으로 하시면 됩니다
            </span>
          ) : voice.heard || voice.note ? (
            <>
              <span className="captain-heard">{voice.heard && `들은 말: ${voice.heard}`}</span>
              <span className="captain-did">{voice.note}</span>
            </>
          ) : (
            <span className="captain-voice-off">예) 6번 내려 · 역습 · 사사이</span>
          )}
        </p>
      )}
    </div>
  )
}

function Levers({
  tactics,
  onSet,
}: {
  tactics: MatchState['tactics']
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
function StatBars({ state }: { state: MatchState }) {
  const s = state.stats
  const rows: Array<[string, number, number, boolean]> = [
    ['공격 전개', s.homeAttempt, s.awayAttempt, false],
    ['슈팅 상황', s.homeShot, s.awayShot, false],
    ['세트피스 허용', 0, s.setPiece, true],
    ['배후 뚫림', 0, s.behind, true],
  ]

  return (
    <section className="panel stat-panel">
      <h2>경기 기록</h2>
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

const EVENT_TEXT: Record<string, string> = {
  GOAL: '골! 우리가 넣었다',
  CONCEDE: '실점. 상대가 넣었다',
  CARD: '경고가 나왔다',
  SEND_OFF: '퇴장. 한 명이 빠진다',
  INJURY: '부상으로 교체가 강제된다',
  PENALTY: '페널티킥',
  FOUL: '파울',
  SUB: '교체 투입',
}

function Log({ state, kickoff }: { state: MatchState; kickoff: number }) {
  const shown = state.log.filter((e) => e.kind !== 'FOUL').slice(-8).reverse()
  return (
    <section className="panel log-panel">
      <h2>경기 이벤트</h2>
      <div className="log-rows">
        {shown.length === 0 && <span className="log-empty">아직 특이사항 없음</span>}
        {shown.map((e, i) => (
          <div key={`${e.tick}-${i}`} className="log-row">
            <span className="log-min">
              {Math.floor(kickoff + (e.tick / TOTAL_TICKS) * 15)}'
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
              {EVENT_TEXT[e.kind] ?? e.kind}
              {e.target && <span style={{ color: 'var(--dim)' }}> · {getPlayer(e.target).num}번</span>}
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
  onSub,
}: {
  state: MatchState
  /** 끝난 경기에는 교체할 수 없다 */
  locked: boolean
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
        벤치 · 교체 {state.subsLeft}장 남음
        {locked ? (
          <span style={{ color: 'var(--dim)', fontWeight: 400 }}> — 경기 종료</span>
        ) : picked ? (
          <span style={{ color: 'var(--accent)' }}> — 나갈 선수를</span>
        ) : (
          <span style={{ color: 'var(--dim)', fontWeight: 400 }}> — 넣을 선수부터</span>
        )}
      </h2>

      {/* 교체는 6초 뒤에 반영된다. 그 사이 아무 표시가 없으면 안 눌린 줄 안다 */}
      {state.pendingSubs.length > 0 && (
        <div className="bench-pending">
          {state.pendingSubs.map((p) => (
            <span key={p.in}>
              {getPlayer(p.out).num}번 → {getPlayer(p.in).num}번 · 준비 중{' '}
              {Math.max(0, Math.ceil((p.atTick - state.tick) / 10))}초
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
  kickoff,
  onExit,
  onRetry,
}: {
  problem: Problem
  kickoff: number
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
  const { state, phase, start, reset, setLever, setFormation, substitute, setOrder, decisions } =
    useMatch(problem)
  const [activeTab, setActiveTab] = useState<ControlTab>('TACTICS')
  const objective =
    problem.objective.type === 'SURVIVE' ? '리드를 지켜라' : '동점 이상을 만들어라'

  /**
   * 말로 내리는 지시. **급수 타임에서만 쓴다.**
   *
   * 경기 중에는 쓰지 않는다. 75초 중 몇 초를 말하는 데 쓰는 것도 문제지만,
   * 잘못 알아들었을 때 되돌릴 방법이 없다는 것이 더 크다. 시계가 멈춰 있는
   * 동안이라면 잘못 걸려도 탭으로 고칠 시간이 있다.
   *
   * 되는 일은 탭으로 되는 일과 **정확히 같다.** 검증도 같은 `checkOrder`
   * 를 쓰므로 안 되는 이유도 같은 문장으로 나온다.
   */
  const stateRef = useRef(state)
  stateRef.current = state
  const voice = useVoice((text) => {
    const command = parseCommand(text)
    if (!command) return '다시 말씀해 주세요'
    return applyCommand(command, stateRef.current, { setOrder, setLever, setFormation })
  })

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
  const [scene, setScene] = useState<[number, number]>(problem.score)
  useEffect(() => setScene(problem.score), [problem])
  const shown = scoreboardScore(phase === 'DONE', state.score, scene)
  // 휘슬이 울리면 마이크를 놓는다. 급수 타임 밖에서는 듣지 않는다
  const releaseVoice = voice.release
  useEffect(() => {
    if (phase !== 'READY') releaseVoice()
  }, [phase, releaseVoice])
  useEffect(() => {
    if (phase === 'DONE') setActiveTab('INFO')
  }, [phase])

  const passed = judge(state, problem.objective)
  const activePreset = presetOf(state.tactics)
  const setup = `${state.formation} · ${activePreset?.name ?? '직접 맞춤'}`
  const orderCount = state.players.filter((s) => s.onPitch && !s.out && s.order !== 'NONE').length

  return (
    <div className="match-screen">
      <header className="match-scorebar">
        <button className="match-back" onClick={onExit} aria-label="국면 선택으로">
          ←
        </button>
        <div className="match-clock">
          <span>{clockOf(state.tick, kickoff)}</span>
          {inAddedTime(state.tick, kickoff) && (
            <b title={`추가시간 ${addedTimeOf(kickoff)}분`}>+{addedTimeOf(kickoff)}</b>
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
        <span className="match-subs">교체 {state.subsLeft}</span>
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
              onFormation={setFormation}
            />
          </div>
          <div className="pane" data-pane="SQUAD">
            <Bench state={state} locked={phase === 'DONE'} onSub={substitute} />
          </div>
        </div>

        <div className="match-col center">
          <div className="pane center-info" data-pane="INFO">
            <StatBars state={state} />
            <Log state={state} kickoff={kickoff} />
          </div>

          <div className="panel pitch-card">
            <Pitch state={state} seed={problem.seed} live={phase === 'RUNNING'} onScore={setScene} />
          </div>

          <div className="pane" data-pane="TACTICS">
            <Levers tactics={state.tactics} onSet={setLever} />
          </div>
        </div>

        <div className="match-col right">
          <div className="pane" data-pane="AWAY">
            <AwayPanel state={state} />
          </div>

          {/*
            킥오프 전은 급수 타임이다. 실제 축구에서 주심이 경기를 잠시
            세우고 양 팀이 물을 마시는 그 시간이며, 감독이 선수들을 불러
            모아 지시할 수 있는 몇 안 되는 순간이다.
            이 설정이 있어야 "왜 경기 전에 다 만질 수 있는가"가 설명된다.
          */}
          {phase === 'READY' && (
            <section className="panel side-note">
              {/*
                국면 제목도 목표도 시작 시각도 이미 점수판과 국면 카드에
                떠 있다. 같은 말을 여기 다시 적으면 그만큼 주장의 말과
                경기 재개 버튼이 화면 밖으로 밀려난다. 머리줄 하나로 접었다.
              */}
              <h2>
                급수 타임 · {problem.title}
                <span style={{ color: 'var(--dim)', fontWeight: 400 }}>
                  {' '}
                  · 후반 {kickoff}분 · 시계 정지
                </span>
              </h2>
              <div className="side-note-body">
                <CaptainBrief briefing={buildBriefing(problem, state)} voice={voice} />
                <button
                  className="kickoff-button"
                  onClick={() => {
                    start()
                    setActiveTab('TACTICS')
                  }}
                >
                  지시 끝 · 경기 재개
                  <small>이후 시계는 멈추지 않습니다</small>
                </button>
              </div>
            </section>
          )}

          {phase === 'RUNNING' && (
            <section className="panel side-note">
              <h2>지금 걸려 있는 것</h2>
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
                  {orderCount === 0 && <li className="dim">걸린 개별 지시 없음</li>}
                </ul>
                <small>시계는 멈추지 않습니다. 되돌릴 수 없습니다.</small>
              </div>
            </section>
          )}

          {phase === 'DONE' && (
            <section className={`panel side-note result ${passed ? 'passed' : 'failed'}`}>
              <h2>경기 종료</h2>
              <div className="side-note-body">
                <strong className="result-verdict">
                  {problem.objective.type === 'SURVIVE'
                    ? passed
                      ? '지켜냈다'
                      : '무너졌다'
                    : passed
                      ? '따라잡았다'
                      : '실패했다'}
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
      {phase === 'DONE' && (
        <div className="match-report">
          <AnalysisPanel problem={problem} decisions={decisions.current} kickoff={kickoff} />
        </div>
      )}
    </div>
  )
}
