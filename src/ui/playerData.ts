import { abilityOf, effectivePos, getPlayer, isStarAbility } from '../sim/squad'
import type { Player, PlayerAttributes, PlayerState, Position } from '../sim/types'

export type PlayerAvailability = 'PLAYING' | 'BENCH' | 'OUT'

/** 능력치 한 줄. 화면이 그대로 그린다 */
export interface AttributeRow {
  key: keyof PlayerAttributes
  label: string
  value: number
  /** 이 값이 경기 계산에 실제로 쓰이는가 */
  used: boolean
}

export interface AttributeGroup {
  title: string
  rows: AttributeRow[]
}

export interface PlayerData {
  id: string
  number: number
  basePosition: Position
  currentPosition: Position
  availability: PlayerAvailability
  stamina: number
  rosterStamina: number
  speed: number
  finishing: number
  booked: boolean
  hasOrder: boolean
  hasFreePosition: boolean
  /** 이 판의 능력치. 판마다 주인이 바뀐다 */
  attributeGroups: AttributeGroup[]
  /** 이번 명단에서 유난히 뛰어난 선수인가 */
  star: boolean
  /** 능력치가 아닌 신상 */
  profile: Player['profile']
}

/**
 * 능력치를 화면에 어떤 순서로 보여줄지.
 *
 * `used` 는 **그 값이 실제로 경기 계산에 들어가는가**다. 축구 게임을 흉내
 * 내려고 숫자를 늘어놓는 것이 아니라는 표시이고, 감독이 어느 칸을 보고
 * 판단해야 하는지를 알려준다. 이 프로젝트는 계산에 안 쓰이는 종합 평점을
 * 일부러 만들지 않았고, 그 원칙을 능력치에서도 깨지 않는다.
 */
type AttributeLayout = ReadonlyArray<{
  title: string
  rows: ReadonlyArray<{ key: keyof PlayerAttributes; label: string; used?: boolean }>
}>

/**
 * 골키퍼의 기술적 능력.
 *
 * 사용자가 골키퍼 화면을 주고 정했다. 골키퍼에게 태클·헤더·드리블·크로스를
 * 보여주는 것은 그 자리를 설명하지 못한다. 실제로 골키퍼를 가르는 것은
 * 반사 신경과 볼 핸들링, 공중과 박스를 얼마나 장악하는가다.
 *
 * **정신과 신체는 필드 선수와 같은 것을 쓴다.** 집중력과 판단력은 골키퍼
 * 에게도 같은 뜻이고, 나눠 놓으면 같은 값이 두 이름으로 존재하게 된다.
 */
const KEEPER_TECHNICAL: AttributeLayout[number] = {
  title: '기술적 능력',
  rows: [
    { key: 'oneOnOne', label: '1:1 방어' },
    { key: 'reflexes', label: '반사 신경' },
    { key: 'handling', label: '볼 핸들링' },
    { key: 'aerialReach', label: '공중 장악력' },
    { key: 'commandOfArea', label: '페널티 박스 장악력' },
    { key: 'organisation', label: '수비 조율' },
    { key: 'goalKick', label: '골킥' },
    { key: 'throwing', label: '공 던지기' },
    { key: 'rushingOut', label: '돌진 성향' },
    { key: 'punching', label: '펀칭 성향' },
    { key: 'pass', label: '패스' },
    { key: 'firstTouch', label: '퍼스트 터치' },
  ],
}

const ATTRIBUTE_LAYOUT: AttributeLayout = [
  {
    title: '기술적 능력',
    rows: [
      { key: 'technique', label: '개인기' },
      { key: 'finish', label: '골 결정력', used: true },
      { key: 'dribble', label: '드리블' },
      { key: 'marking', label: '일대일 마크' },
      { key: 'longThrow', label: '장거리 스로인' },
      { key: 'longShot', label: '중거리 슛' },
      { key: 'corner', label: '코너킥' },
      { key: 'cross', label: '크로스' },
      { key: 'tackle', label: '태클' },
      { key: 'pass', label: '패스' },
      { key: 'firstTouch', label: '퍼스트 터치' },
      { key: 'penalty', label: '페널티킥' },
      { key: 'setPiece', label: '프리킥' },
      { key: 'header', label: '헤더' },
    ],
  },
  {
    title: '정신적 능력',
    rows: [
      { key: 'offTheBall', label: '공 없을 때 움직임' },
      { key: 'bravery', label: '대담성' },
      { key: 'leadership', label: '리더십' },
      { key: 'positioning', label: '수비 위치' },
      { key: 'determination', label: '승부욕' },
      { key: 'vision', label: '시야' },
      { key: 'anticipation', label: '예측력' },
      { key: 'aggression', label: '적극성' },
      { key: 'concentration', label: '집중력' },
      { key: 'flair', label: '천재성' },
      { key: 'composure', label: '침착성' },
      { key: 'teamwork', label: '팀워크' },
      { key: 'judgement', label: '판단력' },
      { key: 'workRate', label: '활동량' },
    ],
  },
  {
    title: '신체',
    rows: [
      { key: 'balance', label: '균형 감각' },
      { key: 'strength', label: '몸싸움' },
      { key: 'agility', label: '민첩성' },
      { key: 'pace', label: '순간 속도', used: true },
      { key: 'jump', label: '점프 거리' },
      { key: 'speed', label: '주력', used: true },
      { key: 'endurance', label: '지구력' },
      { key: 'naturalFitness', label: '타고난 체력' },
    ],
  },
]

/**
 * 화면에 보여줄 선수 데이터.
 *
 * 종합 평점처럼 계산하지 않는 값은 만들지 않는다. 명단과 현재 경기 상태에서
 * 실제로 결정되는 값만 같은 모양으로 묶는다.
 */
