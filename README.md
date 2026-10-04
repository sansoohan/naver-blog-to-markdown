# Naver Blog to Markdown

네이버 블로그 글을 **Markdown, 원본 HTML, 로컬 이미지·동영상·첨부파일**로 백업하는 Node.js 도구입니다.

단일 글, 카테고리, 블로그 전체 백업을 지원하며, 본인 계정으로 로그인하면 비공개 글도 백업할 수 있습니다.

## 설치

Node.js 20 이상이 필요합니다.

```bash
git clone https://github.com/sansoohan/naver-blog-to-markdown
cd naver-blog-to-markdown
npm install
```

비공개 글도 백업하려면 Chromium을 추가로 설치합니다.

```bash
npx playwright install chromium
```

## 백업 방식

```bash
# 일반공개 글만
npm run page -- "https://blog.naver.com/[네이버ID]/[포스팅번호]"                 # 단일 글
npm run category -- "https://blog.naver.com/[네이버ID]" "[카테고리명]"           # 카테고리 전체 글
npm run blog -- "https://blog.naver.com/[네이버ID]"                            # 모든 글

# 비공개 글 포함
npm run page -- "https://blog.naver.com/[네이버ID]/[포스팅번호]" --private       # 단일 글
npm run category -- "https://blog.naver.com/[네이버ID]" "[카테고리명]" --private # 카테고리 전체 글
npm run blog -- "https://blog.naver.com/[네이버ID]" --private                  # 모든 글

# 수정된 글만 다시 백업
npm run category -- "https://blog.naver.com/[네이버ID]" "[카테고리명]" --update  # 업데이트된 카테고리 글
npm run blog -- "https://blog.naver.com/[네이버ID]" --update                   # 업데이트된 모든 글

############### 개발자용 커멘드 ###############

# 글(html/md)만 새로 작성하고 리소스(mp4/css/zip/jpg 등)는 재활용
npm run page -- "https://blog.naver.com/[네이버ID]/[포스팅번호]" --cache       # 단일 글
npm run category -- "https://blog.naver.com/[네이버ID]" "[카테고리명]" --cache # 카테고리 전체 글
npm run blog -- "https://blog.naver.com/[네이버ID]" --cache                  # 모든 글
```

처음 `--private` 실행 시 Chromium 창에서 직접 로그인합니다. 로그인 정보는 `.auth/naver-storage-state.json`에 저장되며, 유효한 동안 다음 실행에서는 재로그인하지 않습니다. 네이버 인증 정보를 초기화하거나 다른 계정으로 다시 로그인하기 위해서는 `.auth/` 폴더를 삭제해야 합니다.

`--update`는 기존에 백업된 글도 실제로 변경되었는지 확인해야 하므로, 글이 많을 경우 확인하는 데 시간이 어느 정도 걸릴 수 있습니다. 변경되지 않은 글은 다시 백업하지 않습니다.

## 출력 폴더 구조

```text
output/
└── [네이버ID]/
    ├── backup-cache.json                 # 해당 블로그의 변경 여부 기록(도중에 이어서 백업)
    ├── categories.json                   # 해당 블로그의 카테고리 정보
    └── 상위 카테고리/
        └── 하위 카테고리/
            └── 123456789_게시글 제목/
                ├── index.md              # 변환된 Markdown
                ├── original.html         # 로컬 미디어 경로로 정리된 원본 HTML
                ├── PostView.css          # SmartEditor 1.x·2.x용 CSS
                ├── se.viewer.desktop.css # SmartEditor 3.x 이상용 CSS
                ├── image.png             # 글의 로컬 이미지
                ├── video.mp4             # 글의 로컬 동영상
                └── download/             # 첨부파일
                    └── 자료.zip
```

### 출력 폴더 변경

`--output` 옵션을 사용하면 백업 결과를 저장할 output 폴더를 직접 지정할 수 있습니다. 상대 경로와 절대 경로를 모두 사용할 수 있으며, 지정하지 않으면 기본 output/ 폴더에 저장됩니다.

```
npm run blog -- "https://blog.naver.com/[네이버ID]" --output "./backup"
```

## 동시 백업

