/** 150판 비교가 무엇을 고정하고 무엇을 바꾸는지 한 문장으로 설명한다. */
export function variantComparisonTitle(runs: number): string {
  return `같은 국면의 변형 ${runs}판 비교`
}

export const VARIANT_COMPARISON_NOTE =
  '판마다 선수 상태·체력·경고·난수는 달라지고, 각 변형 안에서는 무개입·나의 판단·권장 전술을 같은 조건으로 맞춰 비교합니다.'
