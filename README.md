# STELARMS

STELLIVE 팬메이드 2인 대전 카드 게임의 설계 문서와 **카드 뷰어 + 덱 빌더 + 온라인 대전** 웹 앱.

- **문서** (`docs/`): 룰, 로스터, 카드 154장, 밸런스, 제작/IP.
- **웹 앱** (`src/`): 카드 154장 데이터를 그대로 읽어 카드를 찾아보고, 덱을 짜고, 온라인으로 대전한다.
- **룰 엔진** (`src/engine/`): 카드 효과와 판정을 서버에서 결정론적으로 실행하는 순수 TypeScript.
- **서버** (`server/`): 방·재접속·턴 타이머를 관리하는 Bun WebSocket 서버.

## 웹 앱

```bash
bun install
bun dev        # 개발 서버 (5173)
bun run build  # 타입 검사 + 프로덕션 빌드
bun run lint   # oxlint
```

- **카드 뷰어**: 기수 / 스트리머 / 타입 / 키워드 필터 + 이름·텍스트·출처 검색.
  카드 크기(작게·보통·크게)를 바꿀 수 있고, 카드를 누르면 크게 보며 출처·메모를 확인한다.
- **덱 빌더**: 스트리머 2명을 고르고 통상 7 + 비장 3을 구성. 추천 덱 14개를 불러오거나 내 커스텀 덱을 저장해 대전에 사용할 수 있다.
- **스트리머**: 기수별 로스터 정보(신장·무기·적정거리·시그니처)와 보유 카드 전체.
- **대전** (`#play`): 방 코드로 2인 접속, 추천 덱 또는 커스텀 덱 선택, 서버 판정 대전.
  멀리건·개시 페이즈·공격/대응/방어·선택/정렬·턴 타이머·재접속을 지원한다.

### 데이터 수정 (확장·밸런스)

게임 데이터는 **`src/data/`의 TypeScript 파일**에 모여 있다. UI와 완전히 분리되어 있어
데이터만 고치면 화면에 바로 반영된다. 타입이 맞지 않으면 빌드에서 오류가 난다.

| 파일 | 내용 |
| --- | --- |
| `src/data/types.ts` | 카드/스트리머/기수/덱 타입 정의 |
| `src/data/stellas.ts` | 기수 4개 + 스트리머 14명 |
| `src/data/cards/everys.ts` | 1기 유니·후야 카드 22장 |
| `src/data/cards/universe.ts` | 2기 히나·마시로·리제·타비 카드 44장 |
| `src/data/cards/cliche.ts` | 3기 시부키·린·나나·리코 카드 44장 |
| `src/data/cards/abyss.ts` | 4기 토아·랑·히요리·메리 카드 44장 |
| `src/data/decks.ts` | 추천 덱 14개 |
| `src/data/customDeck.ts` | 커스텀 덱 형식·장수·중복·스텔라 소속 검증 |
| `src/data/frames.ts` | 카드 프레임·일러스트 창 레이아웃 |
| `src/data/index.ts` | 카드 합치기 + 조회 헬퍼 (`allCards`, `cardById`, `searchCards` 등) |
| `src/engine/effects/cards/` | 카드별 효과 프로그램 (대전 판정) |

**확장판을 추가하려면**: `types.ts`의 `GenerationId`에 기수를 하나 더하고,
`stellas.ts`에 스트리머를 추가한 뒤, `cards/<새기수>.ts`를 만들어 `index.ts`의
`allCards`에 펼쳐 넣는다. 화면 코드는 고칠 필요가 없다. 대전에서도 쓰려면
`src/engine/effects/cards/`에 카드별 효과 프로그램을 추가한다. 프로그램이 없으면
뷰어·덱 빌더에는 표시되지만 대전에서는 사용할 수 없다.

### 카드 이미지 (레이어 합성)

카드는 한 장의 이미지가 아니라 **세 겹**을 합성해서 그린다. 카드마다 바뀌는 부분만 갈아끼우면 된다.

| 레이어 | 위치 | 바뀌는 단위 |
| --- | --- | --- |
| ① 프레임 | `public/frames/normal.png`, `special.png` | 통상 / 비장 |
| ② 일러스트 | `public/images/art/<카드ID>.png` | 카드마다 |
| ③ 텍스트 | `src/data/cards/*.ts` | 카드마다 (이미지 불필요) |

- **텍스트 수정**은 TypeScript 한 줄만 고치면 된다. 이미지를 다시 뽑을 필요가 없다. 카드 폭에 맞춰 글자 크기가 자동으로 조정된다.
- **일러스트 교체**는 `public/images/art/`의 파일 하나만 바꾸면 된다.
- **프레임 교체**는 `public/frames/`의 파일 하나만 바꾸면 된다. 없으면 CSS 기본 프레임이 표시된다.
- 레이아웃(일러스트 창 위치)은 `src/data/frames.ts`에서만 고친다.
- 완성된 카드 이미지를 통째로 쓰고 싶으면 카드 데이터에 `image`를 지정한다.

자세한 규격은 [public/images/README.md](public/images/README.md), [public/frames/README.md](public/frames/README.md) 참고.

## 룰 엔진과 온라인 대전

엔진은 UI와 분리된 순수 TypeScript다. 상태는 직렬화 가능한 데이터만 쓰고,
시드 RNG(xoshiro128**)로 카드 뽑기를 결정론적으로 처리한다. 같은 시드와 액션
목록이면 항상 같은 상태 해시가 나온다.