여러 터미널에서 동시에 백업을 실행할 수 있습니다.(단, --private 은 하나만 가능)

첫 번째 실행 시 출력되는 세션 ID를 다른 터미널에서 `--session` 또는 `-s`로 지정하면 같은 세션으로 작업합니다. 같은 세션에서는 게시글별 작업 상태를 공유하기에, 여러 프로세스가 같은 게시글을 중복으로 백업하지 않습니다.

터미널 1:

```bash
npm run b -- https://blog.naver.com/sansoo2002
```

```text
세션 ID: 20261004-181217
```

터미널 2:

```bash
npm run b -- https://blog.naver.com/sansoo2002 -s 20261004-181217
```

## 지원 에디터

| 에디터 | 본문 영역 | 저장 CSS |
| --- | --- | --- |
| SmartEditor 1.x | `#postViewArea`, `.post-view`, `.view` | `PostView.css` |
| SmartEditor 2.x | `#postViewArea`, `.post-view`, `.se3_view` | `PostView.css` |
| SmartEditor 3.x | `.se-viewer`, `.se-main-container` | `se.viewer.desktop.css` |
| SmartEditor 4.x (SmartEditor ONE) | `.wrap_rabbit`, `.se-viewer`, `.se-main-container` | `se.viewer.desktop.css` |


에디터 버전은 게시글 HTML에서 자동으로 판별합니다.

## 변환 범위

다음 요소를 Markdown 또는 필요한 경우 HTML로 보존합니다.

- 제목, 문단, 빈 줄, 목록, 링크, 체크박스
- 굵게, 기울임, 취소선, 밑줄, 글자색·배경색·크기
- 이미지, 동영상, 첨부파일
- 표, 인용구, 구분선, 소스코드
- YouTube·네이버 동영상, OG 링크 카드
- 외부 에디터에서 붙여 넣은 복잡한 HTML 서식

Markdown으로 안전하게 표현할 수 없는 표·색상·복잡한 코드블록·인라인 서식은 HTML로 남겨 원본 모양을 최대한 유지합니다.

## 폰트 크기 변환

네이버 블로그의 폰트 크기는 Markdown 제목 크기에 맞춰 다음 범위로 변환합니다.

| 네이버 폰트 크기 | Markdown |
|---:|---|
| 8–9 | `######` |
| 10–11 | `#####` |
| 12–14 | 본문 |
| 15–17 | `###` |
| 18–24 | `##` |
| 25–34 | `#` |
| 그 외 | 원래 폰트 크기 유지 |

네이버 에디터에서 실제로 사용되는 대표 폰트 크기는 다음과 같습니다.

| 네이버 폰트 크기 | 변환 |
|---:|---|
| 11 | `#####` |
| 13 | 본문 |
| 15, 16 | `###` |
| 19, 24 | `##` |
| 28, 34 | `#` |
| 38 | 원래 폰트 크기 유지 |

범위 밖의 폰트 크기는 Markdown 제목으로 변환하지 않고
`<span style="font-size:...px">` 형태로 원래 크기를 보존.

변환 범위는 `font-size-rules.json`에서 관리.

## [백업 결과 확인 도구](./test/README.md)

백업 결과의 `original.html`과 `index.md` 렌더링 결과를 나란히 비교하는 도구입니다.

![검색 및 페이지 보기](https://github.com/sansoohan/naver-blog-to-markdown/releases/download/readme-gifs-1.4.1/2_._._._3fps.gif)


처음 한 번만 QA 도구의 의존성을 설치합니다.

```bash
npm install --prefix test
npm install --prefix test/server
```

백업 결과 확인 도구를 실행합니다.

```bash
npm run test
```

클라이언트와 서버가 함께 실행됩니다. 터미널에 표시된 주소(기본 `http://localhost:5173`)를 브라우저에서 엽니다.

`output` 폴더에 백업된 게시글이 있어야 목록에 표시됩니다.

### 백업 결과 폴더 변경

`--output` 옵션을 사용하면 백업 결과 폴더를 직접 지정할 수 있습니다. 상대 경로와 절대 경로를 모두 사용할 수 있으며, 지정하지 않으면 기본 `output` 폴더를 읽어들입니다.

```
npm run test -- --output "./backup"
```