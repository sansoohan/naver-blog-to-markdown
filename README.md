# Naver Blog to Markdown

네이버 블로그 게시글을 ****Markdown + 로컬 미디어 파일로 백업하는 Node.js 도구****입니다.

단일 게시글뿐 아니라 ****카테고리 단위 백업과 블로그 전체 백업****을 지원합니다.

단순히 본문 텍스트만 Markdown으로 바꾸는 것이 아니라, ****SmartEditor ONE의 문서 구조와 서식을 가능한 한 유지하는 것****을 목표로 합니다.

텍스트 스타일, 이미지, 첨부파일, 표, 인용구, 구분선, 소스코드, 링크, YouTube 영상, 네이버 동영상, OG 링크 카드 등을 분석하여 Markdown으로 표현할 수 있는 요소는 Markdown으로 변환하고, Markdown만으로 표현하기 어려운 요소는 HTML/CSS를 사용해 보존합니다.

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

#### 블로그 전체

블로그의 전체 게시글을 백업합니다.
```bash
npm run blog -- "https://blog.naver.com/BLOG_ID"
```

---

### 🔄 Incremental Backup

카테고리 및 전체 블로그 백업에서는 이미 백업한 게시글을 매번 다시 변환하지 않습니다.

게시글 본문의 hash를 `output/backup-cache.json`에 기록하고, 다음 백업에서 이전 hash와 비교합니다.

예:
```text
[1/1134] 게시글 제목
가져오는 중: BLOG_ID/LOG_NO
변경 없음: 건너뜀
```

백업 결과에서는 다음과 같이 상태를 확인할 수 있습니다.
```text
카테고리 백업 완료
전체: 1134
신규: 0
업데이트: 0
변경 없음: 1134
실패: 0
```

`backup-cache.json`은 게시글별로 별도 생성되는 것이 아니라 전체 백업 상태를 하나의 파일에 누적해서 관리합니다.
```text
output/
├── backup-cache.json
├── 카테고리1/
├── 카테고리2/
└── ...
```

---

### 🌐 Original HTML

각 게시글은 Markdown 변환 전에 `original.html`로 먼저 보존됩니다.
게시글에서 사용하는 SmartEditor Viewer CSS도 `se.viewer.desktop.css`로 함께 저장합니다.
```text
글번호_게시글 제목/
├── original.html
├── index.md
├── se.viewer.desktop.css
├── photo.jpg
├── video.mp4
└── download/
```

`original.html`과 `index.md`는 같은 로컬 미디어 파일을 공유합니다. Markdown 생성 단계에서는 이미지, 동영상, 첨부파일을 다시 다운로드하지 않습니다.

---

### 📝 Text & Formatting

SmartEditor ONE의 텍스트와 주요 인라인 서식을 보존합니다.

* 제목 및 본문
* 굵게
* 기울임
* 취소선
* 밑줄
* 글자색
* 글자 배경색
* 글자 크기
* 링크
* 체크박스
* 원문의 빈 줄
* 혼합 서식

Markdown으로 표현 가능한 서식은 가능한 한 Markdown 문법을 사용합니다.
```markdown
****굵게****
**기울임**
~~취소선~~
[링크](https://example.com)
- [ ] 체크박스
```

밑줄, 색상, 특수 글자 크기처럼 Markdown으로 표현할 수 없는 서식은 HTML을 사용합니다.
```html
<u>밑줄</u>
<span style="color:#ff0000">빨간 글자</span>
<span style="font-size:11px">11px 글자</span>
```

---

### 🔠 Font Size & Headings

네이버의 글자 크기를 분석하여 Markdown 제목 문법 또는 HTML로 변환합니다.

| Naver | Markdown      |
| ----: | :------------ |
|  11px | HTML `<span>` |
|  13px | 일반 본문         |
|  15px | `######`      |
|  16px | `#####`       |
|  19px | `####`        |
|  24px | `###`         |
|  28px | `##`          |
|  30px | `#`           |
|  34px | HTML `<span>` |
|  38px | HTML `<span>` |

한 문단 안에 여러 글자 크기가 섞여 있는 경우에는 Markdown heading으로 강제 변환하지 않고 각각의 크기를 HTML로 보존합니다.

