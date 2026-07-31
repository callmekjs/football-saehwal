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
const ATTRIBUTE_LAYOUT: ReadonlyArray<{
  title: string
  rows: ReadonlyArray<{ key: keyof PlayerAttributes; label: string; used?: boolean }>
}> = [
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
    attributeGroups: ATTRIBUTE_LAYOUT.map((group) => ({
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

/** 1~20을 색 단계로. 축구 게임의 관례를 따른다 */
export function attributeTone(value: number): 'low' | 'mid' | 'high' | 'elite' {
  if (value >= 16) return 'elite'
  if (value >= 12) return 'high'
  if (value >= 8) return 'mid'
  return 'low'
}
