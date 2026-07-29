import { useMemo, useState } from 'react'
import raw from './data/problems.json' with { type: 'json' }
import { toProblem } from './sim/problems'
import { Backdrop } from './ui/Backdrop'
import { MatchScreen } from './ui/MatchScreen'
import { addedTimeOf, breakStart, halfLabel, segmentEnd, type Half } from './matchClock'
import type { Problem } from './sim/types'

/** 국면 카드에 띄울 정보. 국면 데이터에서 파생한다 */
interface Entry {
  problem: Problem
  summary: string
}

/**
 * 반을 고르는 버튼 하나.
 *
 * **모든 국면이 전반판과 후반판을 함께 갖는다.** 사용자가 정했다 —
 * *"전후반전 그건 플레이어가 고를 수 있어."* 같은 상황을 전반 급수
 * 타임에서 만나느냐 후반에서 만나느냐가 다른 경기다. 전반이면 아직
 * 45분이 남아 있고, 후반이면 그것으로 끝이다.
 */
function HalfButton({ half, onPick }: { half: Half; onPick: () => void }) {
  return (
    <button
      className={`fx-half ${half === 1 ? 'first' : 'second'}`}
      onClick={onPick}
      title={`${breakStart(half)}분 급수 타임부터 ${segmentEnd(half)}분까지 진행됩니다`}
    >
      <b>{halfLabel(half)}</b>
      <small>
        {breakStart(half)}분 급수 · +{addedTimeOf(half)}
      </small>
    </button>
  )
}

function FixtureCard({
  entry,
  n,
  onPick,
}: {
  entry: Entry
  n: number
  onPick: (half: Half) => void
}) {
  const { problem, summary } = entry
  const survive = problem.objective.type === 'SURVIVE'
  return (
    <div className="fixture">
      <span className="fx-band">
        <b>제{n}국면</b>
        <span>전반 또는 후반 선택</span>
      </span>
      <span className="fx-main">
        <span className="fx-score">
          {problem.score[0]}
          <em>–</em>
          {problem.score[1]}
        </span>
        <strong className="fx-title">{problem.title}</strong>
        <span className="fx-sum">{summary}</span>
      </span>
      <span className="fx-chips">
        <span className="tagchip">{survive ? '리드 지키기' : '동점 이상'}</span>
        <span className="tagchip dim">교체 카드 {problem.subsLeft}장</span>
        {problem.awayCount < 11 && <span className="tagchip warn">상대 10명</span>}
        {problem.unavailable.length > 0 && <span className="tagchip warn">우리 10명</span>}
        {problem.booked.length > 0 && <span className="tagchip warn">경고 있음</span>}
      </span>
      <span className="fx-halves">
        <HalfButton half={1} onPick={() => onPick(1)} />
        <HalfButton half={2} onPick={() => onPick(2)} />
      </span>
    </div>
  )
}

const TICKER =
  '시계는 끝까지 흐른다 — 일시정지 없음　　교체 카드는 되돌릴 수 없다　　' +
  '좋은 판단도 결과가 나쁠 수 있다　　판마다 답이 다르다 — 만능 전술은 없다　　' +
  '모든 국면·선수·수치는 창작이다　　'

export function App() {
  const entries = useMemo<Entry[]>(
    () =>
      raw
        .map(toProblem)
        .sort((a, b) => a.order - b.order)
        // 시작 분과 한 줄 요약은 국면 데이터에서 온다. 화면에 국면 id 별
        // 표를 두면 국면을 하나 넣을 때마다 이 파일을 고쳐야 한다
        .map((problem) => ({
          problem,
          summary: problem.summary ?? '',
        })),
    [],
  )

  /** 고른 국면과 고른 반. 둘이 함께 한 판을 정한다 */
  const [picked, setPicked] = useState<{ entry: Entry; half: Half } | null>(null)
  /**
   * 몇 번째 도전인가.
   *
   * 시작 조건(체력·경고·앞 감독이 걸어둔 지시와 전술)은 국면 시드에서
   * 뽑는다. 시드를 고정해두면 같은 국면을 몇 번을 해도 **완전히 같은
   * 판**이 나와, 한 번 푼 뒤로는 같은 답을 다시 입력하는 것이 된다.
   * 도전할 때마다 시드를 옮겨 새 판을 받는다.
   *
   * 옮기는 폭이 큰 소수인 이유: 시드를 1씩 더하면 이웃한 판끼리 난수가
   * 비슷해 보일 수 있다. 멀리 떨어뜨리면 그럴 일이 없다.
   */
  const [attempt, setAttempt] = useState(0)

  if (picked) {
    const problem = { ...picked.entry.problem, seed: picked.entry.problem.seed + attempt * 7919 }
    return (
      <MatchScreen
        key={`${picked.entry.problem.id}#${picked.half}#${attempt}`}
        problem={problem}
        startHalf={picked.half}
        onExit={() => setPicked(null)}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    )
  }

  return (
    <div className="home">
      <header className="topbar">
        <span className="wordmark">축구 사활</span>
        <span className="topchip">감독 모드 · 월간 해커톤</span>
      </header>

      <section className="hero">
        <div className="hero-pitch">
          <Backdrop problem={entries[0].problem} />
        </div>
        <div className="hero-shade" aria-hidden />
        <div className="hero-scan" aria-hidden />
        <div className="hero-inner">
          <span className="live">
            <i aria-hidden />
            라이브 — 지금도 경기가 흐르고 있다
          </span>
          <h1 className="hero-title">
            신의 한 수:
            <br />
            <em>축구 사활</em>
          </h1>
          <p className="hero-sub">
            22분짜리 경기가 75초 동안 펼쳐집니다.
            <br />
            시계는 멈추지 않습니다. 내린 결정은 되돌릴 수 없습니다.
          </p>
          <div className="hero-cta">
            <button
              className="cta"
              onClick={() => {
                // 바로 킥오프는 후반이다. 시간이 없어야 첫 판이 절박하다
                setPicked({ entry: entries[0], half: 2 })
                setAttempt((n) => n + 1)
              }}
            >
              바로 킥오프{' '}
              <small>제1국면 · 후반</small>
            </button>
            <a className="cta ghost" href="#fixtures">
              국면 고르기
            </a>
          </div>
        </div>
      </section>

      <section id="fixtures" className="board">
        <div className="board-head">
          <h2>국면 선택</h2>
          <span>
            같은 전술이 모든 판을 풀어주지 않습니다 · <b>전반 또는 후반을 선택하세요</b>
          </span>
        </div>
        <div className="fixtures">
          {entries.map((e, i) => (
            <FixtureCard
              key={e.problem.id}
              entry={e}
              n={i + 1}
              onPick={(half) => {
                setPicked({ entry: e, half })
                // 들어갈 때마다 새 판이다. 나갔다 다시 들어와서 똑같은
                // 경기가 나오면 흔들어둔 의미가 없다
                setAttempt((n) => n + 1)
              }}
            />
          ))}
        </div>
      </section>

      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          <span>{TICKER}</span>
          <span>{TICKER}</span>
        </div>
      </div>

      <p className="foot">
        등장하는 국면·선수·수치는 전부 창작이며 실제 경기·실존 인물과 무관합니다.
      </p>
    </div>
  )
}
