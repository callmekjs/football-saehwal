/**
 * 첫 화면.
 *
 * 사용자가 정했다 — *"이런 류의 메인페이지가 있어야 해. 우리는 바로 게임
 * 시작이잖아."* 전에는 열자마자 상대와 국면을 고르라고 했다. 무엇을 하는
 * 것인지 알기 전에 선택을 요구하는 화면이었다.
 *
 * **사진과 로고는 쓰지 않는다.** 이 저장소는 선수 사진·엠블럼·유니폼
 * 이미지를 하나도 두지 않기로 했고, 그건 저작권만의 문제가 아니라 실존
 * 인물을 이 시뮬레이션에 끌어들이지 않겠다는 결정이다. 배경은 전부 CSS 로
 * 그린 야간 경기장이며 외부 파일을 한 개도 부르지 않는다.
 */

export type HomeSection = 'squad' | 'opponent' | 'situation' | 'history'

export interface TitleScreenProps {
  onStart: () => void
  onGo: (section: HomeSection) => void
  historyCount: number
}

export function TitleScreen({ onStart, onGo, historyCount }: TitleScreenProps) {
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

      {/*
        오른쪽에 그리는 축구 그림.
        사용자가 정했다 — *"공간들이 많이 남아 있으니 축구 관련된 그림 같은
        거 넣어줘."*

        **사진이 아니라 이 게임의 장면이다.** 골문 앞에 다섯 명이 벽을 세우고
        공격수 셋이 파고드는, 이 시뮬레이션이 실제로 다루는 국면 하나를
        도형으로 그렸다. 전부 CSS 이고 부르는 파일이 없다.
      */}
      <div className="title-art" aria-hidden>
        <div className="title-art-goal">
          <i className="post left" />
          <i className="post right" />
          <i className="bar" />
          <i className="net" />
        </div>
        <div className="title-art-box" />
        <div className="title-art-arc" />

        {/* 물러서서 벽을 세운 수비 다섯 */}
        {[18, 32, 46, 60, 74].map((left) => (
          <i key={`d${left}`} className="title-art-dot theirs" style={{ left: `${left}%` }} />
        ))}
        {/* 파고드는 공격 셋 */}
        <i className="title-art-dot ours" style={{ left: '26%', top: '62%' }} />
        <i className="title-art-dot ours" style={{ left: '50%', top: '70%' }} />
        <i className="title-art-dot ours" style={{ left: '70%', top: '60%' }} />

        {/* 공과 그 공이 갈 길 */}
        <i className="title-art-ball" />
        <svg className="title-art-run" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M50 70 C 50 52, 40 44, 30 36" />
          <path d="M50 70 C 56 50, 66 42, 74 34" />
        </svg>
      </div>

      <div className="title-panel">
        <header>
          <p className="title-kicker">축구 전술 사활</p>
          <h1 className="title-wordmark">축구 사활</h1>
          <p className="title-tagline">
            바둑의 사활문제를 축구로 옮겼습니다. 무너지기 직전의 한 국면을 받아
            <b>실시간 75초</b> 안에 타파합니다.
          </p>
        </header>

        <nav className="title-menu" aria-label="시작 메뉴">
          <button type="button" className="title-main" onClick={onStart}>
            <span>
              <b>바로 시작</b>
              <small>국면을 고르고 곧바로 킥오프</small>
            </span>
            <i aria-hidden>▶</i>
          </button>

          {/*
            메뉴는 둘뿐이다. 사용자가 정했다 — *"첫 화면은 바로 시작과 지난
            기록만 넣어줘."* 우리 팀과 상대 보기는 시작한 뒤 왼쪽 차례
            안내에서 언제든 갈 수 있으므로 여기서 한 번 더 물을 이유가 없다.
          */}
          <button type="button" onClick={() => onGo('history')}>
            <b>지난 기록</b>
            <small>
              {historyCount > 0 ? `${historyCount}판의 결과와 판단` : '아직 기록이 없습니다'}
            </small>
          </button>
        </nav>

        <dl className="title-facts">
          <div>
            <dt>국면</dt>
            <dd>5</dd>
          </div>
          <div>
            <dt>상대</dt>
            <dd>13</dd>
          </div>
          <div>
            <dt>한 판</dt>
            <dd>75초</dd>
          </div>
        </dl>

        <p className="title-note">
          시계는 멈추지 않고 교체 카드는 되돌릴 수 없습니다. 선수와 국면은 전부
          창작이며 실존 인물의 이름을 쓰지 않습니다.
        </p>
      </div>
    </div>
  )
}
