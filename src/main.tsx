import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 스포츠 헤드라인용 디스플레이 폰트. 번들에 포함되므로 외부 요청이 없다 (OFL)
import '@fontsource/black-han-sans'
import './index.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
