import { useMemo, useState } from 'react'
import raw from './data/problems.json' with { type: 'json' }
import { referenceNoActionRate } from './analysis/balanceBaseline'
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
import { createState } from './sim/engine'
import { OUR_TEAM } from './sim/constants'
import { HOME_SQUAD, rollRoster } from './sim/squad'
import { toProblem } from './sim/problems'
import type { OpponentId, Problem } from './sim/types'
import { MatchScreen } from './ui/MatchScreen'
import { TitleScreen, type HomeSection } from './ui/TitleScreen'
import { clearHistory, readHistory, type MatchRecord } from './ui/matchHistory'
import { SquadSection } from './ui/SquadSection'
import { HistorySection } from './ui/HistorySection'

/** 국면 카드와 프리뷰가 함께 쓰는 정보 */
interface Entry {
  problem: Problem
  summary: string
}

interface PickedMatch {
  entry: Entry
  half: Half
}

function goalLabel(problem: Problem): string {
  return problem.objective.type === 'SURVIVE' ? '리드 지키기' : '동점 이상'
}

function situationNote(problem: Problem): string {
  if (problem.awayCount < 11) return '상대 10명'
  if (problem.unavailable.length > 0) return '우리 10명'
  if (problem.booked.length > 0) return `경고 ${problem.booked.length}명`
  return '전원 정상'
}

function OpponentPicker({
  value,
  onPick,
}: {
  value: OpponentId
  onPick: (value: OpponentId) => void
}) {
  const selected = opponentInfo(value)

  return (
    <section id="opponents" className="kickoff-opponents" aria-labelledby="opponent-title">
      <div className="kickoff-section-label">
        <i aria-hidden>1</i>
        <div>
          <small>오늘의 상대</small>
          <h2 id="opponent-title">13개 팀 중 선택</h2>
        </div>
      </div>

      {teamsByTier().map(({ tier, teams }) => (
        <fieldset className="kickoff-team-tier" key={tier}>
          <legend>{TIER_LABEL[tier]}</legend>
          <div className="kickoff-team-grid">
            {teams.map((team) => {
              const active = value === team.id
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
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}

      <div className="kickoff-opponent-note" aria-live="polite">
        <span>
          <b>{selected.name}</b>
          <i>참고 순위 {selected.rank}위</i>
        </span>
        <p>{selected.note}</p>
        {/*
          평균 능력치는 세기 계수에서 유도한다. 따로 적어두면 계수를 손볼
          때마다 화면과 실제가 갈린다.
        */}
        <em className="kickoff-opponent-ability">
          평균 능력치 <b>{opponentAbilityAverage(value).toFixed(1)}</b>
          <i>
            우리 {OUR_ABILITY_AVERAGE.toFixed(1)} · {opponentAbilityRatio(value).toFixed(2)}배
          </i>
        </em>
      </div>
    </section>
  )
}

function SituationCard({
  entry,
  n,
  selected,
  onPick,
}: {
  entry: Entry
  n: number
  selected: boolean
  onPick: () => void
}) {
  const { problem } = entry
  const noActionRate = referenceNoActionRate(problem.id)
  const survive = problem.objective.type === 'SURVIVE'

  return (
    <button
      type="button"
      className="kickoff-situation"
      aria-pressed={selected}
      data-selected={selected ? 'true' : 'false'}
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
      <span className="kickoff-survival">
        <small>미국 기준 · 아무것도 안 하면</small>
        <b>{(noActionRate * 100).toFixed(1)}%</b>
        <em>만 버팁니다</em>
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
  const previewProblem = useMemo(
    () => ({
      ...selectedEntry.problem,
      seed: selectedEntry.problem.seed + (attempt + 1) * 7919,
    }),
    [attempt, selectedEntry],
  )
  const previewState = useMemo(
    () => createState(previewProblem, opponent, starters ?? undefined, roster),
    [opponent, previewProblem, roster, starters],
  )
  if (picked) {
    const problem = {
      ...picked.entry.problem,
      seed: picked.entry.problem.seed + attempt * 7919,
    }
    return (
      <MatchScreen
        key={`${picked.entry.problem.id}#${picked.half}#${attempt}#${replay}#${opponent}`}
        problem={problem}
        startHalf={picked.half}
        opponent={opponent}
        starters={starters ?? undefined}
        roster={roster}
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
          setSection('situation')
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
                  starters: new Set(
                    previewState.players.filter((p) => p.onPitch && !p.out).map((p) => p.id),
                  ),
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
            <HistorySection records={history} onClear={() => setHistory(clearHistory())} />
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
              <div className="kickoff-crest home">
                <b>{OUR_TEAM.name}</b>
                <small>참고 순위 {OUR_TEAM.rank}위 · 홈</small>
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
              <small>미국 기준 · 1,200시드 실측</small>
            </div>
            <div className="kickoff-situation-grid">
              {entries.map((entry, index) => (
                <SituationCard
                  key={entry.problem.id}
                  entry={entry}
                  n={index + 1}
                  selected={index === selectedIndex}
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
