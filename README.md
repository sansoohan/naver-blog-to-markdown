# Naver Blog to Markdown

네이버 블로그 게시글을 **Markdown + 로컬 미디어 파일로 백업하는 Node.js 도구**입니다.

단순히 본문 텍스트만 Markdown으로 바꾸는 것이 아니라, **SmartEditor ONE의 문서 구조와 서식을 가능한 한 유지하는 것**을 목표로 합니다.

텍스트 스타일, 이미지, 표, 인용구, 구분선, 링크, YouTube 영상, 네이버 동영상, OG 링크 카드 등을 분석하여 Markdown으로 표현할 수 있는 요소는 Markdown으로 변환하고, Markdown만으로 표현하기 어려운 요소는 HTML/CSS를 사용해 보존합니다.

---

## Features

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
**굵게**
*기울임*
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

| Naver | Markdown      |
| ----: | :------------ |
|  11px | HTML `<span>` |
|  13px | 일반 본문         |
|  15px | `######`      |
|  16px | `#####`       |
|  19px | `####`        |
|  24px | `###`         |
|  28px | `##`          |
|  30px | `#`           |
|  34px | HTML `<span>` |
|  38px | HTML `<span>` |

한 문단 안에 여러 글자 크기가 섞여 있는 경우에는 Markdown heading으로 강제 변환하지 않고 각각의 크기를 HTML로 보존합니다.

---

### 🖼️ Images

게시글 이미지를 원격 URL에 의존하지 않고 **로컬 파일로 다운로드**합니다.

가능한 경우 네이버의 고해상도 이미지(`w2000`)를 가져오며, 원문의 표시 너비도 함께 보존합니다.

```text
output/
└── 카테고리/
    └── 게시글 제목/
        ├── index.md
        ├── image-001.jpg
        ├── image-002.png
        └── image-003.jpg
```

Markdown/HTML에서는 로컬 파일을 참조합니다.

```markdown
![](./image-001.jpg)
```

표시 크기가 필요한 경우:

```html
<img src="./image-001.jpg" style="width:640px;max-width:100%;height:auto;">
```

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

네이버 블로그에 직접 삽입된 **네이버 동영상도 로컬로 백업**합니다.

VOD 정보를 조회하여 사용할 수 있는 MP4 중 높은 품질의 영상을 선택하고, 썸네일도 함께 저장합니다.

```text
video-001.mp4
video-thumb-001.jpg
```

Markdown에는 HTML5 `<video>`로 삽입합니다.

```html
<video controls style="width:100%; height:auto;" poster="./video-thumb-001.jpg">
  <source src="./video-001.mp4" type="video/mp4">
</video>
```

---

### 🔗 OG Link Cards

네이버의 링크 미리보기 카드도 보존합니다.

* 제목
* 설명
* 도메인
* 원본 링크
* 썸네일

썸네일은 로컬에 다운로드됩니다.

```text
thumb-001.jpg
```

Markdown만으로 카드 UI를 표현하기 어려우므로 간단한 HTML table 형태로 변환합니다.

---

### 📊 Tables

SmartEditor ONE 표를 분석하여 **단순 표와 복잡한 표를 구분**합니다.

병합과 별도 정렬이 없는 일반적인 표는 Markdown table로 변환합니다.

```markdown
| 이름 | 값 |
| --- | --- |
| A | 100 |
| B | 200 |
```

다음과 같이 Markdown table로 정확히 표현할 수 없는 표는 HTML `<table>`로 보존합니다.

* `rowspan`
* `colspan`
* 셀별 정렬
* 복잡한 셀 구조

복잡한 표는 네이버의 불필요한 배경 스타일을 제거하고, Markdown 문서와 어울리는 단순한 선 형태로 정리하면서 원본의 병합 구조와 텍스트 서식은 유지합니다.

---

### 💬 Quote Cards

SmartEditor ONE의 **6가지 인용구 타입**을 구분하여 보존합니다.

```text
quotation_line
quotation_underline
default
quotation_bubble
quotation_postit
quotation_corner
```

인용문과 출처(cite)를 별도로 보존하며, 역방향 변환을 고려해 원래 네이버 인용구 타입도 기록합니다.

```html
<div class="naver-quote" data-naver-quote-type="quotation_line">
  ...
</div>
```

---

### ➖ Horizontal Lines

SmartEditor ONE의 **8가지 구분선 타입**을 지원합니다.

```text
default
line1
line2
line3
line4
line5
line6
line7
```

네이버 구분선은 일반 Markdown의 `---`와 디자인과 여백 구조가 다르기 때문에 Markdown HR로 단순 변환하지 않습니다.

