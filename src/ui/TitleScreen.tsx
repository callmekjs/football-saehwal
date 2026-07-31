/**
 * 첫 화면.
 *
 * 사용자가 정했다 — *"이런 류의 메인페이지가 있어야 해. 우리는 바로 게임
 * 시작이잖아."* 전에는 열자마자 상대와 국면을 고르라고 했다.
 *
 * **오른쪽 카드는 지어낸 예시가 아니다.** 곧 시작할 그 판의 실제 스코어와
 * 목표와 교체 카드 수를 읽는다. 첫 화면이 보여준 상황과 눌러서 들어간
 * 상황이 다르면 그 화면은 소개가 아니라 광고지다.
 *
 * **사진과 로고는 쓰지 않는다.** 이 저장소는 선수 사진·엠블럼·유니폼
 * 이미지를 하나도 두지 않기로 했고, 그건 저작권만의 문제가 아니라 실존
 * 인물을 이 시뮬레이션에 끌어들이지 않겠다는 결정이다. 배경은 전부 CSS 로
 * 그린 야간 경기장이며 외부 파일을 한 개도 부르지 않는다.
 */

export type HomeSection = 'squad' | 'opponent' | 'situation' | 'history'

/** 첫 화면 오른쪽 카드가 읽는 값. 전부 실제 국면에서 온다 */
export interface TitlePreview {
  homeName: string
  awayName: string
  score: readonly [number, number]
  /** 재개하는 분. 후반이면 70 */
  kickoffMinute: number
  /** 그 반이 끝나는 분. 후반이면 92 */
  endMinute: number
  /** 정규 시간이 끝나는 분. 후반이면 90 */
  regulationMinute: number
  halfLabel: string
  problemTitle: string
  problemSummary: string
  goal: string
  subsLeft: number
  bookedCount: number
}

export interface TitleScreenProps {
  onStart: () => void
  onGo: (section: HomeSection) => void
  historyCount: number
  preview: TitlePreview
}

/** 한 판이 흘러가는 세 걸음 */
const STEPS = [
  {
    n: '01',
    title: '상황을 받는다',
    body: '스코어·남은 시간·교체 카드·경고까지 정해진 채로 시작합니다. 처음부터 쌓아 올리는 경기가 아니라, 이미 기울어진 판을 받습니다.',
  },
  {
    n: '02',
    title: '75초 안에 개입한다',
    body: '시계는 멈추지 않습니다. 고민하는 동안에도 상대는 공격하고 체력은 떨어집니다. 전술을 바꾸고 교체 카드를 쓰되, 되돌릴 수는 없습니다.',
  },
  {
    n: '03',
    title: '결과와 판단을 따로 받는다',
    body: '축구는 확률 게임입니다. 옳게 판단하고도 무너질 수 있어서, 승패와 감독 평점을 따로 매깁니다. 무너졌지만 명장이 성립합니다.',
  },
] as const

export function TitleScreen({ onStart, onGo, historyCount, preview }: TitleScreenProps) {
  const added = preview.endMinute - preview.regulationMinute
  // 재개하는 분이 그 반의 어디쯤인지. 진행 막대가 이 값을 쓴다
  const elapsed = ((preview.kickoffMinute - (preview.regulationMinute - 45)) / 45) * 100

  return (
    <div className="title-screen">
      {/* 야간 경기장. 전부 CSS 도형이라 부르는 파일이 없다 */}
      <div className="title-stage" aria-hidden>
        <i className="title-sky" />
        <i className="title-glow left" />
        <i className="title-glow right" />
        <div className="title-pitch">
          <i className="line halfway" />
          <i className="circle" />
          <i className="box near" />
          <i className="box far" />
        </div>
        <i className="title-vignette" />
      </div>

      <header className="title-top">
        <div className="title-brand">
          <b>신의 한 수</b>
          <i aria-hidden>:</i>
          <span>축구 사활</span>
        </div>
        <p className="title-mode">
          <i aria-hidden />
          축구 사활문제 · 감독 모드
        </p>
        <p className="title-facts">한 판 75초 · 국면 5종 · 상대 13팀</p>
      </header>

      <main className="title-body">
        <section className="title-lead">
          <p className="title-kicker">
            {preview.halfLabel} {preview.kickoffMinute}분 · {preview.score[0]}-
            {preview.score[1]} · {preview.goal}
          </p>
          <h1 className="title-headline">
            한 장면에서
            <b>승부가 갈린다</b>
          </h1>
          <p className="title-tagline">
            바둑에 사활문제가 있다면, 축구에는 국면이 있습니다. 이미 벌어진 상황
            하나를 받아 들고, 흐르는 경기 안에서 그것을 타파하는 시뮬레이션입니다.
          </p>

          <div className="title-actions">
            <button type="button" className="title-play" onClick={onStart}>
              <b>PLAY</b>
              <small>선수단을 보고 국면을 고른 뒤 시작합니다</small>
            </button>
            <p className="title-fineprint">
              설치 없이 브라우저에서 바로
              <span>실존 구단·선수를 쓰지 않습니다</span>
            </p>
          </div>

          <button type="button" className="title-history" onClick={() => onGo('history')}>
            지난 기록
            <i>
              {historyCount > 0 ? `${historyCount}판의 결과와 판단` : '아직 기록이 없습니다'}
            </i>
          </button>
        </section>

        {/* 곧 시작할 그 판의 실제 값. 예시가 아니다 */}
        <aside className="title-card" aria-label="곧 시작할 국면">
          <header>
            <span>주어지는 국면</span>
            <em>
              <i aria-hidden />
              여기서 시작합니다
            </em>
          </header>

          <div className="title-card-score">
            <span className="crest home">{preview.homeName}</span>
            <b>{preview.score[0]}</b>
            <i>:</i>
            <b>{preview.score[1]}</b>
            <span className="crest away">{preview.awayName}</span>
          </div>
          <p className="title-card-sides">
            <span>홈</span>
            <span>원정</span>
          </p>

          <div className="title-card-clock">
            <strong>{preview.kickoffMinute}:00</strong>
            <i aria-hidden>
              <u style={{ width: `${Math.max(4, Math.min(96, elapsed))}%` }} />
            </i>
            <small>
              {preview.regulationMinute}′ +{added}
            </small>
          </div>

          <dl className="title-card-facts">
            <div>
              <dt>상황</dt>
              <dd>{preview.problemTitle}</dd>
              <p>{preview.problemSummary}</p>
            </div>
            <div>
              <dt>목표</dt>
              <dd data-goal="on">{preview.goal}</dd>
              <p>
                교체 카드 {preview.subsLeft}장 ·{' '}
                {preview.bookedCount > 0 ? `경고 ${preview.bookedCount}명` : '경고 없음'}
              </p>
            </div>
          </dl>
        </aside>
      </main>

      <section className="title-steps" aria-label="한 판의 흐름">
        {STEPS.map((step) => (
          <article key={step.n}>
            <h2>
              <b>{step.n}</b>
              {step.title}
            </h2>
            <p>{step.body}</p>
          </article>
        ))}
      </section>
    </div>
  )
}