서버가 **유일한 판정자**다. 클라이언트는 액션 의도만 보내고, 서버가 스키마와
규칙을 검증한 뒤 `applyAction`으로 상태를 갱신한다. 클라이언트에는 좌석별
`toPlayerView`만 보내므로 상대 손패·패산·덮음패·비장패가 노출되지 않는다.
커스텀 덱도 서버가 장수·중복·스텔라 소속·효과 구현 여부를 다시 검증하며,
로비에서도 상대 덱의 카드 목록은 보내지 않고 이름·스텔라·장수만 공개한다.

### 실행

```bash
# 개발: Vite(5173) + WebSocket 서버(3001)
bun run dev
bun run dev:server

# 프로덕션: 빌드 결과(dist)와 WebSocket을 3001에서 함께 서빙
bun run build
bun run serve
```

- 접속: `http://localhost:5173/#play` (개발) 또는 `http://localhost:3001/#play` (프로덕션).
- 환경 변수: `PORT`(기본 3001), `HOST`(기본 0.0.0.0), `STELARMS_TURN_MS`(기본 90000),
  `VITE_WS_URL`(클라이언트 WebSocket 주소 재정의).

### 구조

| 경로 | 역할 |
| --- | --- |
| `src/engine/` | 카드·룰·효과 DSL·판정·해시·플레이어 뷰 |
| `src/engine/effects/cards/` | 카드 154장의 효과 프로그램 |
| `server/index.ts` | 방/좌석/토큰·액션 검증·타임아웃·정적 서빙 |
| `src/net/` | WebSocket 프로토콜, 덱 선택 검증, `useOnline` 훅 |
| `src/components/play/` | 로비, 대전 보드, pending 프롬프트 UI |

### 검증

```bash
bun test                              # 엔진 + 커스텀 덱 + 렌더 테스트
bunx tsc -b                           # 클라이언트 타입 검사
bunx tsc -p server/tsconfig.json      # 서버 타입 검사
bun run build                         # 프로덕션 빌드
bun run lint                          # oxlint
```

### 엔진 무결성

- 모든 액션은 `structuredClone` 뒤 적용하고, 실패하면 원본을 바꾸지 않는다.
- 액션마다 상태 해시를 기록해 리플레이를 검증할 수 있다.
- 서버는 메시지 크기(16KB)·초당 요청 수·방/연결 수를 제한한다.
- 턴 제한 시간이 지나면 안전한 기본 액션을 자동 수행하고, 불가능하면 기권 처리한다.
- 재접속은 방 코드 + 1회용 비밀 토큰으로만 허용한다.
- 커스텀 덱은 서버가 7+3 구성과 카드 소속을 재검증하고, 상대에게 카드 목록을 숨긴다.

> 기본동작은 **턴당 1회 + 카드 효과로 얻는 추가 횟수**다. 원작처럼 자원이
> 허락하는 만큼 여러 번 수행하지 않는다. 자세한 내용은
> [docs/01_rules.md](docs/01_rules.md)의 5-2와 10-2 참고.

---

## 문서 지도

| 문서 | 내용 |
| --- | --- |
| [docs/01_rules.md](docs/01_rules.md) | 코어 룰, 턴 진행, 자원(오라·라이프·플레어·거리), 키워드 |
| [docs/02_roster.md](docs/02_roster.md) | 스트리머 14명 상세 (신장·무기·시그니처·궁합) |
| [docs/cards/00_index.md](docs/cards/00_index.md) | 카드 인덱스, 적정거리 기준표, 카드 읽는 법 |
| [docs/cards/01_everys.md](docs/cards/01_everys.md) | 1기 Everys 카드 22장 + 추천 덱 2개 |
| [docs/cards/02_universe.md](docs/cards/02_universe.md) | 2기 Universe 카드 44장 + 추천 덱 4개 |
| [docs/cards/03_cliche.md](docs/cards/03_cliche.md) | 3기 Cliché 카드 44장 + 추천 덱 4개 |
| [docs/cards/04_abyss.md](docs/cards/04_abyss.md) | 4기 ABYSS 카드 44장 + 추천 덱 4개 |
| [docs/04_balance_playtest.md](docs/04_balance_playtest.md) | 파워 예산과 밸런스 메모 |
| [docs/05_production_ip.md](docs/05_production_ip.md) | 제작 계획과 IP 주의사항 |
| [docs/changelog.md](docs/changelog.md) | 변경 이력 |

## 로스터 요약

| 기수 | 스트리머 | 적정거리 |
| --- | --- | --- |
| 1기 Everys | 아야츠노 유니, 사키하네 후야 | 3-5 / 2-6 |
| 2기 Universe | 시라유키 히나, 네네코 마시로, 아카네 리제, 아라하시 타비 | 5-8 / 0-3 / 2-4 / 2-5 |
| 3기 Cliché | 텐코 시부키, 아오쿠모 린, 하나코 나나, 유즈하 리코 | 1-4 / 3-6 / 3-6 / 1-4 |
| 4기 ABYSS | 시즈키 토아, 코가네 랑, 하나요 히요리, 토키노 메리 | 2-5 / 0-3 / 3-6 / 2-6 |

카드 총 **154장** (통상 98 + 비장 56). 14명 전원이 메인인 추천 덱 14개.

## 팬메이드 고지

비공식 팬메이드 프로젝트다. STELLIVE 및 각 스트리머와 무관하며, 공식 이미지·로고를
사용하지 않는다. 자세한 내용은 [docs/05_production_ip.md](docs/05_production_ip.md) 참고.
