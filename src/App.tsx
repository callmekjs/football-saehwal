import { useMemo, useState } from 'react'
import raw from './data/problems.json' with { type: 'json' }
import { noActionRate, referenceNoActionRate } from './analysis/balanceBaseline'
import {
  OUR_ABILITY_AVERAGE,
  TIER_LABEL,
  opponentAbilityAverage,
  opponentAbilityRatio,
  opponentInfo,
  teamsByTier,
} from './analysis/opponents'
import {
  addedTimeOf,
  breakStart,
  halfLabel,
  kickoffMinute,
  SEGMENT_MINUTES,
  segmentEnd,
  type Half,
} from './matchClock'
import { opponentSquad } from './analysis/opponentSquad'
import { awayCaptainNumber } from './captain'
import { awaySlots, type AwayFormationId } from './sim/awayShape'
import { createState } from './sim/engine'
import { FORMATIONS } from './sim/formations'
import { OUR_TEAM } from './sim/constants'
import { HOME_SQUAD, rollRoster } from './sim/squad'
import { toProblem } from './sim/problems'
import type { Level, OpponentId, Position, Problem } from './sim/types'
import { attributeLabel } from './ui/playerData'
import { MatchScreen } from './ui/MatchScreen'
import { TitleScreen, type HomeSection } from './ui/TitleScreen'
import { clearHistory, readHistory, upsertRecord, type MatchRecord } from './ui/matchHistory'
import { isSameMatch, toRecord } from './ui/recordMatch'
import { SquadSection } from './ui/SquadSection'
import { HistorySection } from './ui/HistorySection'

const POSITION_LABEL: Record<Position, string> = {
  GK: '골키퍼',
  DF: '수비',
  MF: '중원',
  FW: '공격',
}

/**
 * 전술 세 레버의 이름표.
 *
 * `AnalysisPanel` · `oneMove` 와 **글자 하나까지 같아야 한다.** 킥오프
 * 화면이 `압박 약`이라고 적어놓고 종료 화면이 다른 말을 쓰면 같은 값이
 * 두 이름을 갖는다.
 */
const LEVEL_LABEL: Record<'line' | 'press' | 'width', Record<Level, string>> = {
  line: { 0: '낮음', 1: '보통', 2: '높음' },
  press: { 0: '약', 1: '중', 2: '강' },
  width: { 0: '좁게', 1: '보통', 2: '넓게' },
}

/** 국면 카드와 프리뷰가 함께 쓰는 정보 */
interface Entry {
  problem: Problem
  summary: string
}

interface PickedMatch {
  entry: Entry
  half: Half
}

function goalLabel(problem: Problem): '리드 지키기' | '동점 이상' {
  return problem.objective.type === 'SURVIVE' ? '리드 지키기' : '동점 이상'
}

function situationNote(problem: Problem): string {
  if (problem.awayCount < 11) return '상대 10명'
  if (problem.unavailable.length > 0) return '우리 10명'
  if (problem.booked.length > 0) return `경고 ${problem.booked.length}명`
  return '전원 정상'
}

/**
 * 기준선을 낀 막대 하나.
 *
 * 값 하나만 숫자로 적으면 그것이 센 것인지 약한 것인지 알 수 없다. 기준
 * 눈금을 함께 그려서 **어느 쪽으로 얼마나 치우쳤는지**를 보이게 한다.
 */
function Meter({
  label,
  value,
  min,
  max,
  base,
  read,
}: {
  label: string
  value: number
  min: number
  max: number
  /** 기준 눈금. 여기가 「보통」이다 */
  base: number
  /** 사람이 읽는 값 */
  read: string
}) {
  const at = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * 100
  const from = Math.min(at(base), at(value))
  const to = Math.max(at(base), at(value))
  return (
    <div className="opp-meter" data-side={value >= base ? 'up' : 'down'}>
      <small>{label}</small>
      <i aria-hidden>
        <u style={{ left: `${at(base)}%` }} />
        <b style={{ left: `${from}%`, width: `${Math.max(1.5, to - from)}%` }} />
      </i>
      <b>{read}</b>
    </div>
  )
}

