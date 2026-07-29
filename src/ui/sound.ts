/**
 * 경기 소리 — 휘슬은 CC0 녹음, 나머지는 브라우저가 합성한다.
 *
 * 사용자가 정했다 — *"경기 시작, 부상, 아웃, 반칙 선언, 프리킥 선언,
 * 패널티킥 선언 할때 휘슬 넣어. 골 넣거나 먹히면 환호 소리와 득점, 실점
 * 글자 나오게 하고. 경기 끝나면 휘슬 두번."*
 *
 * ★ **출처가 확실한 것만 쓴다.** 대회 규칙에 "타인의 결과물을 무단
 * 복제하거나 라이선스를 위반하면 실격 또는 감점"이 있다. 유튜브에서
 * 받아 쓰는 것은 그쪽 약관 위반이라 아예 후보가 아니다. 여기 있는
 * 휘슬은 **CC0**(저작권을 전 세계적으로 포기한 공유 재산)이고, 함성은
 * 파형을 직접 합성해 만든다 — 둘 다 남의 권리를 건드리지 않는다.
 *
 * ★ **소리를 꺼도 아무 기능을 잃지 않는다.** 심사자 상당수가 소리를 끄고
 * 본다. 휘슬이 울리는 모든 사건은 화면에도 이미 표시된다 — 주심이 그
 * 자리로 달려가고, 카드를 들고, 깃발이 오르고, 문구가 뜬다. 소리는
 * **덤**이다. 음성 지시를 덤으로 만든 것과 같은 원칙이다.
 *
 * ★ **휘슬만 진짜 녹음을 쓴다.** `public/sound/whistle.wav` 는 위키미디어
 * 공용의 **CC0**(저작권 전면 포기) 음원이라 출처 표기 의무조차 없다.
 * 합성 휘슬은 아무리 다듬어도 "분 소리"가 안 나서 전자음으로 들렸다.
 * 출처와 라이선스는 `docs/credits.md` 에 적어뒀다 — 심사 때 물어보면
 * 그 파일을 보여주면 된다.
 *
 * 파일을 못 읽으면 **합성으로 돌아간다.** 배포가 잘못되거나 네트워크가
 * 끊겨도 소리가 아예 없어지지는 않는다.
 *
 * ★ **브라우저는 사용자가 뭔가 누르기 전에는 소리를 막는다.** 그래서
 * `AudioContext` 를 미리 만들지 않고 **첫 소리가 필요한 순간에** 만든다.
 * 우리 흐름에서 첫 소리는 킥오프 휘슬이고, 그건 사용자가 "경기 재개"를
 * 누른 뒤다. 자동 재개로 시작되면 소리가 안 날 수 있는데, 그건 조용히
 * 넘어간다 — 소리 때문에 경기가 멈추면 안 된다.
 */

let ctx: AudioContext | null = null
let muted = false

/** 소리 저장 키. 껐다는 사실은 다음에 열어도 남아야 한다 */
const MUTE_KEY = 'saehwal.muted'

if (typeof localStorage !== 'undefined') {
  muted = localStorage.getItem(MUTE_KEY) === '1'
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(next: boolean): void {
  muted = next
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  }
}

/**
 * 오디오를 쓸 수 있으면 컨텍스트를 준다.
 *
 * 없거나 막혀 있으면 `null` 이다. **부르는 쪽은 반드시 null 을 견뎌야
 * 한다** — 소리가 안 나는 것은 결함이 아니라 정상 경로 중 하나다.
 */
function audio(): AudioContext | null {
  if (muted) return null
  if (ctx) {
    // 탭을 벗어났다 오면 멈춰 있을 수 있다
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    return ctx
  } catch {
    return null
  }
}

/**
 * 녹음된 휘슬에서 실제로 소리가 나는 구간(초).
 *
 * 받은 파일은 3.33초인데 재보니 **0.12~0.70초에만 소리가 있고** 나머지
 * 2.6초는 체육관의 빈 여운이다. 통째로 틀면 다음 사건이 그 여운에
 * 묻힌다. 파일을 자를 도구가 이 환경에 없어서 **재생할 때 구간을
 * 지정**한다 — 결과는 같고 파일은 원본 그대로 남는다.
 */
const CLIP = { at: 0.1, len: 0.62 }

/** 휘슬 녹음. 못 읽으면 null 이고 그때는 합성으로 분다 */
let sample: AudioBuffer | null = null
let loading = false

/**
 * 휘슬 파일을 한 번만 읽어 온다.
 *
 * 실패해도 조용히 넘어간다 — 소리 때문에 경기가 멈추면 안 된다.
 * `BASE_URL` 을 쓰는 이유: 배포가 하위 경로에 올라가도 경로가 맞아야 한다.
 */