대신 네이버의 실제 스타일 정보를 기반으로 HTML/CSS 형태로 보존합니다.

```html
<div class="naver-hr naver-hr-line3" data-naver-line-type="line3">
  ...
</div>
```

게시글에 실제로 사용된 구분선 타입의 CSS만 Markdown에 포함됩니다.

---

## Conversion Strategy

이 프로젝트는 **Markdown-first** 방식으로 변환합니다.

Markdown으로 표현할 수 있는 것은 Markdown을 사용합니다.

```markdown
**bold**
*italic*
~~strike~~
[link](URL)
# heading
- [ ] task
```

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

네이버 블로그 게시글 URL을 전달합니다.

```bash
node ./main.js <네이버 블로그 게시글 URL>
```

예:

```bash
node ./main.js https://blog.naver.com/sansoo2002/224289001583
```

게시글 URL은 다음과 같은 일반적인 네이버 블로그 주소 형식을 사용할 수 있습니다.

```text
https://blog.naver.com/BLOG_ID/LOG_NO
```

---

## Output

변환 결과는 기본적으로 `output` 폴더 아래에 저장됩니다.

```text
output/
└── 카테고리/
    └── 게시글 제목/
        ├── index.md
        ├── image-001.jpg
        ├── image-002.jpg
        ├── thumb-001.jpg
        ├── video-001.mp4
        └── video-thumb-001.jpg
```

`index.md` 상단에는 게시글 제목과 원본 주소가 기록됩니다.

```markdown
# 게시글 제목

> 원본: https://blog.naver.com/BLOG_ID/LOG_NO

본문...
```

---

## Project Structure

주요 변환 로직은 기능별로 분리되어 있습니다.

```text
naver-blog-to-markdown/
├── main.js
├── src/
│   ├── paragraph.js
│   ├── table.js
│   ├── quote.js
│   ├── horizontal-line.js
│   └── video.js
├── output/
├── package.json
└── README.md
```

| File                 | Role                         |
| -------------------- | ---------------------------- |
| `main.js`            | 게시글 가져오기 및 전체 변환 흐름          |
| `paragraph.js`       | 텍스트, 글자 크기, 인라인 서식, 링크, 체크박스 |
| `table.js`           | Markdown/HTML 표 변환           |
| `quote.js`           | 네이버 인용구 카드                   |
| `horizontal-line.js` | 네이버 구분선                      |
| `video.js`           | YouTube 및 네이버 동영상            |

---

## Markdown Preview

생성된 Markdown은 표준 Markdown 외에도 일부 raw HTML을 포함할 수 있습니다.

```html
<span>
<table>
<iframe>
<video>
<style>
```

따라서 사용하는 Markdown 뷰어에 따라 일부 요소의 표시 결과가 달라질 수 있습니다.

특히 YouTube iframe, `<video>`, `<style>`, HTML table, inline CSS 등은 Markdown 뷰어의 HTML/WebView 지원 수준에 영향을 받을 수 있습니다.

---

## Design Goals

### 1. 원본 구조 보존

SmartEditor ONE의 실제 DOM과 모듈 정보를 분석하여 원본 게시글의 의미와 구조를 최대한 유지합니다.

### 2. Markdown 우선

Markdown으로 표현할 수 있는 요소를 불필요하게 HTML로 변환하지 않습니다.

### 3. 로컬 백업

이미지와 동영상 등 중요한 미디어를 가능한 한 로컬에 저장하여 네이버의 원격 리소스에 대한 의존성을 줄입니다.

### 4. 원본 정보 보존

Markdown에서 직접 표현할 수 없는 네이버 고유 컴포넌트는 `data-naver-*` 메타데이터를 남겨 원래 타입을 식별할 수 있도록 합니다.

향후 Markdown → Naver 형태의 **역방향 변환 가능성**도 고려한 구조입니다.

---

## Limitations

네이버 블로그는 게시글 작성 시기와 에디터 버전에 따라 내부 HTML 구조가 다를 수 있습니다.

현재 구현은 특히 **SmartEditor ONE** 게시글을 중심으로 처리합니다.

네이버가 다음 요소를 변경할 경우 일부 기능은 추가 대응이 필요할 수 있습니다.

* SmartEditor DOM 구조
* 내부 module data
* VOD API
* 이미지 URL 형식
* CSS / sprite 리소스
* 각 컴포넌트의 클래스명

또한 HTML/CSS 지원 수준은 Markdown 뷰어마다 다르기 때문에 모든 뷰어에서 네이버와 완전히 동일하게 렌더링되는 것을 보장하지는 않습니다.
