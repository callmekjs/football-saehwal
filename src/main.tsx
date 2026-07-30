import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
/**
 * 폰트는 전부 **번들에 넣는다.** 구글 폰트 CDN을 쓰면 심사자의 망이 느리거나
 * 막혀 있을 때 글자가 통째로 다른 모양으로 뜬다. 배포 URL 하나로 평가받는
 * 대회라 외부 요청에 기대면 안 된다. 전부 OFL 이라 번들이 허용된다.
 */
// 한글 헤드라인
import '@fontsource/black-han-sans'
// 스코어·시계·등번호 같은 큰 숫자
import '@fontsource/bebas-neue/latin-400.css'
// 라벨·캡스. 500·600·700 세 굵기를 쓴다
import '@fontsource/barlow-condensed/latin-400.css'
import '@fontsource/barlow-condensed/latin-500.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
/**
 * 한글 본문. **한글·라틴 부분집합만 가져온다.**
 *
 * 전체를 넣으면 유니코드 구간이 100개가 넘게 딸려와 CSS 가 260KB 늘어난다.
 * 첫 화면이 그리기 전에 내려받는 파일이라 그만큼 늦게 뜬다. 우리가 쓰는
 * 글자는 한글과 영숫자뿐이다.
 */
import '@fontsource/noto-sans-kr/korean-400.css'
import '@fontsource/noto-sans-kr/korean-500.css'
import '@fontsource/noto-sans-kr/korean-700.css'
import '@fontsource/noto-sans-kr/latin-400.css'
import '@fontsource/noto-sans-kr/latin-500.css'
import '@fontsource/noto-sans-kr/latin-700.css'
import './index.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
