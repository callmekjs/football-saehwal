/**
 * 검사에서만 쓰는 최소한의 브라우저 도구.
 *
 * 이 저장소의 화면 검사는 거의 전부 `renderToStaticMarkup` 으로 **한 번
 * 그려진 결과**만 본다. 그것으로는 원리적으로 잡히지 않는 고장이 둘 있었고
 * 둘 다 공개 배포본까지 갔다.
 *
 * - 효과가 스스로를 다시 부르는 되풀이. 그려진 글자는 멀쩡한데 60초마다
 *   같은 판이 한 건씩 저장됐다.
 * - 눌러도 아무 일이 없는 카드. 마크업에는 버튼이 분명히 있었다.
 *
 * 둘 다 **실제로 마운트하고, 시간을 흘리고, 눌러 봐야** 보인다. 그래서
 * 이 파일이 있다.
 *
 * **`src/sim/` 은 여전히 브라우저를 모른다.** 이 파일은 `src/ui/` 것이고
 * 검사 파일만 부른다. 이 도구를 쓰는 검사 파일은 맨 위에
 * `@vitest-environment jsdom` 을 적어 그 파일에서만 브라우저를 켠다 —
 * 나머지 검사는 지금까지처럼 Node 에서 돈다.
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/** React 에게 "여기는 검사 환경"이라고 알린다. 없으면 act 경고가 쏟아진다 */
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

export interface Mounted {
  container: HTMLElement
  /** 같은 뿌리에 다시 그린다. 부모가 다시 렌더되는 상황을 흉내낸다 */
  render(node: ReactNode): void
  unmount(): void
}

export function mount(node: ReactNode): Mounted {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return {
    container,
    render(next: ReactNode) {
      act(() => {
        root.render(next)
      })
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

/**
 * 진짜 클릭을 보낸다.
 *
 * React 19 는 뿌리 요소 하나에 듣고 있으므로 **반드시 거품처럼 올라가야**
 * 한다(`bubbles: true`). 이걸 빠뜨리면 눌렀는데 아무 일도 안 일어나서,
 * 하필 지금 고치려는 고장과 똑같이 보인다.
 */
export function click(el: Element, init: MouseEventInit = {}): void {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
    )
  })
}

/**
 * 첫 click 뒤 DOM이 바뀌는 자리의 실제 더블클릭 순서.
 *
 * 브라우저는 첫 click이 화면을 바꿔도 같은 좌표에 mousedown → mouseup →
 * click → dblclick을 계속 보낸다. 두 번째 표적은 첫 click 뒤에야 생기므로
 * 콜백으로 다시 찾는다.
 */
export function doubleClickThrough(
  first: Element,
  afterFirst: () => Element,
  init: MouseEventInit = {},
): Element {
  const sendClick = (target: Element, detail: number) => {
    const options = { bubbles: true, cancelable: true, ...init, detail }
    target.dispatchEvent(new MouseEvent('mousedown', options))
    target.dispatchEvent(new MouseEvent('mouseup', options))
    target.dispatchEvent(new MouseEvent('click', options))
  }

  act(() => sendClick(first, 1))
  const second = afterFirst()
  act(() => {
    sendClick(second, 2)
    second.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        ...init,
        detail: 2,
      }),
    )
  })
  return second
}

/** 가짜 시계를 그만큼 흘린다. 효과가 붙인 타이머까지 함께 돈다 */
export function advance(step: () => void): void {
  act(step)
}

/** 글자로 찾는다. 사람이 화면에서 찾는 방법과 같아야 검사가 거짓말을 안 한다 */
export function findAll(
  root: ParentNode,
  selector: string,
  text: string,
): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((el) =>
    (el.textContent ?? '').includes(text),
  )
}

export function find(root: ParentNode, selector: string, text: string): HTMLElement {
  const hits = findAll(root, selector, text)
  if (hits.length === 0) throw new Error(`화면에서 「${text}」(${selector})를 찾을 수 없다`)
  return hits[0]
}