---

### 🖼️ Images

게시글 이미지를 원격 URL에 의존하지 않고 ****로컬 파일로 다운로드****합니다.

```text
output/
└── 카테고리/
    └── 글번호_게시글 제목/
        ├── index.md
        ├── photo.jpg
        ├── image.png
        └── ...
```

Markdown/HTML에서는 로컬 파일을 참조합니다.
```markdown
![](./photo.jpg)
```

표시 크기가 필요한 경우:
```html
<img src="./photo.jpg" style="width:640px;max-width:100%;height:auto;">
```

---

### 📎 Attachments

게시글에 첨부된 파일을 ****로컬 파일로 다운로드****합니다.

첨부파일은 이미지나 동영상과 파일명이 충돌하지 않도록 게시글 폴더 내부의 `download/` 폴더에 별도로 저장합니다.
```text
글번호_게시글 제목/
├── index.md
├── photo.jpg
├── video.mp4
└── download/
    ├── 자료.zip
    ├── 문서.pdf
    └── 데이터.xlsx
```

---

### 💻 Source Code

SmartEditor ONE의 ****소스코드 컴포넌트****를 fenced code block으로 변환합니다.

예:
````markdown
```{se-l-default}
const message = "Hello World";
console.log(message);
```
````

---

### 🎬 YouTube

SmartEditor ONE에 삽입된 YouTube 영상을 보존합니다.

* 일반 YouTube 영상

* YouTube Shorts

* 시작 시간

* 원본 영상 ID

* iframe 임베드

예:
```html
<iframe src="https://www.youtube.com/embed/VIDEO_ID?start=65" ...></iframe>
```

게시글 내부의 SmartEditor 모듈 데이터를 분석하여 영상을 식별합니다.

---

### 🎥 Naver Video

네이버 블로그에 직접 삽입된 ****네이버 동영상도 로컬로 백업****합니다.
```text
video-001.mp4
video-thumb-001.jpg
```

Markdown에는 HTML5 `<video>`로 삽입합니다.
```html
<video controls style="width:100%;height:auto;" poster="./video-thumb-001.jpg">
  <source src="./video-001.mp4" type="video/mp4">
</video>
```

---

### 🔗 OG Link Cards

네이버의 링크 미리보기 카드

* 제목
* 설명
* 도메인
* 원본 링크
* 썸네일

---

### 📊 Tables

SmartEditor ONE 표를 분석하여 ****단순 표와 복잡한 표를 구분****합니다.

**단순 표**는 Markdown table로 변환합니다.

| 이름 | 값 |
| --- | --- |
| A | 100 |
| B | 200 |

**복잡한 표**는 원본의 병합 구조와 텍스트 서식을 유지하면서 HTML `<table>`형태로 변환합니다.

---

### 💬 Quote Cards

인용문과 출처(cite)를 별도로 보존하며, 원래 네이버 인용구 타입도 기록합니다.
```html
<div class="naver-quote" data-naver-quote-type="quotation_line"></div>
```

---

### ➖ Horizontal Lines

네이버 구분선은 일반 Markdown의 `---`로 단순 변환하지 않고 HTML/CSS 형태로 보존합니다.
```html
<div class="naver-hr naver-hr-line3 naver-hr-left" data-naver-line-type="line3" data-naver-align="left"></div>
```

---

## Conversion Strategy

게시글은 다음 순서로 처리합니다.

```text
Naver raw HTML
      ↓
debug-raw.html
      ↓
make-html.js
      ├─ 게시글 본문 추출
      ├─ 이미지 로컬화
      ├─ 네이버 동영상 로컬화
      ├─ 첨부파일 로컬화
      ├─ YouTube iframe 복원
      ├─ SmartEditor 구조 및 CSS 보존
      └─ HTML beautify
      ↓
original.html
      ↓
make-markdown.js
      ↓
index.md
```

`debug-raw.html`은 가장 최근에 가져온 네이버 원본 HTML을 확인하기 위한 디버그 파일이며 프로젝트 루트에 저장됩니다.

`original.html`을 보관용 기준 원본으로 두고, Markdown 변환은 이미 로컬화된 HTML을 기반으로 수행합니다.