function loadSample(ac: AudioContext): void {
  if (sample || loading) return
  loading = true
  const url = `${import.meta.env.BASE_URL}sound/whistle.wav`
  fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buf) => ac.decodeAudioData(buf))
    .then((decoded) => {
      sample = decoded
    })
    .catch(() => {
      // 합성으로 계속 간다
    })
}

/** 잡음 한 조각. 합성 휘슬의 바람 소리와 함성의 재료다 */
function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(ac.sampleRate * seconds))
  const buf = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/**
 * 주심 휘슬 한 번.
 *
 * 실제 심판 휘슬은 3~4kHz 근처의 두 음이 겹치고, 안에 든 콩이 굴러서
 * 빠르게 떨린다. 그 떨림이 없으면 그냥 삐 소리라 전자음으로 들린다.
 * 그래서 진동수를 흔드는 저주파 발진기를 하나 얹었다.
 *
 * `soft` 는 아웃처럼 자주 나는 것에 쓴다. 같은 세기로 울리면 15분에
 * 수십 번이라 금방 거슬린다.
 */
function whistleAt(ac: AudioContext, at: number, soft = false): void {
  const gain = ac.createGain()
  const peak = soft ? 0.1 : 0.2
  const len = soft ? 0.14 : 0.22
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012)
  gain.gain.setValueAtTime(peak, at + len * 0.55)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len)
  gain.connect(ac.destination)

  // 콩이 구르는 떨림
  const warble = ac.createOscillator()
  const warbleAmt = ac.createGain()
  warble.frequency.value = 34
  warbleAmt.gain.value = 140
  warble.connect(warbleAmt)

  for (const [freq, level] of [
    [3350, 1],
    [4180, 0.55],
  ] as const) {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    warbleAmt.connect(osc.frequency)
    const g = ac.createGain()
    g.gain.value = level
    osc.connect(g).connect(gain)
    osc.start(at)
    osc.stop(at + len + 0.02)
  }

  // 바람 소리. 이게 없으면 순수 사인파라 사람이 분 것으로 안 들린다
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac, len + 0.05)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3600
  bp.Q.value = 6
  const ng = ac.createGain()
  ng.gain.value = 0.35
  src.connect(bp).connect(ng).connect(gain)
  src.start(at)
  src.stop(at + len + 0.05)

  warble.start(at)
  warble.stop(at + len + 0.02)
}

/**
 * 휘슬을 분다.
 *
 * `times` 가 2면 경기 종료다 — 실제로도 종료 휘슬은 길게 두세 번이다.
 */
export function whistle(times = 1, soft = false): void {
  const ac = audio()
  if (!ac) return
  loadSample(ac)
  const now = ac.currentTime
  const gap = soft ? 0.24 : 0.34
  for (let i = 0; i < times; i++) {
    const at = now + i * gap
    if (sample) playSample(ac, at, soft)
    else whistleAt(ac, at, soft)
  }
}

/**
 * 녹음된 휘슬 한 번.
 *
 * 아웃처럼 자주 나는 것은 **작고 짧게** 낸다. 같은 세기로 울리면 한 판에
 * 수십 번이라 금방 거슬린다.
 */
function playSample(ac: AudioContext, at: number, soft: boolean): void {
  if (!sample) return
  const src = ac.createBufferSource()
  src.buffer = sample
  const gain = ac.createGain()
  const peak = soft ? 0.34 : 0.72
  const len = soft ? CLIP.len * 0.6 : CLIP.len
  gain.gain.setValueAtTime(peak, at)
  // 끝을 부드럽게 닫는다. 뚝 끊으면 딱 소리가 난다
  gain.gain.setValueAtTime(peak, at + len * 0.8)
  gain.gain.linearRampToValueAtTime(0.0001, at + len)
  src.connect(gain).connect(ac.destination)
  src.start(at, CLIP.at, len)
  src.stop(at + len)
}

/**
 * 관중 함성.
 *
 * 잡음을 넓은 대역으로 통과시키고 크게 부풀렸다 천천히 죽인다. 골이
 * 들어간 뒤 관중이 일어나는 그 1~2초다. 실점이면 같은 소리를 작고
 * 낮게 내서 "저쪽 관중"으로 들리게 한다.
 */
export function cheer(ours: boolean): void {
  const ac = audio()
  if (!ac) return
  const now = ac.currentTime
  const len = ours ? 1.7 : 1.2

  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac, len)

  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(ours ? 520 : 380, now)
  bp.frequency.linearRampToValueAtTime(ours ? 1150 : 620, now + len * 0.35)
  bp.frequency.linearRampToValueAtTime(ours ? 700 : 420, now + len)
  bp.Q.value = 0.9

  const gain = ac.createGain()
  const peak = ours ? 0.22 : 0.12
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + (ours ? 0.16 : 0.24))
  gain.gain.exponentialRampToValueAtTime(0.0001, now + len)

  src.connect(bp).connect(gain).connect(ac.destination)
  src.start(now)
  src.stop(now + len)
}
