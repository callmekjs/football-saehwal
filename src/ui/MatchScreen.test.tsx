import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Levers } from './MatchScreen'

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
