# Naver Blog to Markdown

네이버 블로그 게시글을 **Markdown + Original HTML + 로컬 미디어 파일**로 백업하는 Node.js 도구입니다.

단일 게시글뿐 아니라 **카테고리 단위 백업과 블로그 전체 백업**을 지원합니다.

본인 네이버 계정으로 로그인하면 **나만 볼 수 있는 비공개 게시글**도 백업할 수 있습니다.

네이버 블로그에서 사용된 다음 에디터를 지원합니다.

| 에디터 버전 | 본문 구조 | 저장되는 Viewer CSS |
| --- | --- | --- |
| SmartEditor 1.x | `#postViewArea`, `.post-view`, `.view` | `PostView.css` |
| SmartEditor 2.x | `#postViewArea`, `.post-view`, `.se3_view` | `PostView.css` |
| SmartEditor 3.x 이상 | `.se-viewer`, `.se-main-container` | `se.viewer.desktop.css` |

에디터 버전을 게시글 HTML에서 자동으로 판별하고, 각 버전의 본문 구조와 Viewer CSS를 가능한 한 유지합니다.

단순히 본문 텍스트만 Markdown으로 바꾸는 것이 아니라 텍스트 스타일, 이미지, 첨부파일, 표, 인용구, 구분선, 소스코드, 링크, YouTube 영상, 네이버 동영상, OG 링크 카드 등을 분석합니다.

Markdown으로 표현할 수 있는 요소는 Markdown으로 변환하고, Markdown만으로 표현하기 어려운 요소와 외부 에디터에서 붙여 넣은 복잡한 HTML 서식은 HTML/CSS로 보존합니다.

---

## Installation

### 요구 사항

- Node.js 20 이상 권장
- npm
- 비공개 게시글 백업 시 Playwright Chromium
- Windows, macOS 또는 Linux

Node.js가 설치되어 있는지 확인합니다.

```bash
node --version
npm --version
```

### 프로젝트 설치

저장소를 내려받은 후 프로젝트 폴더로 이동합니다.

```bash
git clone REPOSITORY_URL
cd naver-blog-to-markdown
```

의존성을 설치합니다.

```bash
npm install
```

비공개 게시글도 백업하려면 Playwright Chromium을 설치합니다.

```bash
npx playwright install chromium
```

공개 게시글만 백업하는 경우에는 Chromium을 사용할 일이 없지만, 나중에 `--private` 옵션을 사용할 예정이라면 미리 설치해도 됩니다.

### npm 명령 확인

`package.json`에 다음 명령이 등록되어 있어야 합니다.

```json
{
  "scripts": {
    "page": "node backup-page.js",
    "category": "node backup-category.js",
    "blog": "node backup-blog.js"
  }
}
```

---

## Features

### 📦 Backup Modes

3가지 백업 방식을 지원합니다.

#### 단일 게시글

특정 게시글 하나를 백업합니다.

```bash
npm run page -- "https://blog.naver.com/BLOG_ID/LOG_NO"
```

단일 게시글 백업은 캐시 상태와 관계없이 해당 게시글을 다시 변환합니다.

#### 카테고리 전체

특정 카테고리의 게시글을 백업합니다.

```bash
npm run category -- "https://blog.naver.com/BLOG_ID" "카테고리명"
```

상위 카테고리를 선택한 경우 해당 카테고리에 포함된 하위 카테고리의 게시글도 함께 백업됩니다.

카테고리 계층은 출력 폴더에도 그대로 반영됩니다.

```text
output/
└── 상위 카테고리/
    └── 하위 카테고리/
        └── LOG_NO_게시글 제목/
```

#### 블로그 전체

블로그의 전체 게시글을 백업합니다.

```bash
npm run blog -- "https://blog.naver.com/BLOG_ID"
```

---

### 🧩 Editor Compatibility

게시글별 에디터 버전을 자동으로 확인하여 각 에디터에 맞는 본문 추출 및 CSS 처리를 적용합니다.

| 에디터 | 본문 구조 | 저장되는 Viewer CSS |
| --- | --- | --- |
| SmartEditor 1.0 | `#postViewArea`, `.post-view`, `.view` | `PostView.css` |
| SmartEditor 2.0 | `#postViewArea`, `.post-view`, `.se3_view` | `PostView.css` |
| SmartEditor ONE | `.se-viewer`, `.se-main-container` | `se.viewer.desktop.css` |

SmartEditor 1.0과 2.0에서는 `PostView.css`가 적용되도록 `#post-area`, `#postViewArea`, `.post-view` 등의 원본 래퍼 구조를 보존합니다.

SmartEditor ONE에서는 `.se-viewer`, `.se-main-container`, `.se-component`, `.se-module` 등의 문서 구조를 보존합니다.

에디터 버전에 따라 서로 다른 이미지 저장 형식도 처리합니다.

- `src`
- `data-src`
- `data-lazy-src`
- `data-original`
- `data-origin-src`
- `srcset`
- `blogfiles.pstatic.net`
- `postfiles.pstatic.net`
- `dthumb-phinf.pstatic.net` 프록시 이미지
- 외부 이미지 URL

다운로드 가능한 주소 후보를 순서대로 확인하고, 실제 이미지 응답이 확인된 주소를 사용합니다.

외부 웹이나 다른 에디터에서 붙여 넣은 복잡한 HTML 블록도 가능한 한 원본 HTML로 보존합니다.

---

### 🔐 Private Posts

본인 네이버 계정으로 로그인하면 **나만 볼 수 있는 비공개 게시글**도 백업할 수 있습니다.

프로그램에 네이버 아이디나 비밀번호를 입력할 필요는 없습니다. Playwright가 실행한 Chromium 브라우저에서 사용자가 직접 로그인합니다.

