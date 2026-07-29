import { FORMATION_IDS, getFormation, type FormationId } from '../sim/formations'
import { getPlayer } from '../sim/squad'
import { ORDER_LABELS } from './SquadPanel'
import { PRESETS, type TacticPreset } from '../analysis/presets'
import type { Level, MatchState, PlayerOrder } from '../sim/types'

/**
 * 급수 타임에 말로 내리는 지시를 알아듣는다.
 *
 * ★ 음성은 **덤이다.** ★
 *
 * 탭으로 하던 모든 것이 그대로 남아 있고, 이건 같은 일을 하는 또 하나의
 * 길일 뿐이다. 마이크를 거절하거나 지원하지 않는 브라우저로 열어도
 * **아무 기능도 잃지 않는다.**
 *
 * **자유 문장은 알아듣지 않는다.** 자유 문장을 이해하려면 외부 AI가
 * 필요하고, 그러면 심사자가 키를 따로 넣어야 하는 기능이 되어 대회
 * 평가에서 빠질 수 있다. `SpeechRecognition` 은 브라우저 기본 기능이라
 * 키가 필요 없고, 대신 알아듣는 말이 **정해진 몇 마디뿐**이다.
 *
 * 못 알아들으면 **아무것도 하지 않는다.** 엉뚱한 지시를 거는 것이 못
 * 알아듣는 것보다 훨씬 나쁘다 — 되돌릴 시간이 없기 때문이다.
 *
 * 이 파일은 순수하다. `SpeechRecognition` 은 `useVoice.ts` 에만 있다.
 */

export type VoiceCommand =
  | { kind: 'ORDER'; num: number; order: PlayerOrder }
  | { kind: 'PRESET'; preset: TacticPreset }
  | { kind: 'FORMATION'; id: FormationId }

/** 한자어 숫자 한 글자. 음성 인식이 "사번"으로 돌려줄 때가 있다 */
const DIGIT: Record<string, string> = {
  공: '0',
  영: '0',
  일: '1',
  이: '2',
  삼: '3',
  사: '4',
  오: '5',
  육: '6',
  륙: '6',
  칠: '7',
  팔: '8',
  구: '9',
}

/**
 * 지시를 나타내는 말.
 *
 * 한 지시에 여러 표현을 둔다. 음성 인식은 같은 말을 매번 같은 글자로
 * 돌려주지 않는다 — "내려"가 "내려서"로도 "내려가"로도 온다.
 */
const ORDER_WORDS: Array<{ order: PlayerOrder; words: string[] }> = [
  { order: 'DROP_BACK', words: ['내려', '내려서', '내려가', '수비로'] },
  { order: 'PUSH_UP', words: ['올려', '올라', '올라가', '공격으로'] },
  { order: 'HOLD', words: ['골문', '골대', '문앞', '문 앞'] },
  { order: 'BACK_OFF', words: ['물러', '빠져', '자제'] },
  { order: 'CONSERVE', words: ['아껴', '아끼', '아낀'] },
  { order: 'NONE', words: ['취소', '해제', '풀어', '없애'] },
]

/** 프리셋을 부르는 짧은 말. 정식 이름 전체를 말하지 않아도 된다 */
const PRESET_WORDS: Record<string, string> = {
  균형: '균형',
  역습: '역습',
  측면: '측면 공략',
  공략: '측면 공략',
  압박: '전방 압박',
  전방: '전방 압박',
  밀집: '밀집 수비',
}

/**
 * 숫자 표기를 하나로 맞춘다.
 *
 * "442" · "4 4 2" · "4-4-2" · "사사이" 가 전부 같은 포메이션이다. 음성
 * 인식이 어느 쪽으로 돌려줄지 고를 수 없으므로 전부 숫자열로 눕힌다.
 *
 * 한자어 숫자는 **아라비아 숫자가 하나도 없을 때만** 읽는다. 안 그러면
 * "포메이션 442로"의 "포메**이**션"에서 이(2)를 주워 2442가 된다. 그리고
 * 붙어 있는 덩어리 중 가장 긴 것만 본다 — 흘려 들어온 한 글자가 숫자로
 * 섞이면 엉뚱한 포메이션이 걸린다.
 */
export function digitsOf(text: string): string {
  const arabic = text.replace(/\D/g, '')
  if (arabic) return arabic

  let best = ''
  let run = ''
  for (const ch of text) {
    if (DIGIT[ch]) run += DIGIT[ch]
    else {
      if (run.length > best.length) best = run
      run = ''
    }
  }
  return run.length > best.length ? run : best
}

