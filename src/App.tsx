import { useEffect, useMemo, useState } from 'react'
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
import { toProblem } from './sim/problems'
import { getPlayer } from './sim/squad'
import type { OpponentId, Problem } from './sim/types'
import { MatchScreen } from './ui/MatchScreen'

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

function staminaTone(stamina: number): 'safe' | 'warn' | 'danger' {
  if (stamina < 45) return 'danger'
  if (stamina < 60) return 'warn'
  return 'safe'
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

/** 왼쪽 차례 안내가 가리키는 자리들 */
const NAV_STEPS = [
  { id: 'match-preview', n: '01', label: '킥오프' },
  { id: 'opponents', n: '02', label: '상대 선택' },
  { id: 'situations', n: '03', label: '국면 선택' },
  { id: 'start-point', n: '04', label: '시작 지점' },
] as const

/**
 * 킥오프 준비 차례.
 *
 * **전에는 눌러도 아무 일이 없었다.** 그냥 `href="#id"` 였는데, 넓고 높은
 * 화면에서는 내용이 한 화면에 다 들어가 스크롤할 곳이 없다. 1600×1000 에서
 * 문서 높이가 정확히 1000px 이라 브라우저가 옮길 자리가 없었다. 1280×720
 * 처럼 스크롤이 생기는 크기에서만 동작했다.
 *
 * 활성 표시도 `01` 에 고정으로 박혀 있어 어디를 보고 있든 늘 켜져 있었다.
 *
 * 그래서 두 가지를 고친다. 스크롤이 가능하면 부드럽게 옮기고, **옮길 자리가
 * 없어도 그 자리를 잠깐 밝혀** 클릭이 언제나 눈에 보이게 한다. 지금 보고
 * 있는 자리는 화면에 실제로 들어온 것을 보고 정한다.
 */
function KickoffNav() {
  const [active, setActive] = useState<string>(NAV_STEPS[0].id)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    const sections = NAV_STEPS.map((step) => document.getElementById(step.id)).filter(
      (el): el is HTMLElement => el !== null,
    )
    if (sections.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (seen) setActive(seen.target.id)
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0.1, 0.5, 1] },
    )
    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (flash === null) return
    const timer = window.setTimeout(() => setFlash(null), 1100)
    return () => window.clearTimeout(timer)
  }, [flash])

  const go = (id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    setActive(id)
    // 옮길 자리가 없어도 누른 것이 보여야 한다
    setFlash(id)
  }

  return (
    <nav className="kickoff-nav" aria-label="킥오프 준비 순서">
      <small>MANAGER</small>
      {NAV_STEPS.map((step) => (
        <a
          key={step.id}
          href={`#${step.id}`}
          className={active === step.id ? 'active' : undefined}
          aria-current={active === step.id ? 'true' : undefined}
          onClick={(event) => {
            event.preventDefault()
            go(step.id)
          }}
        >
          <b>{step.n}</b>
          {step.label}
        </a>
      ))}
      <span className="kickoff-nav-muted">
        <b>05</b>
        종료 뒤 분석
      </span>

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
      <FlashStyle id={flash} />
    </nav>
  )
}

/** 누른 자리를 잠깐 밝힌다. 스크롤이 없어도 클릭이 보이게 하는 장치다 */
function FlashStyle({ id }: { id: string | null }) {
  useEffect(() => {
    if (id === null) return
    const target = document.getElementById(id)
    if (!target) return
    target.dataset.flash = 'on'
    return () => {
      delete target.dataset.flash
    }
  }, [id])
  return null
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
    () => createState(previewProblem, opponent),
    [opponent, previewProblem],
  )
  const condition = useMemo(
    () =>
      previewState.players
        .filter((state) => state.onPitch && !state.out)
        .map((state) => ({ state, player: getPlayer(state.id) }))
        .sort((a, b) => a.state.stamina - b.state.stamina)
        .slice(0, 6),
    [previewState],
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
        onExit={() => setPicked(null)}
        onRetry={() => setAttempt((n) => n + 1)}
        onReplay={() => setReplay((n) => n + 1)}
      />
    )
  }

  const selectedProblem = selectedEntry.problem
  const selectedOpponent = opponentInfo(opponent)
  const [homeScore, awayScore] = selectedProblem.score

  return (
    <div className="kickoff-home">
      <header className="kickoff-header">
        <h1 className="kickoff-wordmark">축구 사활</h1>
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

      <div className="kickoff-layout">
        <KickoffNav />

        <aside className="kickoff-sidebar">
          <OpponentPicker value={opponent} onPick={setOpponent} />

          <section className="kickoff-condition" aria-labelledby="condition-title">
            <div className="kickoff-side-title">
              <h2 id="condition-title">선수 컨디션</h2>
              <small>다음 판 · 낮은 체력순</small>
            </div>
            <div className="kickoff-condition-list">
              {condition.map(({ state, player }) => (
                <span key={player.id} data-tone={staminaTone(state.stamina)}>
                  <b>{player.num}</b>
                  <small>{player.pos}</small>
                  <progress
                    max="100"
                    value={state.stamina}
                    aria-label={`${player.num}번 체력 ${Math.round(state.stamina)}`}
                  />
                  <strong>{Math.round(state.stamina)}</strong>
                </span>
              ))}
            </div>
          </section>

          <section className="kickoff-house-rules">
            <small>HOUSE RULES</small>
            <p>
              시계는 멈추지 않습니다. 교체 카드는 되돌릴 수 없습니다. 좋은 판단도
              결과가 나쁠 수 있습니다.
            </p>
          </section>
        </aside>

        <main className="kickoff-main">
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
                <b>우리</b>
                <small>홈</small>
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