export function playerDataOf(state: PlayerState): PlayerData {
  const player = getPlayer(state.id)
  // 능력은 명단이 아니라 **이 판의 상태**에서 읽는다. 판마다 주인이 바뀐다
  const ability = abilityOf(state)
  return {
    id: state.id,
    number: player.num,
    basePosition: player.pos,
    currentPosition: effectivePos(state),
    availability: state.out ? 'OUT' : state.onPitch ? 'PLAYING' : 'BENCH',
    stamina: Math.max(0, Math.min(100, state.stamina)),
    rosterStamina: player.stamina0,
    speed: ability.speed,
    finishing: ability.finishing,
    booked: state.booked,
    hasOrder: state.order !== 'NONE',
    hasFreePosition: state.position !== null,
    star: isStarAbility(ability),
    profile: player.profile,
    attributeGroups: layoutFor(player.pos).map((group) => ({
      title: group.title,
      rows: group.rows.map((row) => ({
        key: row.key,
        label: row.label,
        value: ability.attributes[row.key],
        used: row.used === true,
      })),
    })),
  }
}

/**
 * 자리에 맞는 능력치 묶음.
 *
 * 골키퍼만 기술 칸을 통째로 갈아 끼운다. 정신과 신체는 그대로다.
 */
function layoutFor(pos: Position): AttributeLayout {
  if (pos !== 'GK') return ATTRIBUTE_LAYOUT
  return [KEEPER_TECHNICAL, ...ATTRIBUTE_LAYOUT.slice(1)]
}

/**
 * 능력치 한 칸의 한국어 이름.
 *
 * 두 묶음을 합쳐 이름표의 단일 원본으로 삼는다. 분석 계층
 * (`opponentSquad`)은 값만 정하고 이름은 화면이 붙인다.
 */
const ATTRIBUTE_LABEL = new Map<keyof PlayerAttributes, string>(
  [KEEPER_TECHNICAL, ...ATTRIBUTE_LAYOUT].flatMap((group) =>
    group.rows.map((row) => [row.key, row.label] as const),
  ),
)

export function attributeLabel(key: keyof PlayerAttributes): string {
  return ATTRIBUTE_LABEL.get(key) ?? key
}

/**
 * 목록 줄에 요약해 세우는 세 칸.
 *
 * 사용자가 정했다 — *"포지션이 4개가 있는데 스펙은 다 같네? 포지션에 맞게
 * 스펙을 맞춰야지."*
 *
 * 전에는 네 포지션이 모두 `골 결정력 · 순간 속도 · 주력` 같은 세 칸을
 * 보여줬다. 능력치 자체는 포지션대로 갈려 있는데 **하필 그 셋이 자리를
 * 구분하지 못했다.** 기본 명단 실측으로 순간 속도가 수비 14.3 · 중원
 * 14.4 였고 주력도 14.3 · 14.2 라, 줄만 보면 수비수와 미드필더가 같은
 * 선수로 보였다.
 *
 * 그래서 **그 자리를 실제로 설명하는 값**으로 바꿨다. 아래 셋은 전부
 * 기본 명단에서 그 포지션이 다른 세 포지션보다 높은 값이다.
 *
 * ```
 *           GK     DF     MF     FW
 * 예측력    16.0   13.6   12.3   13.0
 * 수비위치  15.7   15.1   10.4    5.8
 * 집중력    14.7   13.8   12.4   10.4
 * 마크       6.7   14.6   10.3    4.8
 * 태클       4.0   14.2   10.8    4.2
 * 헤더       9.7   13.0    9.9   11.0
 * 패스      10.3   11.2   14.0    9.2
 * 시야      10.0   10.3   13.1   10.4
 * 활동량     7.3   13.3   13.8   10.4
 * 결정력     3.3    5.7   10.4   13.4
 * 공없을때   6.3    6.7   12.4   15.4
 * 순간속도  10.7   14.3   14.4   15.6
 * ```
 *
 * **`ATTRIBUTE_LAYOUT` 은 건드리지 않는다.** 카드를 펼쳤을 때 보이는
 * 서른여섯 개의 목록과 순서는 사용자가 화면을 주고 맞춘 것이다. 여기서
 * 고르는 것은 줄에 요약해 세울 몇 칸뿐이다.
 */
const SUMMARY_KEYS: Record<Position, ReadonlyArray<keyof PlayerAttributes>> = {
  // 골키퍼는 전용 능력치가 생겼으므로 그 자리를 실제로 가르는 셋을 쓴다
  GK: ['reflexes', 'handling', 'commandOfArea'],
  DF: ['marking', 'tackle', 'header'],
  MF: ['pass', 'vision', 'workRate'],
  FW: ['finish', 'offTheBall', 'pace'],
}

/**
 * 이 선수의 줄에 세울 세 칸. **등록 포지션**으로 고른다.
 *
 * 지시로 자리를 옮긴 선수도 능력치는 그대로이므로, 현재 역할이 아니라
 * 등록 포지션이 그 사람을 설명한다.
 */
export function summaryRowsOf(data: PlayerData): AttributeRow[] {
  const all = new Map(
    data.attributeGroups.flatMap((group) => group.rows).map((row) => [row.key, row]),
  )
  return SUMMARY_KEYS[data.basePosition]
    .map((key) => all.get(key))
    .filter((row): row is AttributeRow => row !== undefined)
}

/** 1~20을 색 단계로. 축구 게임의 관례를 따른다 */
export function attributeTone(value: number): 'low' | 'mid' | 'high' | 'elite' {
  if (value >= 16) return 'elite'
  if (value >= 12) return 'high'
  if (value >= 8) return 'mid'
  return 'low'
}
