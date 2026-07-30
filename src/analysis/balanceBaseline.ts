/**
 * 기준팀(미국)에서 1,200개 시드를 돌려 잰 무개입 통과율.
 *
 * 엔진의 확률 상수가 아니라 이미 끝난 균형 검사의 결과다. 홈 화면은
 * 이 값을 "아무것도 안 하면 얼마나 살아남는가"로 공개한다. 다른 상대를
 * 골라도 이 수치는 미국 기준이라는 사실을 함께 적어 오해를 막는다.
 */
const REFERENCE_NO_ACTION_RATE: Readonly<Record<string, number>> = {
  p01: 0.111,
  p02: 0.489,
  p03: 0.485,
  p04: 0.379,
  p05: 0.186,
}

export function referenceNoActionRate(problemId: string): number {
  const rate = REFERENCE_NO_ACTION_RATE[problemId]
  if (rate === undefined) {
    throw new Error(`무개입 통과율이 없는 국면: ${problemId}`)
  }
  return rate
}

