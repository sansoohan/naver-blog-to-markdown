# Naver Blog to Markdown

네이버 블로그 글을 **Markdown, 원본 HTML, 로컬 이미지·동영상·첨부파일**로 백업하는 Node.js 도구입니다.

단일 글, 카테고리, 블로그 전체 백업을 지원하며, 본인 계정으로 로그인하면 비공개 글도 백업할 수 있습니다.

## 설치

Node.js 20 이상이 필요합니다.

```bash
git clone REPOSITORY_URL
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
```

처음 `--private` 실행 시 Chromium 창에서 직접 로그인합니다. 로그인 정보는 `.auth/naver-storage-state.json`에 저장되며, 유효한 동안 다음 실행에서는 재로그인하지 않습니다. 네이버 인증 정보를 초기화하거나 다른 계정으로 다시 로그인하기 위해서는 `.auth/` 폴더를 삭제해야 합니다.

## 출력 폴더 구조

```text
output/
├── backup-cache.json                 # 전체·카테고리 백업의 변경 여부 기록(도중에 이어서 백업)
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

## 지원 에디터

| 에디터 | 본문 영역 | 저장 CSS |
| --- | --- | --- |
| SmartEditor 1.x | `#postViewArea`, `.post-view`, `.view` | `PostView.css` |
| SmartEditor 2.x | `#postViewArea`, `.post-view`, `.se3_view` | `PostView.css` |
| SmartEditor 3.x 이상 | `.se-viewer`, `.se-main-container` | `se.viewer.desktop.css` |

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

## QA 테스터

백업 결과의 `original.html`과 `index.md` 렌더링 결과를 나란히 비교하는 도구입니다.

처음 한 번만 QA 도구의 의존성을 설치합니다.

```bash
npm install --prefix test
npm install --prefix test/server
```

QA 테스터를 실행합니다.

```bash
npm run test:gui
```

클라이언트와 서버가 함께 실행됩니다. 터미널에 표시된 주소(기본 `http://localhost:5173`)를 브라우저에서 엽니다.

`output/` 폴더에 백업된 게시글이 있어야 목록에 표시됩니다.
