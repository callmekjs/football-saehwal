/**
 * 결정론 난수.
 *
 * 경기 분석 화면은 같은 경기를 두 번 돌려 나란히 재생하므로, 시드에서
 * 수열이 완전히 결정되어야 한다. Math.random 은 이 파일 어디에서도
 * 쓰지 않는다.
 */

export interface Rng {
  next(): number
}

/** 연출용 스트림을 경기용에서 떼어내기 위한 상수 (황금비 기반) */
const VISUAL_OFFSET = 0x9e3779b9

/** mulberry32 — 32비트 상태, 주기 2^32, 분포가 고르고 빠르다 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/**
 * 경기 판정용과 연출용 스트림을 분리한다.
 *
 * 하나만 쓰면 연출(하이라이트 흔들림, 파티클 등)을 고칠 때마다 난수
 * 소비가 밀려 경기 결과 전체가 바뀐다. 증상이 눈에 안 띄어서 마감
 * 직전에 발견되는 종류의 고장이다.
 */
export function createStreams(seed: number): { match: Rng; visual: Rng } {
  return {
    match: createRng(seed),
    visual: createRng((seed ^ VISUAL_OFFSET) >>> 0),
  }
}