interface BoardDot {
  pos: Position
  /** 피치 가로 좌표(m). 우리 골문이 0, 상대 골문이 105 */
  x: number
  /** 피치 세로 좌표(m). 0~68 */
  y: number
  num?: number
  captain?: boolean
}

/**
 * 대형 하나를 작은 배치도로.
 *
 * 우리 대형은 왼쪽 골문을, 상대 대형은 오른쪽 골문을 지키므로 각자 자기
 * 진영만 잘라서 크게 보여준다. 실제 좌표를 그대로 읽으므로 대형 표를
 * 고치면 이 그림도 따라온다.
 */
function ShapeBoard({
  dots,
  side,
  label,
}: {
  dots: readonly BoardDot[]
  side: 'home' | 'away'
  label: string
}) {
  const place = (x: number) =>
    side === 'home' ? (x / 78) * 100 : ((x - 40) / 65) * 100
  return (
    <div className="opp-board" data-side={side} aria-label={label}>
      <i className="opp-board-box" aria-hidden />
      <i className="opp-board-arc" aria-hidden />
      {dots.map((dot, index) => (
        <span
          key={dot.num ?? index}
          className="opp-board-dot"
          data-pos={dot.pos}
          data-side={side}
          style={{ left: `${place(dot.x)}%`, top: `${(dot.y / 68) * 100}%` }}
        >
          {dot.num ?? ''}
          {dot.captain && <em aria-label="주장">C</em>}
        </span>
      ))}
    </div>
  )
}

/** 상대 대형을 등번호가 있는 작은 배치도로 */
function AwayShapeBoard({
  formation,
  count = 11,
  opponent,
}: {
  formation: AwayFormationId
  count?: number
  /** 주장은 팀마다 다르다. 리더십이 가장 높은 선수가 찬다 */
  opponent?: OpponentId
}) {
  const captain = awayCaptainNumber(formation, count, opponent)
  const dots = awaySlots(formation, count).map(([pos, x, y, num]) => ({
    pos,
    x,
    y,
    num,
    captain: num === captain,
  }))
  return <ShapeBoard dots={dots} side="away" label={`상대 ${formation} 대형`} />
}

/**
 * 02 · 상대 선택.
 *
 * 사용자가 정했다 — *"13개 팀들의 특징, 주요 선수, 스탯과 상태"*.
 *
 * 전에는 팀 버튼 열세 개와 고른 팀의 한 줄 설명·평균 능력치가 전부였다.
 * 1600×1000 실측으로 내용이 507px뿐이라 **화면 아래 433px이 통째로
 * 비었다.**
 *
 * 여기서 숫자를 새로 지어내지 않는다. `opponentSquad()` 가 이미 세기
 * 계수에서 명단을 유도해 두었는데 **아무 화면도 그것을 쓰지 않고 있었다.**
 * 그것과 `AWAY_SHAPES` 의 실제 대형을 읽어 그린다. 계수를 튜닝하면 이
 * 화면이 저절로 따라온다.
 */
