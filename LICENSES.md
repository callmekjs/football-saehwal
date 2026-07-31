# 사용한 서드파티

이 저장소가 실제로 설치해 쓰는 것 전부입니다. 버전과 라이선스는
`node_modules` 의 `package.json` 에서 그대로 읽었습니다.

## 실행에 들어가는 것

| 이름 | 버전 | 라이선스 |
|---|---|---|
| [react](https://github.com/facebook/react) | 19.2.8 | MIT |
| [react-dom](https://github.com/facebook/react) | 19.2.8 | MIT |

## 글꼴

전부 [Fontsource](https://fontsource.org/) 로 설치했고 네 벌 모두
**SIL Open Font License 1.1** 입니다. OFL 은 상업적 사용과 재배포를
허용하며, 글꼴 파일 자체를 파는 것만 금지합니다.

| 글꼴 | 버전 | 라이선스 | 쓰는 곳 |
|---|---|---|---|
| [Bebas Neue](https://fonts.google.com/specimen/Bebas+Neue) | 5.3.0 | OFL-1.1 | 스코어·숫자 |
| [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) | 5.3.0 | OFL-1.1 | 라벨·표 |
| [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR) | 5.3.0 | OFL-1.1 | 본문 한국어 |
| [Black Han Sans](https://fonts.google.com/specimen/Black+Han+Sans) | 5.3.0 | OFL-1.1 | 제목 |

## 만들 때만 쓰는 것 (배포본에 들어가지 않음)

| 이름 | 버전 | 라이선스 |
|---|---|---|
| [vite](https://github.com/vitejs/vite) | 7.3.6 | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 5.2.0 | MIT |
| [typescript](https://github.com/microsoft/TypeScript) | 5.9.3 | Apache-2.0 |
| [vitest](https://github.com/vitest-dev/vitest) | 3.2.7 | MIT |
| [tsx](https://github.com/privatenumber/tsx) | 4.23.1 | MIT |

## 쓰지 않은 것

- **외부 API 를 호출하지 않습니다.** 모든 계산이 브라우저 안에서 끝납니다.
- **차트·UI·애니메이션 라이브러리가 없습니다.** 경기장은 Canvas 2D 로
  직접 그리고 화면은 CSS 로 직접 짰습니다.
- **실존 선수·구단의 이름, 사진, 엠블럼, 유니폼을 쓰지 않습니다.**
  선수는 등번호와 포지션으로만 나타냅니다.
- 상대 팀 이름은 국가명이며 FIFA 랭킹을 참고했습니다. 엠블럼과 유니폼
  이미지는 쓰지 않고, 각 팀의 성향 수치는 창작입니다.

## 참고만 한 것

[ZOXEXIVO/open-football](https://github.com/ZOXEXIVO/open-football) 의
**정보 배치 원칙만** 참고했습니다. 코드·컴포넌트·CSS·색·문구·이미지·
선수 데이터는 가져오지 않았습니다.