따라서 `original.html`과 `index.md`가 같은 이미지, 네이버 동영상, 첨부파일을 공유하며 Markdown 생성 단계에서 같은 미디어를 다시 다운로드하지 않습니다.

Markdown 변환 자체는 **Markdown-first** 방식입니다.

Markdown으로 표현할 수 있는 것은 Markdown을 사용합니다.

```markdown
**bold**
*italic*
~~strike~~
[link](URL)
# heading
- [ ] task
```

소스코드 역시 Markdown fenced code block을 사용합니다.

````markdown
```{se-l-default}
const value = 100;
```
````

Markdown으로 정확하게 표현할 수 없는 경우에만 HTML을 사용합니다.

```html
<u>underline</u>
<span style="color:...">...</span>
<table>...</table>
<iframe ...></iframe>
<video ...></video>
```

따라서 모든 내용을 HTML로 감싸는 방식보다 Markdown 자체의 가독성과 편집 가능성을 유지하면서 네이버 고유 요소도 함께 보존할 수 있습니다.

---

## Installation

### Requirements

* Node.js

* npm

저장소를 클론합니다.
```bash
git clone https://github.com/sansoohan/naver-blog-to-markdown.git

cd naver-blog-to-markdown
```

의존성을 설치합니다.
```bash
npm install
```

---

## Usage

### 단일 게시글 백업
```bash
npm run page -- "https://blog.naver.com/BLOG_ID/LOG_NO"
```

### 카테고리 백업

카테고리명을 직접 지정할 수 있습니다.
```bash
npm run category -- "https://blog.naver.com/BLOG_ID" "카테고리명"
```

### 블로그 전체 백업
```bash
npm run blog -- "https://blog.naver.com/BLOG_ID"
```

---

## Output

변환 결과는 `output` 폴더 아래에 저장됩니다.
```text
output/
├── backup-cache.json
├── 카테고리1/
│   ├── LOG_NO_게시글 제목/
│   │   ├── original.html
│   │   ├── index.md
│   │   ├── se.viewer.desktop.css
│   │   ├── photo.jpg
│   │   ├── video.mp4
│   │   └── download/
│   │       └── 자료.zip
│   └── ...
├── 카테고리2/
│   └── ...
└── .tmp/
```

`backup-cache.json` 에는 게시글별 hash와 백업 정보가 저장됩니다.

```json
{
  "BLOG_ID/LOG_NO": {
    "hash": "...",
    "modifiedAt": null,
    "title": "게시글 제목",
    "category": "카테고리",
    "path": "output/카테고리/LOG_NO_게시글 제목",
    "backedUpAt": "..."
  }
}
```

---

## Project Structure

주요 변환 로직은 기능별로 분리되어 있습니다.
```text
naver-blog-to-markdown/
├── backup-page.js
├── backup-category.js
├── backup-blog.js
├── src/
│   ├── attachment.js
│   ├── paragraph.js
│   ├── image.js
│   ├── table.js
│   ├── quote.js
│   ├── horizontal-line.js
│   ├── video.js
│   └── code.js
└── output/
    └── backup-cache.json
```

| File                 | Role                                 |
| -------------------- | ------------------------------------ |
| `backup-page.js`     | 단일 게시글 가져오기, 변환 흐름, hash 및 캐시 관리     |
| `backup-category.js` | 카테고리 탐색 및 카테고리 단위 백업                 |
| `backup-blog.js`     | 블로그 전체 게시글 백업                        |
| `make-html.js` | 게시글 본문 추출, 리소스 로컬화 및 `original.html` 생성 |
| `make-markdown.js` | `original.html`을 기반으로 `index.md` 생성 |
| `attachment.js`      | 첨부파일 탐지, 다운로드 및 로컬 링크 변환             |
| `paragraph.js`       | 텍스트, 글자 크기, 인라인 서식, 링크, 체크박스         |
| `image.js`           | 이미지 다운로드, 중복 방지, 고해상도 이미지 및 표시 크기 처리 |
| `table.js`           | Markdown/HTML 표 변환                   |
| `quote.js`           | 네이버 인용구 카드                           |
| `horizontal-line.js` | 네이버 구분선 타입 및 정렬 보존                   |
| `video.js`           | YouTube 및 네이버 동영상                    |
| `code.js`            | 네이버 소스코드 컴포넌트 및 디자인 클래스 변환           |

