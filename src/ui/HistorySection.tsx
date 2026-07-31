/**
 * 04 · 분석과 기록.
 *
 * 사용자가 정했다 — *"04 분석 및 히스토리"*, 그리고 기록은 **브라우저에
 * 저장**한다.
 *
 * 여기서는 지어내지 않는다. `matchHistory` 에 실제로 남은 판만 보여주고,
 * 기록이 없으면 없다고 말한다. 한 경기 결과와 150판 판단 평가는 종료
 * 화면(`AnalysisPanel`)이 이미 자세히 하므로 여기서는 **쌓인 흐름**만 본다.
 */
import { historySummary, timeAgo, type MatchRecord } from './matchHistory'

function deltaText(delta: number | null): string {
  if (delta === null) return '—'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${(delta * 100).toFixed(1)}%p`
}

export function HistorySection({
  records,
  now,
  onClear,
}: {
  records: readonly MatchRecord[]
  now?: number
  onClear?: () => void
}) {
  const { played, passed, rate } = historySummary(records)
  // 시각은 화면에서만 쓰는 값이라 엔진과 무관하다
  const at = now ?? Date.now()

  return (
    <section id="history" className="history-section" aria-labelledby="history-title">
      <div className="kickoff-section-head">
        <div className="kickoff-section-label">
          <i aria-hidden>04</i>
          <div>
            <small>분석 · 기록</small>
            <h2 id="history-title">지난 판</h2>
          </div>
        </div>
        <p>같은 국면을 여러 번 해볼수록 판단이 결과를 어떻게 바꾸는지 드러납니다.</p>
      </div>

      {played === 0 ? (
        <div className="history-empty">
          <strong>아직 기록이 없습니다</strong>
          <p>
            한 판을 끝내면 여기에 결과와 그때의 판단이 남습니다. 기록은 이
            브라우저에만 저장되며 어디로도 보내지 않습니다.
          </p>
        </div>
      ) : (
        <>
          <dl className="history-summary">
            <div>
              <dt>치른 판</dt>
              <dd>{played}</dd>
            </div>
            <div>
              <dt>타파 성공</dt>
              <dd data-tone={passed > 0 ? 'safe' : undefined}>{passed}</dd>
            </div>
            <div>
              <dt>성공률</dt>
              <dd>{(rate * 100).toFixed(0)}%</dd>
            </div>
          </dl>

          <ul className="history-list">
            {records.map((record) => (
              <li key={`${record.at}-${record.problemId}`} data-passed={record.passed ? 'on' : 'off'}>
                <span className="history-when">{timeAgo(record.at, at)}</span>
                <span className="history-what">
                  <b>{record.problemTitle}</b>
                  <small>
                    {record.opponentName} · {record.half === 1 ? '전반' : '후반'}
                  </small>
                </span>
                <span className="history-score">
                  {record.score[0]}
                  <i>:</i>
                  {record.score[1]}
                </span>
                <span className="history-result" data-passed={record.passed ? 'on' : 'off'}>
                  {record.passed ? '타파' : '실패'}
                </span>
                <span className="history-decisions">판단 {record.decisions}회</span>
                <span className="history-delta" data-sign={(record.delta ?? 0) >= 0 ? 'up' : 'down'}>
                  {deltaText(record.delta)}
                </span>
              </li>
            ))}
          </ul>

          {onClear && (
            <button type="button" className="chip history-clear" onClick={onClear}>
              기록 지우기
            </button>
          )}
        </>
      )}

      <p className="history-note">
        `판단 n회`는 그 경기에서 내린 결정 수이고, `±%p`는 같은 150판에서 아무
        개입도 하지 않았을 때와의 성공 가능성 차이입니다. 한 수 하나의 효과가
        아니라 그 경기 판단 전체의 값입니다.
      </p>
    </section>
  )
}