각 명령에 `--private` 옵션을 추가합니다.

#### 단일 비공개 게시글

```bash
npm run page -- "https://blog.naver.com/BLOG_ID/LOG_NO" --private
```

#### 비공개 글을 포함한 카테고리 백업

```bash
npm run category -- "https://blog.naver.com/BLOG_ID" "카테고리명" --private
```

#### 비공개 글을 포함한 전체 블로그 백업

```bash
npm run blog -- "https://blog.naver.com/BLOG_ID" --private
```

#### 최초 로그인

`--private`을 처음 사용하거나 저장된 인증이 만료된 경우 Chromium 브라우저가 실행됩니다.

```text
네이버 로그인이 필요합니다.
브라우저에서 로그인해주세요.
로그인이 완료될 때까지 기다리는 중...
네이버 인증 정보 저장 완료
```

실행된 브라우저에서 본인 네이버 계정으로 로그인합니다.

로그인이 확인되면 필요한 쿠키와 인증 정보가 `.auth/` 폴더에 저장되고 로그인용 브라우저는 자동으로 종료됩니다.

이후 실제 게시글 백업은 브라우저 자동 조작이 아니라 저장된 인증 정보를 포함한 HTTP 요청으로 처리됩니다.

#### 저장된 인증 재사용

저장된 인증이 유효하면 다음 실행부터 로그인 브라우저가 나타나지 않습니다.

```text
저장된 네이버 인증 정보를 확인합니다.
저장된 네이버 인증 정보를 사용합니다.
```

인증이 만료되면 브라우저가 다시 실행되며, 로그인 후 새로운 인증 정보가 저장됩니다.

#### 다른 계정으로 다시 로그인

저장된 인증을 초기화하려면 `.auth/` 폴더를 삭제합니다.

Git Bash, macOS 또는 Linux:

```bash
rm -rf .auth
```

Windows PowerShell:

```powershell
Remove-Item -Recurse -Force .auth
```

그다음 `--private` 명령을 다시 실행하면 로그인 브라우저가 나타납니다.

#### 인증 정보 주의사항

`.auth/`에는 로그인 상태를 유지하는 인증 정보가 들어 있으므로 외부에 공유하면 안 됩니다.

`.gitignore`에 다음 항목을 추가해야 합니다.

```gitignore
.auth/
```

네이버 아이디와 비밀번호 자체는 프로그램에 입력하거나 별도 파일로 저장하지 않습니다.

---

### 🌐 Original HTML

각 게시글은 Markdown 변환 전에 `original.html`로 먼저 보존됩니다.

게시글에서 사용하는 Viewer CSS도 에디터 버전에 따라 함께 저장합니다.

```text
LOG_NO_게시글 제목/
├── original.html
├── index.md
├── PostView.css
├── se.viewer.desktop.css
├── photo.jpg
├── video.mp4
└── download/
```

실제로는 해당 게시글의 에디터에서 사용하는 CSS 파일만 생성됩니다.

- SmartEditor 1.0·2.0: `PostView.css`
- SmartEditor ONE: `se.viewer.desktop.css`

`original.html`과 `index.md`는 같은 로컬 미디어 파일을 공유합니다.

Markdown 생성 단계에서는 이미지, 동영상, 첨부파일을 다시 다운로드하지 않습니다.

`original.html`에서는 본문 전체를 HTML 정리 과정으로부터 보호하여 다음 내용을 가능한 한 유지합니다.

- 원본 본문 구조
- 인라인 스타일
- 코드 들여쓰기
- `white-space: pre`
- 외부 에디터에서 붙여 넣은 HTML
- 표 및 중첩 요소
- 글자별 색상과 배경색

---

### 📝 Markdown Conversion

Markdown으로 안정적으로 표현할 수 있는 요소는 Markdown 문법으로 변환합니다.

- 제목
- 본문
- 굵게
- 기울임
- 취소선
- 링크
- 체크박스
- 이미지
- 목록
- 인용문
- 소스코드

Markdown만으로 원본 구조를 표현하기 어려운 요소는 HTML로 보존합니다.

- 밑줄
- 글자색
- 글자 배경색
- 특수 글자 크기
- 병합된 표
- 복잡한 링크 카드
- 외부 에디터에서 붙여 넣은 코드블록
- 복잡한 인라인 HTML 서식

예:

```html
<u>밑줄</u>
<span style="color:#ff0000">빨간 글자</span>
<span style="font-size:11px">11px 글자</span>
```

HTML 블록과 다음 Markdown 요소가 붙어서 렌더링되지 않는 문제를 막기 위해 `<br>` 묶음 바로 아래에는 빈 줄을 추가합니다.

```markdown
<br>
<br>

![](./image.png)
```

이렇게 하면 `<br>` 다음에 나오는 이미지, 목록, 표, 인용문, 소스코드 등이 정상적으로 렌더링됩니다.

---

### 🖼️ Images

게시글 이미지를 원격 URL에 의존하지 않고 **로컬 파일로 다운로드**합니다.

```text
output/
└── 카테고리/
    └── LOG_NO_게시글 제목/
        ├── index.md
        ├── image.png
        ├── image_2.png
        └── ...
```

Markdown과 HTML에서는 같은 로컬 파일을 참조합니다.

```markdown
![](./image.png)
```

표시 크기나 인라인 스타일을 보존해야 하는 경우에는 HTML을 사용합니다.

```html
<img src="./image.png" style="width:640px;max-width:100%;height:auto;">
```

---

### 💻 Source Code

SmartEditor ONE의 소스코드 컴포넌트는 fenced code block으로 변환합니다.

````markdown
```{se-l-default}
const message = "Hello World";

console.log(message);
```