function OpponentPicker({
  value,
  onPick,
}: {
  value: OpponentId
  onPick: (value: OpponentId) => void
}) {
  const selected = opponentInfo(value)
  const squad = opponentSquad(value)
  const ratio = opponentAbilityRatio(value)

  return (
    <section id="opponents" className="kickoff-opponents" aria-labelledby="opponent-title">
      <div className="kickoff-section-head">
        <div className="kickoff-section-label">
          <i aria-hidden>02</i>
          <div>
            <small>오늘의 상대</small>
            <h2 id="opponent-title">13개 팀 중 선택</h2>
          </div>
        </div>
        <p>고른 팀이 어떤 축구를 하는지가 오른쪽에 함께 바뀝니다.</p>
      </div>

      <div className="opp-layout">
        <div className="opp-list">
          {teamsByTier().map(({ tier, teams }) => (
            <fieldset className="kickoff-team-tier" key={tier}>
              <legend>{TIER_LABEL[tier]}</legend>
              <div className="kickoff-team-grid">
                {teams.map((team) => {
                  const active = value === team.id
                  const teamRatio = opponentAbilityRatio(team.id)
                  return (
                    <button
                      type="button"
                      key={team.id}
                      className="kickoff-team"
                      aria-pressed={active}
                      data-selected={active ? 'true' : 'false'}
                      onClick={() => onPick(team.id)}
                    >
                      <span>
                        <b>{team.name}</b>
                        <i>{team.rank}위</i>
                      </span>
                      <em>{team.tag}</em>
                      {/*
                        열세 팀을 하나씩 눌러 보지 않아도 세기가 비교되게
                        한다. 막대는 우리 평균을 기준으로 한 배수다.
                      */}
                      <span
                        className="kickoff-team-bar"
                        data-strong={teamRatio >= 1 ? 'on' : undefined}
                      >
                        <i aria-hidden>
                          <b style={{ width: `${Math.min(100, (teamRatio / 1.6) * 100)}%` }} />
                        </i>
                        <u>{teamRatio.toFixed(2)}배</u>
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="opp-dossier" aria-live="polite">
          <header className="opp-head">
            <span className="opp-head-name">
              <b>{selected.name}</b>
              <i>참고 순위 {selected.rank}위 · {TIER_LABEL[selected.tier]}</i>
            </span>
            <em>{selected.tag}</em>
          </header>

          <p className="opp-note">{selected.note}</p>

          {/*
            평균 능력치는 세기 계수에서 유도한다. 따로 적어두면 계수를 손볼
            때마다 화면과 실제가 갈린다.
          */}
          <div className="opp-compare">
            <div>
              <small>우리</small>
              <b>{OUR_ABILITY_AVERAGE.toFixed(1)}</b>
              <i aria-hidden>
                <u style={{ width: `${(OUR_ABILITY_AVERAGE / 20) * 100}%` }} data-side="home" />
              </i>
            </div>
            <div>
              <small>{selected.name}</small>
              <b data-strong={ratio >= 1 ? 'on' : undefined}>
                {opponentAbilityAverage(value).toFixed(1)}
              </b>
              <i aria-hidden>
                <u
                  style={{ width: `${(opponentAbilityAverage(value) / 20) * 100}%` }}
                  data-side="away"
                />
              </i>
            </div>
            <strong data-strong={ratio >= 1 ? 'on' : undefined}>{ratio.toFixed(2)}배</strong>
          </div>

          <div className="opp-meters">
            <h3>이 팀이 위협하는 방식</h3>
            <Meter
              label="등 뒤로 넘기기"
              value={selected.shape.behind}
              min={0.6}
              max={1.5}
              base={1}
              read={`${selected.shape.behind.toFixed(2)}배`}
            />
            <Meter
              label="짧게 엮어 들어오기"
              value={selected.shape.open}
              min={0.6}
              max={1.5}
              base={1}
              read={`${selected.shape.open.toFixed(2)}배`}
            />
            <Meter
              label="기회를 골로 만들기"
              value={selected.shape.finish}
              min={0.6}
              max={1.5}
              base={1}
              read={`${selected.shape.finish.toFixed(2)}배`}
            />
            <Meter
              label="공격 세기"
              value={selected.atk}
              min={-1}
              max={1}
              base={0}
              read={selected.atk === 0 ? '기준' : `${selected.atk > 0 ? '+' : ''}${selected.atk}`}
            />
            <Meter
              label="수비 세기"
              value={selected.def}
              min={-1}
              max={1}
              base={0}
              read={selected.def === 0 ? '기준' : `${selected.def > 0 ? '+' : ''}${selected.def}`}
            />
          </div>

          <div className="opp-key">
            <h3>
              주요 선수
              <small>자기 자리 평균보다 가장 많이 튀는 세 명</small>
            </h3>
            <ul>
              {squad.keyPlayers.map((player) => (
                <li key={player.num}>
                  <b>{player.num}</b>
                  <span>
                    <small>{POSITION_LABEL[player.pos]}</small>
                    <i>
                      {attributeLabel(player.best.key)} {player.best.value}
                    </i>
                  </span>
                  <em>평균 {player.rating.toFixed(1)}</em>
                </li>
              ))}
            </ul>
          </div>

          <div className="opp-shape">
            <h3>
              즐겨 서는 대형
              <small>{squad.formation}</small>
            </h3>
            <AwayShapeBoard formation={squad.formation} opponent={value} />
          </div>

          <p className="opp-foot">
            상대는 선수 한 명씩이 아니라 팀 계수 하나로 계산됩니다. 위 능력치와
            명단은 그 계수에서 되짚어 만든 값이며, 경기 결과에는 들어가지
            않습니다. 대형은 경기 중 점수와 성향에 따라 바뀝니다.
          </p>
        </div>
      </div>
    </section>
  )
}

function SituationCard({
  entry,
  n,
  selected,
  opponent,
  onPick,
}: {
  entry: Entry
  n: number
  selected: boolean
  /** 오늘 고른 상대. 통과율은 이 상대 기준으로 보여준다 */
  opponent: OpponentId
  onPick: () => void
}) {
  const { problem } = entry
  /**
   * 고른 상대 기준으로 보여준다.
   *
   * 전에는 기준팀 하나뿐이라, 베트남을 골라놓고도 미국 숫자를 보고 판을
   * 골랐다. 실제로는 같은 국면이 미국 49.5% 베트남 54.9% 로 다르다.
   */
  const rate = noActionRate(problem.id, opponent)
  const survive = problem.objective.type === 'SURVIVE'

  return (
    <button
      type="button"
      className="kickoff-situation"
      aria-pressed={selected}
      data-selected={selected ? 'true' : 'false'}
      data-goal={survive ? 'survive' : 'equalize'}
      onClick={onPick}
    >
      <span className="kickoff-situation-top">
        <b>제{n}국면</b>
        <em>{survive ? 'SURVIVE' : 'EQUALIZE'}</em>
      </span>
      <span className="kickoff-situation-score">
        {problem.score[0]}
        <i>:</i>
        {problem.score[1]}
      </span>
      <strong>{problem.title}</strong>
      <span className="kickoff-situation-meta">
        교체 {problem.subsLeft}장 · {situationNote(problem)}
      </span>
      {/*
        다섯 장이 숫자만 다른 같은 카드로 보였다. 물려받은 대형과 통과율
        막대를 넣어 **모양이 다르게** 만든다. 둘 다 실제 값이다.
      */}
      <span className="kickoff-situation-setup">
        <i>{problem.initialFormation}</i>
        <u>
          라인 {LEVEL_LABEL.line[problem.initialTactics.line]} · 압박{' '}
          {LEVEL_LABEL.press[problem.initialTactics.press]} · 폭{' '}
          {LEVEL_LABEL.width[problem.initialTactics.width]}
        </u>
      </span>
      <span className="kickoff-survival">
        <small>{opponentInfo(opponent).name} 상대 · 아무것도 안 하면</small>
        <b>{(rate * 100).toFixed(1)}%</b>
        <em>만 버팁니다</em>
        <i className="kickoff-survival-bar" aria-hidden>
          <b style={{ width: `${Math.max(3, rate * 100)}%` }} />
        </i>
      </span>
      <span className="kickoff-selected-mark" aria-hidden>
        ✓ 선택
      </span>
    </button>
  )
}

function HalfPicker({
  value,
  onPick,
}: {
  value: Half
  onPick: (half: Half) => void
}) {
  return (
    <div className="kickoff-half-picker" role="group" aria-label="시작 지점">
      {[1, 2].map((halfValue) => {
        const half = halfValue as Half
        const active = value === half
        return (
          <button
            type="button"
            key={half}
            aria-pressed={active}
            data-selected={active ? 'true' : 'false'}
            onClick={() => onPick(half)}
          >
            <b>{half === 1 ? '전반부터' : '후반만'}</b>
            <small>
              {kickoffMinute(half)}분 재개 · {segmentEnd(half)}분 종료
            </small>
          </button>
        )
      })}
    </div>
  )
}

/** 왼쪽 차례 안내. 누르면 **화면이 바뀐다** */
const NAV_STEPS: ReadonlyArray<{ id: HomeSection; n: string; label: string; hint: string }> = [
  { id: 'squad', n: '01', label: '우리 팀', hint: '선수 스물여섯 명' },
  { id: 'opponent', n: '02', label: '상대 선택', hint: '13개 팀' },
  { id: 'situation', n: '03', label: '국면 선택', hint: '고르고 킥오프' },
  { id: 'history', n: '04', label: '분석 · 기록', hint: '지난 판' },
]

/**
 * 왼쪽 차례 안내.
 *
 * **누르면 화면이 통째로 바뀐다.** 전에는 같은 화면 안의 자리로 스크롤만
 * 했고, 넓고 높은 화면에서는 내용이 한 화면에 다 들어가 옮길 자리조차
 * 없어서 아무 일도 일어나지 않았다. 활성 표시도 첫 항목에 고정이었다.
 *
 * 사용자가 정했다 — *"1번 누르면 그거에 맞는 페이지가 있어야 하는데 그냥
 * 밑으로 내려간다."*
 */
function KickoffNav({
  value,
  onPick,
}: {
  value: HomeSection
  onPick: (section: HomeSection) => void
}) {
  return (
    <nav className="kickoff-nav" aria-label="킥오프 준비 순서">
      <small>MANAGER</small>
      {NAV_STEPS.map((step) => (
        <button
          type="button"
          key={step.id}
          className={value === step.id ? 'active' : undefined}
          aria-current={value === step.id ? 'page' : undefined}
          onClick={() => onPick(step.id)}
        >
          <b>{step.n}</b>
          <span>
            {step.label}
            <i>{step.hint}</i>
          </span>
        </button>
      ))}

      <div className="kickoff-nav-rules" id="rules">
        <small>SURVIVAL RULES</small>
        <p>판단은 되돌릴 수 없고 시계는 멈추지 않습니다.</p>
        <div aria-label="한 판의 단계">
          <i>읽기</i>
          <i>판단</i>
          <i>관전</i>
          <i>복기</i>
        </div>
      </div>
    </nav>
  )
}

const TICKER =
  '시계는 끝까지 흐른다 — 일시정지 없음　　교체 카드는 되돌릴 수 없다　　' +
  '13개 상대 팀은 서로 다른 축구를 한다　　기준팀 무개입 통과율 11.1~48.9%　　' +
  '좋은 판단도 한 경기에서는 질 수 있다　　국면과 가상 선수 능력치는 창작이다　　'

export function App() {
  const entries = useMemo<Entry[]>(
    () =>
      raw
        .map(toProblem)
        .sort((a, b) => a.order - b.order)
        .map((problem) => ({
          problem,
          summary: problem.summary ?? '',
        })),
    [],
  )

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [selectedHalf, setSelectedHalf] = useState<Half>(2)
  const [picked, setPicked] = useState<PickedMatch | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [replay, setReplay] = useState(0)
  const [opponent, setOpponent] = useState<OpponentId>('USA')
  /**
   * 첫 화면을 지났는가.
   *
   * 전에는 열자마자 상대와 국면을 고르라고 했다. 무엇을 하는 것인지 알기
   * 전에 선택을 요구하는 화면이었다.
   */
  const [entered, setEntered] = useState(false)
  const [section, setSection] = useState<HomeSection>('situation')
  const [history, setHistory] = useState<MatchRecord[]>(() => readHistory())
  /** 감독이 고른 선발. null 이면 명단의 기본 선발이다 */
  const [starters, setStarters] = useState<ReadonlySet<string> | null>(null)
  /** 명단 다시 뽑기 씨앗. 0 이면 손으로 적어둔 기본 명단이다 */
  const [rosterSeed, setRosterSeed] = useState(0)
  const roster = useMemo(
    () => (rosterSeed === 0 ? undefined : rollRoster(rosterSeed)),
    [rosterSeed],
  )

  const selectedEntry = entries[selectedIndex]
  /**
   * 홈의 체력 예고와 실제로 곧 시작할 판이 같은 시드를 본다.
   *
   * KICK OFF에서 `attempt`가 하나 늘어나므로 홈에서는 그 다음 값을 미리
   * 계산한다. 그래야 사이드바에 43이라고 보인 선수가 경기장에 들어가자마자
   * 70으로 바뀌는 일이 없다.
   */
  /**
   * 「명단 다시 뽑기」는 국면 시드도 함께 옮긴다.
   *
   * 전에는 능력치 씨앗만 바꿔서, 눌러도 **경고와 체력과 물려받은 전술이
   * 그대로**였다. 그 셋은 국면 시드에서 뽑히기 때문이다. 사용자가
   * "8번과 10번이 다시 뽑아도 계속 경고가 나온다"고 한 것이 이것이다.
   *
   * 경고 자체는 판마다 고르게 흩어진다 — 실측으로 2~10번이 비슷한 비율로
   * 나온다. 문제는 분포가 아니라 **버튼이 그 주사위를 안 굴린 것**이었다.
   */
  const rerollOffset = rosterSeed * 104729
  const previewProblem = useMemo(
    () => ({
      ...selectedEntry.problem,
      seed: selectedEntry.problem.seed + (attempt + 1) * 7919 + rerollOffset,
    }),
    [attempt, rerollOffset, selectedEntry],
  )
  const previewState = useMemo(
    () => createState(previewProblem, opponent, starters ?? undefined, roster),
    [opponent, previewProblem, roster, starters],
  )
  if (picked) {
    const problem = {
      ...picked.entry.problem,
      seed: picked.entry.problem.seed + attempt * 7919 + rerollOffset,
    }
    return (
      <MatchScreen
        key={`${picked.entry.problem.id}#${picked.half}#${attempt}#${replay}#${opponent}`}
        problem={problem}
        startHalf={picked.half}
        opponent={opponent}
        starters={starters ?? undefined}
        roster={roster}
        onFinish={(finished) => {
          // 같은 판이면 덮어쓴다. 분석이 끝나면 같은 판이 한 번 더 온다
          setHistory(upsertRecord(toRecord(finished), isSameMatch))
        }}
        onExit={() => setPicked(null)}
        onRetry={() => setAttempt((n) => n + 1)}
        onReplay={() => setReplay((n) => n + 1)}
      />
    )
  }

  if (!entered) {
    return (
      <TitleScreen
        historyCount={history.length}
        onStart={() => {
          // 선수부터 보고 고를 수 있게 우리 팀으로 들어간다.
          // 사용자가 정했다 — "바로 시작하면 1번으로 가서 선수들을 고를 수
          // 있게 해줘."
          setSection('squad')
          setEntered(true)
        }}
        onGo={(next: HomeSection) => {
          // 첫 화면에서 고른 그 페이지로 바로 간다
          setSection(next)
          setEntered(true)
        }}
      />
    )
  }

  const selectedProblem = selectedEntry.problem
  const selectedOpponent = opponentInfo(opponent)
  const [homeScore, awayScore] = selectedProblem.score

  return (
    <div className="kickoff-home">
      <header className="kickoff-header">
        <button
          type="button"
          className="kickoff-wordmark as-button"
          onClick={() => setEntered(false)}
          title="첫 화면으로"
        >
          축구 사활
        </button>
        <div className="kickoff-header-facts" aria-label="시뮬레이션 정보">
          <span>5개 국면</span>
          <span>13개 상대</span>
          <span>실시간 75초</span>
        </div>
        <div className="kickoff-matchday">
          <span>감독 모드</span>
          <b>
            <i aria-hidden />
            MATCH DAY
          </b>
        </div>
      </header>

      <div className="kickoff-layout" data-section={section}>
        <KickoffNav value={section} onPick={setSection} />

        {/*
          한 화면에 한 가지만 둔다.
          사용자가 정했다 — *"1번 누르면 그거에 맞는 페이지가 있어야 하는데
          그냥 밑으로 내려간다. 밑으로 내려가는 게 아니고 그거에 맞는
          페이지가 있어야 해."* 전에는 네 자리가 모두 같은 화면 안에 있어서
          차례 안내가 자리 이동에 지나지 않았다.
        */}
        <main className="kickoff-main">
          {section === 'squad' && (
            <>
              <SquadSection
                state={previewState}
                rosterSeed={rosterSeed}
                onRefresh={() => setRosterSeed((n) => n + 1)}
                lineup={{
                  changed: starters !== null,
                  onReset: () => setStarters(null),
                  onSwap: (starterId, benchId) => {
                    const current = new Set(
                      starters ??
                        HOME_SQUAD.filter((p) => !p.onBench).map((p) => p.id),
                    )
                    current.delete(starterId)
                    current.add(benchId)
                    setStarters(current)
                  },
                }}
              />
              <section className="kickoff-house-rules wide">
                <small>HOUSE RULES</small>
                <p>
                  시계는 멈추지 않습니다. 교체 카드는 되돌릴 수 없습니다. 좋은
                  판단도 결과가 나쁠 수 있습니다.
                </p>
              </section>
            </>
          )}

          {section === 'opponent' && (
            <OpponentPicker value={opponent} onPick={setOpponent} />
          )}

          {section === 'history' && (
            <HistorySection
              records={history}
              problems={entries.map((item) => ({
                id: item.problem.id,
                title: item.problem.title,
                // 기록 화면은 기준팀으로 본다. 판마다 상대가 다르므로
                // 한 팀을 정해두지 않으면 국면끼리 비교가 안 된다
                noActionRate: referenceNoActionRate(item.problem.id),
                goal: goalLabel(item.problem),
              }))}
              onClear={() => setHistory(clearHistory())}
              onGoSituation={() => setSection('situation')}
            />
          )}

          {section === 'situation' && (
            <>
          <section
            id="match-preview"
            className="kickoff-preview"
            aria-label={`${selectedProblem.title} 경기 미리보기`}
          >
            <div className="kickoff-pitch" aria-hidden>
              <i className="outline" />
              <i className="halfway" />
              <i className="circle" />
            </div>
            <div className="kickoff-vignette" aria-hidden />
            <span className="kickoff-preview-badge">
              <i aria-hidden />
              국면 재현 — 이 장면부터 시작합니다
            </span>
            <div className="kickoff-preview-grid">
              {/*
                양옆 490px이 팀 이름 한 줄만 담고 비어 있었다. 지금 이
                국면이 다른 국면과 무엇이 다른지는 **물려받은 설정**에
                들어 있는데 그것이 어디에도 안 보였다. 여기에 놓는다.
              */}
              <div className="kickoff-crest home">
                <b>{OUR_TEAM.name}</b>
                <small>참고 순위 {OUR_TEAM.rank}위 · 홈</small>
                <div className="kickoff-setup">
                  <h3>
                    물려받은 대형
                    <em>{selectedProblem.initialFormation}</em>
                  </h3>
                  <ShapeBoard
                    dots={FORMATIONS[selectedProblem.initialFormation].slots}
                    side="home"
                    label={`우리 ${selectedProblem.initialFormation} 대형`}
                  />
                  <p className="kickoff-setup-hint">
                    {FORMATIONS[selectedProblem.initialFormation].hint}
                  </p>
                  <ul className="kickoff-setup-chips">
                    <li>
                      <small>라인</small>
                      <b>{LEVEL_LABEL.line[selectedProblem.initialTactics.line]}</b>
                    </li>
                    <li>
                      <small>압박</small>
                      <b>{LEVEL_LABEL.press[selectedProblem.initialTactics.press]}</b>
                    </li>
                    <li>
                      <small>폭</small>
                      <b>{LEVEL_LABEL.width[selectedProblem.initialTactics.width]}</b>
                    </li>
                  </ul>
                  <p className="kickoff-setup-state">
                    {11 - selectedProblem.unavailable.length}명 · 경고{' '}
                    {selectedProblem.booked.length}명 · 교체 {selectedProblem.subsLeft}장
                  </p>
                </div>
              </div>

              <div className="kickoff-score" aria-live="polite" aria-atomic="true">
                <small>
                  {halfLabel(selectedHalf)} {kickoffMinute(selectedHalf)}분 · 현재 스코어
                </small>
                <span>
                  <b data-leading={homeScore > awayScore ? 'true' : 'false'}>{homeScore}</b>
                  <i>:</i>
                  <b data-leading={awayScore > homeScore ? 'true' : 'false'}>{awayScore}</b>
                </span>
                <strong>{selectedProblem.title}</strong>
                <p>{selectedEntry.summary}</p>
              </div>

              <div className="kickoff-crest away">
                <b>{selectedOpponent.name}</b>
                <small>참고 순위 {selectedOpponent.rank}위 · 원정</small>
                <div className="kickoff-setup">
                  <h3>
                    즐겨 서는 대형
                    <em>{opponentSquad(opponent).formation}</em>
                  </h3>
                  <AwayShapeBoard
                    formation={opponentSquad(opponent).formation}
                    count={selectedProblem.awayCount}
                    opponent={opponent}
                  />
                  <p className="kickoff-setup-hint">{selectedOpponent.tag}</p>
                  <ul className="kickoff-setup-chips">
                    <li>
                      <small>평균 능력치</small>
                      <b>{opponentAbilityAverage(opponent).toFixed(1)}</b>
                    </li>
                    <li>
                      <small>우리 대비</small>
                      <b data-strong={opponentAbilityRatio(opponent) >= 1 ? 'on' : undefined}>
                        {opponentAbilityRatio(opponent).toFixed(2)}배
                      </b>
                    </li>
                  </ul>
                  <p className="kickoff-setup-state">
                    {selectedProblem.awayCount}명 · 참고 순위 {selectedOpponent.rank}위
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="kickoff-hud" aria-label="선택한 경기 정보">
            <span>
              <small>목표</small>
              <b data-away={selectedProblem.objective.type === 'EQUALIZE' ? 'true' : 'false'}>
                {goalLabel(selectedProblem)}
              </b>
            </span>
            <span>
              <small>진행 구간</small>
              <b>
                {kickoffMinute(selectedHalf)}′ → {segmentEnd(selectedHalf)}′
              </b>
            </span>
            <span>
              <small>교체 카드</small>
              <b>{selectedProblem.subsLeft}장</b>
            </span>
            <span>
              <small>물려받은 대형</small>
              <b>{selectedProblem.initialFormation}</b>
            </span>
          </section>

          <section
            id="situations"
            className="kickoff-situations"
            aria-labelledby="situations-title"
          >
            <div className="kickoff-section-head">
              <div className="kickoff-section-label">
                <i aria-hidden>2</i>
                <div>
                  <small>전술 사활</small>
                  <h2 id="situations-title">국면 선택</h2>
                </div>
              </div>
              <p>한 국면의 정답이 다른 국면에서는 오판이 됩니다.</p>
              <small>{opponentInfo(opponent).name} 상대 · 1,200시드 실측</small>
            </div>
            <div className="kickoff-situation-grid">
              {entries.map((entry, index) => (
                <SituationCard
                  key={entry.problem.id}
                  entry={entry}
                  n={index + 1}
                  selected={index === selectedIndex}
                  opponent={opponent}
                  onPick={() => setSelectedIndex(index)}
                />
              ))}
            </div>
          </section>

          <section
            id="start-point"
            className="kickoff-start"
            aria-labelledby="start-point-title"
          >
            <div className="kickoff-start-choice">
              <div className="kickoff-section-label">
                <i aria-hidden>3</i>
                <div>
                  <small>급수 타임</small>
                  <h2 id="start-point-title">시작 지점</h2>
                </div>
              </div>
              <HalfPicker value={selectedHalf} onPick={setSelectedHalf} />
            </div>
            <button
              type="button"
              className="kickoff-button-main"
              onClick={() => {
                setPicked({ entry: selectedEntry, half: selectedHalf })
                setAttempt((n) => n + 1)
              }}
            >
              <i aria-hidden />
              <b>KICK OFF</b>
              <small>
                {selectedProblem.title} · {halfLabel(selectedHalf)} · {SEGMENT_MINUTES}분을 실시간
                75초로
              </small>
            </button>
          </section>

          <p className="kickoff-time-note">
            {/*
              JSX 는 표현식 바로 앞뒤의 줄바꿈을 지운다. `뒤,` 다음에 그냥
              줄을 바꾸면 화면에 `뒤,70분에` 로 붙어 나오므로 띄어쓰기를
              명시한다. 문장 자체는 그대로다.
            */}
            {halfLabel(selectedHalf)} {breakStart(selectedHalf)}분 급수 타임에서 지시를 마친 뒤,{' '}
            {kickoffMinute(selectedHalf)}분에 재개해 {segmentEnd(selectedHalf)}분까지 진행합니다.
            추가시간은 +{addedTimeOf(selectedHalf)}분입니다.
          </p>
            </>
          )}
        </main>
      </div>

      <div className="kickoff-ticker" aria-hidden>
        <b>SAEHWAL FEED</b>
        <div>
          <span>{TICKER}</span>
          <span>{TICKER}</span>
        </div>
      </div>
      <p className="kickoff-footnote">
        상대 팀명·순위는 FIFA 랭킹을 참고했고, 국면과 가상 선수 능력치는
        창작했습니다.
      </p>
    </div>
  )
}