/** 숫자열 → 포메이션. `4-4-2` 와 `4-4-2D` 는 둘 다 442 라 따로 가른다 */
const FORMATION_BY_DIGITS = new Map<string, FormationId>()
for (const id of FORMATION_IDS) {
  const key = digitsOf(id)
  if (!FORMATION_BY_DIGITS.has(key)) FORMATION_BY_DIGITS.set(key, id)
}

/** 등번호를 뽑는다. "4번" · "사번" · "십오번" 을 받는다 */
function jerseyOf(text: string): number | null {
  const direct = text.match(/(\d{1,2})\s*번/)
  if (direct) return Number(direct[1])

  // "십오번" 처럼 십 단위가 붙는 경우. 우리 명단은 22번이 최대다
  const korean = text.match(/([공영일이삼사오육륙칠팔구십]{1,4})\s*번/)
  if (!korean) return null
  const word = korean[1]
  if (word.includes('십')) {
    const [tens, ones] = word.split('십')
    const t = tens === '' ? 1 : Number(DIGIT[tens] ?? NaN)
    const o = ones === '' ? 0 : Number(DIGIT[ones] ?? NaN)
    if (Number.isNaN(t) || Number.isNaN(o)) return null
    return t * 10 + o
  }
  const digits = digitsOf(word)
  return digits.length > 0 ? Number(digits) : null
}

/**
 * 들은 말을 명령으로 옮긴다. 확실하지 않으면 `null` 이다.
 *
 * 애매할 때 넘겨짚지 않는 것이 이 함수의 일이다. 75초는 되돌릴 시간이
 * 없어서, 잘못 건 지시 하나가 판을 끝낸다.
 */
export function parseCommand(raw: string): VoiceCommand | null {
  const text = raw.trim()
  if (!text) return null

  // 1. 선수 지시 — 등번호가 있으면 언제나 선수 이야기다
  const num = jerseyOf(text)
  if (num !== null) {
    for (const { order, words } of ORDER_WORDS) {
      if (words.some((w) => text.includes(w))) return { kind: 'ORDER', num, order }
    }
    // 번호는 들렸는데 무엇을 시킬지가 안 들렸다. 넘겨짚지 않는다
    return null
  }

  // 2. 이름 붙은 전술
  for (const [word, name] of Object.entries(PRESET_WORDS)) {
    if (!text.includes(word)) continue
    const preset = PRESETS.find((p) => p.name === name)
    if (preset) return { kind: 'PRESET', preset }
  }

  // 3. 포메이션
  const digits = digitsOf(text)
  if (digits.length >= 3) {
    if (digits === '442' && /다이아|다이야/.test(text)) return { kind: 'FORMATION', id: '4-4-2D' }
    const id = FORMATION_BY_DIGITS.get(digits)
    if (id) return { kind: 'FORMATION', id }
  }

  return null
}

export interface VoiceActions {
  setOrder: (target: string, order: PlayerOrder) => string | null
  setLever: (type: 'LINE' | 'PRESS' | 'WIDTH', value: Level) => void
  setFormation: (value: FormationId) => void
}

/**
 * 명령을 실제로 건다. 화면에 그대로 띄울 한 줄을 돌려준다.
 *
 * 검증은 새로 만들지 않는다. `checkOrder` 가 이미 사유 문자열을 돌려주므로
 * 그것을 그대로 보여준다 — 탭으로 눌렀을 때와 **같은 말**이 나와야 한다.
 */
export function applyCommand(
  cmd: VoiceCommand,
  state: MatchState,
  actions: VoiceActions,
): string {
  if (cmd.kind === 'PRESET') {
    actions.setLever('LINE', cmd.preset.v[0])
    actions.setLever('PRESS', cmd.preset.v[1])
    actions.setLever('WIDTH', cmd.preset.v[2])
    return `전술 → ${cmd.preset.name}`
  }

  if (cmd.kind === 'FORMATION') {
    actions.setFormation(cmd.id)
    return `포메이션 → ${getFormation(cmd.id).label}`
  }

  const target = state.players.find(
    (s) => s.onPitch && !s.out && getPlayer(s.id).num === cmd.num,
  )
  if (!target) return `${cmd.num}번은 지금 경기에 뛰고 있지 않습니다`

  const reason = actions.setOrder(target.id, cmd.order)
  if (reason) return reason
  if (cmd.order === 'NONE') return `${cmd.num}번 지시 해제`
  return `${cmd.num}번 → ${ORDER_LABELS[cmd.order].name}`
}
