import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createState } from '../sim/engine'
import { PROBLEMS } from '../sim/problems'
import { Levers, StatBars } from './MatchScreen'

const tactics = { line: 1, press: 1, width: 1 } as const

function renderedButtons(locked: boolean): string[] {
  const html = renderToStaticMarkup(
    <Levers tactics={tactics} locked={locked} onSet={vi.fn()} />,
  )
  return html.match(/<button\b[^>]*>/g) ?? []
}

describe('전술 조작 잠금', () => {
  it('준비·진행 중에는 프리셋 5개와 세부 레버 9개가 활성화된다', () => {
    const buttons = renderedButtons(false)

    expect(buttons).toHaveLength(14)
    expect(buttons.every((button) => !button.includes('disabled'))).toBe(true)
  })

  it('종료 뒤에는 프리셋 5개와 세부 레버 9개가 모두 비활성화된다', () => {
    const buttons = renderedButtons(true)

    expect(buttons).toHaveLength(14)
    expect(buttons.every((button) => button.includes('disabled'))).toBe(true)
  })
})

describe('경기 기록 범위', () => {
  const state = createState(PROBLEMS[0])

  it('전반과 후반 모두 누적 전체가 아니라 이 반의 기록임을 제목에서 밝힌다', () => {
    const first = renderToStaticMarkup(<StatBars state={state} half={1} />)
    const second = renderToStaticMarkup(<StatBars state={state} half={2} />)

    expect(first).toContain('전반 경기 기록')
    expect(second).toContain('후반 경기 기록')
    expect(first).toContain('이 반만')
    expect(second).toContain('이 반만')
  })

  it('내부 집계값을 실제 세트피스 횟수처럼 쓰지 않는다', () => {
    const html = renderToStaticMarkup(<StatBars state={state} half={1} />)

    expect(html).toContain('세트피스 위험')
    expect(html).not.toContain('세트피스 허용')
    expect(html).toContain('배후 침투')
  })
})
