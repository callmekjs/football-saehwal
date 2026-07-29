import { describe, expect, it, vi } from 'vitest'
import raw from '../data/problems.json' with { type: 'json' }
import { createState } from '../sim/engine'
import { getPlayer } from '../sim/squad'
import type { FormationId } from '../sim/formations'
import type { Level, PlayerOrder, Problem } from '../sim/types'
import { applyCommand, digitsOf, parseCommand } from './voice'

const PROBLEMS = raw as unknown as Problem[]
const problem = PROBLEMS.find((p) => p.id === 'p02')!

const actions = () => ({
  setOrder: vi.fn<(target: string, order: PlayerOrder) => string | null>(() => null),
  setLever: vi.fn<(type: 'LINE' | 'PRESS' | 'WIDTH', value: Level) => void>(),
  setFormation: vi.fn<(value: FormationId) => void>(),
})

describe('음성 지시 알아듣기', () => {
  it('선수 지시 다섯을 알아듣는다', () => {
    const cases: Array<[string, PlayerOrder]> = [
      ['4번 내려', 'DROP_BACK'],
      ['7번 올려', 'PUSH_UP'],
      ['3번 골문', 'HOLD'],
      ['6번 물러', 'BACK_OFF'],
      ['9번 아껴', 'CONSERVE'],
    ]
    for (const [said, order] of cases) {
      expect(parseCommand(said), said).toEqual({
        kind: 'ORDER',
        num: Number(said.match(/\d+/)![0]),
        order,
      })
    }
  })

  it('지시 해제도 알아듣는다', () => {
    expect(parseCommand('4번 취소')).toEqual({ kind: 'ORDER', num: 4, order: 'NONE' })
  })

  it('같은 뜻의 다른 말도 받는다', () => {
    // 음성 인식은 같은 말을 매번 같은 글자로 돌려주지 않는다
    for (const said of ['4번 내려서', '4번 내려가', '4번 수비로']) {
      expect(parseCommand(said), said).toMatchObject({ order: 'DROP_BACK' })
    }
  })

  it('한자어 숫자로 들려도 등번호를 찾는다', () => {
    expect(parseCommand('사번 내려')).toEqual({ kind: 'ORDER', num: 4, order: 'DROP_BACK' })
    expect(parseCommand('십오번 올려')).toEqual({ kind: 'ORDER', num: 15, order: 'PUSH_UP' })
    expect(parseCommand('이십이번 취소')).toEqual({ kind: 'ORDER', num: 22, order: 'NONE' })
  })

  it('전술 프리셋 다섯을 알아듣는다', () => {
    const cases: Array<[string, string]> = [
      ['균형', '균형'],
      ['역습', '역습'],
      ['측면', '측면 공략'],
      ['압박', '전방 압박'],
      ['밀집', '밀집 수비'],
    ]
    for (const [said, name] of cases) {
      const cmd = parseCommand(said)
      expect(cmd?.kind, said).toBe('PRESET')
      expect(cmd?.kind === 'PRESET' && cmd.preset.name, said).toBe(name)
    }
  })

  it('포메이션은 숫자 표기가 어떻게 들려도 하나로 모인다', () => {
    for (const said of ['442', '4 4 2', '4-4-2', '사사이', '포메이션 442로']) {
      expect(parseCommand(said), said).toEqual({ kind: 'FORMATION', id: '4-4-2' })
    }
    expect(parseCommand('삼사삼')).toEqual({ kind: 'FORMATION', id: '3-4-3' })
    expect(parseCommand('4231')).toEqual({ kind: 'FORMATION', id: '4-2-3-1' })
    expect(parseCommand('442 다이아몬드')).toEqual({ kind: 'FORMATION', id: '4-4-2D' })
  })

  it('숫자 표기 정규화가 한자어와 아라비아 숫자를 같게 만든다', () => {
    expect(digitsOf('사사이')).toBe('442')
    expect(digitsOf('4 4 2')).toBe('442')
    expect(digitsOf('4-4-2')).toBe('442')
  })

  it('확실하지 않으면 아무것도 하지 않는다', () => {
    // 엉뚱한 지시를 거는 것이 못 알아듣는 것보다 훨씬 나쁘다
    for (const said of [
      '',
      '   ',
      '오늘 날씨가 좋네요',
      '4번', // 번호는 들렸는데 무엇을 시킬지가 안 들렸다
      '내려', // 누구에게인지가 없다
      '999', // 없는 포메이션
      '12',
    ]) {
      expect(parseCommand(said), JSON.stringify(said)).toBeNull()
    }
  })
})

describe('음성 지시 걸기', () => {
  it('탭과 같은 함수를 부른다', () => {
    const a = actions()
    const state = createState(problem)
    const four = state.players.find((s) => getPlayer(s.id).num === 4 && s.onPitch)!

    const note = applyCommand(parseCommand('4번 내려')!, state, a)
    expect(a.setOrder).toHaveBeenCalledWith(four.id, 'DROP_BACK')
    expect(note).toContain('4번')
  })

  it('전술은 레버 셋을 한 번에 세운다', () => {
    const a = actions()
    applyCommand(parseCommand('역습')!, createState(problem), a)
    expect(a.setLever).toHaveBeenCalledTimes(3)
    expect(a.setLever).toHaveBeenCalledWith('LINE', 0)
    expect(a.setLever).toHaveBeenCalledWith('PRESS', 0)
    expect(a.setLever).toHaveBeenCalledWith('WIDTH', 1)
  })

  it('포메이션은 그대로 넘긴다', () => {
    const a = actions()
    const note = applyCommand(parseCommand('4-3-3')!, createState(problem), a)
    expect(a.setFormation).toHaveBeenCalledWith('4-3-3')
    expect(note).toContain('4-3-3')
  })

  it('피치 위에 없는 등번호는 걸지 않고 그렇다고 말한다', () => {
    const a = actions()
    const note = applyCommand(parseCommand('15번 내려')!, createState(problem), a)
    expect(a.setOrder).not.toHaveBeenCalled()
    expect(note).toContain('피치 위에 없습니다')
  })

  it('막힌 이유는 탭으로 눌렀을 때와 같은 문장으로 나온다', () => {
    const a = actions()
    a.setOrder.mockReturnValue('골키퍼에게는 지시할 수 없다')
    const note = applyCommand(parseCommand('1번 내려')!, createState(problem), a)
    expect(note).toBe('골키퍼에게는 지시할 수 없다')
  })
})