---

## Design Goals

### 1. 원본 구조 보존

SmartEditor ONE의 실제 DOM과 모듈 정보를 분석하여 원본 게시글의 의미와 구조를 최대한 유지합니다.

### 2. Markdown 우선

Markdown으로 표현할 수 있는 요소를 불필요하게 HTML로 변환하지 않습니다.

### 3. 로컬 백업

이미지, 동영상, 첨부파일 등 중요한 파일을 가능한 한 로컬에 저장하여 네이버의 원격 리소스에 대한 의존성을 줄입니다.

`original.html`과 `index.md`는 같은 로컬 미디어 파일을 공유하여 동일한 파일을 HTML용과 Markdown용으로 중복 다운로드하지 않습니다.

### 4. 증분 백업

이미 백업한 게시글은 본문 hash를 비교하여 변경된 경우에만 다시 백업합니다.

대량의 카테고리나 블로그 전체를 반복해서 백업할 때 불필요한 변환 및 미디어 다운로드를 줄이는 것을 목표로 합니다.

### 5. 안전한 업데이트

새로운 백업을 임시 폴더에 먼저 완성한 뒤 기존 백업과 교체하여 작업 중 오류로 기존 백업이 손상될 가능성을 줄입니다.

### 6. 중복 파일 최소화

동일한 URL의 이미지, 썸네일, 동영상, 첨부파일이 반복해서 사용되는 경우에는 기존에 다운로드한 파일을 재사용합니다.

### 7. 원본 정보 보존

Markdown에서 직접 표현할 수 없는 네이버 고유 컴포넌트는 `data-naver-*` 메타데이터 등을 사용하여 원래 타입을 식별할 수 있도록 합니다.

소스코드처럼 Markdown으로 표현할 수 있지만 네이버 고유 디자인 정보가 존재하는 경우에는 fence info string 등에 원래 클래스 정보를 보존합니다.

향후 Markdown → Naver 형태의 ****역방향 변환 가능성****도 고려한 구조입니다.

---

## Limitations

### Markdown 뷰어마다 다르게 렌더링될 수 있습니다

생성되는 index.md는 일반 Markdown 문법뿐 아니라 원본 네이버 블로그의 구조와 디자인을 보존하기 위해 일부 HTML, CSS 및 확장된 fenced code block 문법을 함께 사용합니다.

따라서 사용하는 Markdown 뷰어의 기능과 보안 정책에 따라 다음 요소의 표시 결과가 달라질 수 있습니다.

```
HTML 태그 — <span>, <u>, <table>, <div> 등의 HTML 렌더링 여부
인라인 CSS — 글자색, 배경색, 글자 크기, 이미지 크기 등의 스타일 적용 여부
<style> 태그 — 인용구, 구분선 등 네이버 고유 디자인을 위한 CSS 적용 여부
HTML Table — rowspan, colspan, 셀 정렬 등 복잡한 표의 표시 방식
YouTube iframe — <iframe> 허용 여부에 따른 YouTube 영상 표시 여부
HTML5 Video — <video> 및 <source> 지원 여부에 따른 로컬 동영상 재생 여부
로컬 파일 링크 — 이미지, 동영상, 첨부파일 등 상대 경로로 연결된 파일의 접근 가능 여부
Code Block — {se-l-default}, {se-l-code_stripe}, {se-l-code_black} 등의 info string 처리 방식
체크박스 — - [ ] 문법의 Task List 지원 여부
Markdown과 HTML 혼합 — HTML 내부의 Markdown을 다시 해석하는 방식의 차이
CSS Sprite — 구분선 등 외부 CSS 이미지 리소스를 사용하는 요소의 표시 여부
```

특히 GitHub, VS Code, Obsidian, 일반 Markdown 편집기, 브라우저 기반 Markdown 뷰어 등은 HTML/CSS 허용 범위가 서로 다르므로 index.md의 화면이 완전히 동일하지 않을 수 있습니다.
