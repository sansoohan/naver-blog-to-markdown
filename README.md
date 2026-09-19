# Naver Blog to Markdown

네이버 블로그 게시글을 **Markdown + 로컬 미디어 파일로 백업하는 Node.js 도구**입니다.

단일 게시글뿐 아니라 **카테고리 단위 백업과 블로그 전체 백업**을 지원합니다.

단순히 본문 텍스트만 Markdown으로 바꾸는 것이 아니라, **SmartEditor ONE의 문서 구조와 서식을 가능한 한 유지하는 것**을 목표로 합니다.

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

#### 카테고리

특정 카테고리의 게시글을 백업합니다.

```bash
npm run category -- "https://blog.naver.com/BLOG_ID" "카테고리명"
```

카테고리명을 생략하면 카테고리 목록에서 선택할 수 있습니다.

```bash
npm run category -- "https://blog.naver.com/BLOG_ID"
```

상위 카테고리를 선택한 경우 해당 카테고리에 포함된 하위 카테고리의 게시글도 함께 탐색합니다.

#### 블로그 전체

블로그의 전체 게시글을 백업합니다.

```bash
npm run blog -- "https://blog.naver.com/BLOG_ID"
```

---

### 🔄 Incremental Backup

카테고리 및 전체 블로그 백업에서는 이미 백업한 게시글을 매번 다시 변환하지 않습니다.

게시글 본문의 hash를 `output/backup-cache.json`에 기록하고, 다음 백업에서 이전 hash와 비교합니다.

```text
게시글 가져오기
↓
본문 hash 계산
↓
이전 hash와 비교
↓
같음 → 변경 없음 / 건너뜀
다름 → 게시글 다시 백업
```

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

네이버가 요청할 때마다 변경하는 임시 URL이나 동적 값 때문에 실제 게시글이 수정되지 않았는데 hash가 달라지는 것을 줄이기 위해 일부 동적 필드는 hash 계산에서 정규화합니다.

현재 대응하는 예:

* 첨부파일 다운로드 URL의 임시 토큰
* 네이버 동영상의 동적 `key`
* 구형 네이버 동영상의 `hashKey`

`backup-cache.json`은 게시글별로 별도 생성되는 것이 아니라 전체 백업 상태를 하나의 파일에 누적해서 관리합니다.

```text
output/
├── backup-cache.json
├── 카테고리1/
├── 카테고리2/
└── ...
```

---

### 🛡️ Safe Rebuild

업데이트된 게시글을 바로 기존 폴더 위에 덮어쓰지 않습니다.

먼저 임시 폴더에 새로운 백업을 완성한 뒤 성공한 경우에만 기존 백업을 교체합니다.

```text
변경 감지
↓
임시 폴더에 새로운 백업 생성
↓
변환 및 다운로드 완료
↓
기존 게시글 폴더 교체
↓
backup-cache.json 갱신
```

따라서 변환 또는 다운로드 도중 오류가 발생했을 때 기존 백업이 불완전한 상태로 덮어써지는 위험을 줄입니다.

백업 도중 프로그램을 종료한 경우에도 이미 완료되어 캐시에 기록된 게시글은 다음 실행에서 변경 여부를 확인하여 건너뛸 수 있습니다.

강제 종료 시 `output/.tmp/`에 작업 중이던 임시 폴더가 남을 수 있습니다.

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

가능한 경우 원본 URL의 실제 파일명을 유지합니다.

```text
output/
└── 카테고리/
    └── 글번호_게시글 제목/
        ├── index.md
        ├── photo.jpg
        ├── image.png
        └── ...
```

같은 이미지 URL이 게시글 안에서 여러 번 사용되는 경우에는 한 번만 다운로드하고 동일한 로컬 파일을 재사용합니다.

본문 이미지뿐 아니라 OG 링크 카드 썸네일과 네이버 동영상 썸네일도 같은 이미지 캐시를 사용합니다.

서로 다른 이미지가 같은 파일명을 사용하는 경우에는 파일이 덮어써지지 않도록 자동으로 번호를 붙입니다.

```text
photo.jpg
photo_2.jpg
photo_3.jpg
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

게시글에 첨부된 파일을 **로컬 파일로 다운로드**합니다.

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

가능한 경우 원래 첨부파일명을 유지하며, 서버가 `Content-Disposition`을 통해 파일명을 제공하는 경우 해당 파일명을 사용합니다.

같은 첨부파일 URL이 여러 번 나타나는 경우에는 한 번만 다운로드합니다.

서로 다른 첨부파일이 같은 파일명을 사용하는 경우에는 자동으로 번호를 붙여 덮어쓰기를 방지합니다.

```text
자료.zip
자료_2.zip
자료_3.zip
```

첨부파일이 없는 게시글에서는 `download/` 폴더를 만들지 않습니다.

---

### 💻 Source Code

SmartEditor ONE의 **소스코드 컴포넌트**를 fenced code block으로 변환합니다.

네이버 소스코드 컴포넌트의 3가지 디자인을 구분하여 원래 클래스명을 함께 보존합니다.

```text
se-l-default
se-l-code_stripe
se-l-code_black
```

예:

````markdown
```{se-l-default}
const message = "Hello World";
console.log(message);
```
````

다른 디자인도 동일한 방식으로 기록됩니다.

````markdown
```{se-l-code_stripe}
const value = 100;
```

```{se-l-code_black}
const value = 200;
```
````

코드 안에 backtick이 포함된 경우에는 내용과 충돌하지 않도록 fence 길이를 자동으로 조정합니다.

코드 내용의 줄바꿈과 실제 들여쓰기를 가능한 한 유지합니다.

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

가능한 경우 실제 미디어 URL의 파일명을 유지하며, 파일명이 없는 경우에는 자동 생성된 이름을 사용합니다.

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

동일한 동영상 URL이 여러 번 사용되는 경우에는 MP4 파일을 다시 다운로드하지 않고 기존 로컬 파일을 재사용합니다.

동영상 썸네일은 일반 이미지와 동일한 이미지 캐시를 사용합니다.

---

### 🔗 OG Link Cards

네이버의 링크 미리보기 카드도 보존합니다.

* 제목
* 설명
* 도메인
* 원본 링크
* 썸네일

썸네일은 로컬에 다운로드됩니다.

동일한 이미지가 본문이나 다른 컴포넌트에서도 사용되는 경우에는 이미 다운로드된 로컬 파일을 재사용합니다.

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

복잡한 표는 원본의 병합 구조와 텍스트 서식을 유지하면서 HTML 형태로 변환합니다.

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

인용문과 출처(cite)를 별도로 보존하며, 원래 네이버 인용구 타입도 기록합니다.

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

네이버 구분선은 일반 Markdown의 `---`로 단순 변환하지 않고 HTML/CSS 형태로 보존합니다.

```html
<div class="naver-hr naver-hr-line3 naver-hr-left" data-naver-line-type="line3" data-naver-align="left">
  ...
</div>
```

정렬 정보도 함께 보존합니다.

```text
left
center
right
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

예:

```bash
npm run page -- "https://blog.naver.com/sansoo2002/224289001583"
```

### 카테고리 백업

카테고리명을 직접 지정할 수 있습니다.

```bash
npm run category -- "https://blog.naver.com/BLOG_ID" "카테고리명"
```

예:

```bash
npm run category -- "https://blog.naver.com/sansoo2002" "정신"
```

카테고리명을 생략하면 카테고리를 선택할 수 있습니다.

```bash
npm run category -- "https://blog.naver.com/sansoo2002"
```

### 블로그 전체 백업

```bash
npm run blog -- "https://blog.naver.com/BLOG_ID"
```

예:

```bash
npm run blog -- "https://blog.naver.com/sansoo2002"
```

---

## Output

변환 결과는 `output` 폴더 아래에 저장됩니다.

```text
output/
├── backup-cache.json
├── 카테고리1/
│   ├── LOG_NO_게시글 제목/
│   │   ├── index.md
│   │   ├── photo.jpg
│   │   ├── video.mp4
│   │   └── download/
│   │       └── 자료.zip
│   └── ...
├── 카테고리2/
│   └── ...
└── .tmp/
```

각 게시글 폴더명 앞에는 네이버의 고유 게시글 번호(`logNo`)가 붙습니다.

게시글 번호를 폴더명에 포함하기 때문에 제목이 같은 게시글도 서로 충돌하지 않습니다.

`index.md` 상단에는 게시글 제목과 원본 주소가 기록됩니다.

```markdown
# 게시글 제목

> 원본: https://blog.naver.com/BLOG_ID/LOG_NO

본문...
```

`backup-cache.json`에는 게시글별 hash와 백업 정보가 저장됩니다.

예:

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
│   ├── attachment.js
│   ├── paragraph.js
│   ├── image.js
│   ├── table.js
│   ├── quote.js
│   ├── horizontal-line.js
│   ├── video.js
│   └── code.js
├── output/
│   └── backup-cache.json
├── package.json
└── README.md
```

| File                 | Role                                 |
| -------------------- | ------------------------------------ |
| `backup-page.js`     | 단일 게시글 가져오기, 변환 흐름, hash 및 캐시 관리     |
| `backup-category.js` | 카테고리 탐색 및 카테고리 단위 백업                 |
| `backup-blog.js`     | 블로그 전체 게시글 백업                        |
| `attachment.js`      | 첨부파일 탐지, 다운로드 및 로컬 링크 변환             |
| `paragraph.js`       | 텍스트, 글자 크기, 인라인 서식, 링크, 체크박스         |
| `image.js`           | 이미지 다운로드, 중복 방지, 고해상도 이미지 및 표시 크기 처리 |
| `table.js`           | Markdown/HTML 표 변환                   |
| `quote.js`           | 네이버 인용구 카드                           |
| `horizontal-line.js` | 네이버 구분선 타입 및 정렬 보존                   |
| `video.js`           | YouTube 및 네이버 동영상                    |
| `code.js`            | 네이버 소스코드 컴포넌트 및 디자인 클래스 변환           |

---

## Markdown Preview

생성된 Markdown은 표준 Markdown 외에도 일부 raw HTML과 확장된 fenced code block 정보를 포함할 수 있습니다.

```html
<span>
<table>
<a>
<iframe>
<video>
<style>
```

소스코드 컴포넌트는 네이버 디자인 정보를 보존하기 위해 다음과 같은 fence info string을 사용합니다.

````markdown
```{se-l-code_black}
code...
```
````

따라서 사용하는 Markdown 뷰어에 따라 일부 요소의 표시 결과가 달라질 수 있습니다.

특히 YouTube iframe, `<video>`, `<style>`, HTML table, inline CSS, 첨부파일 링크, 소스코드의 네이버 디자인 클래스 등은 Markdown 뷰어의 HTML/WebView 및 Markdown 확장 문법 지원 수준에 영향을 받을 수 있습니다.

---

## Design Goals

### 1. 원본 구조 보존

SmartEditor ONE의 실제 DOM과 모듈 정보를 분석하여 원본 게시글의 의미와 구조를 최대한 유지합니다.

### 2. Markdown 우선

Markdown으로 표현할 수 있는 요소를 불필요하게 HTML로 변환하지 않습니다.

### 3. 로컬 백업

이미지, 동영상, 첨부파일 등 중요한 파일을 가능한 한 로컬에 저장하여 네이버의 원격 리소스에 대한 의존성을 줄입니다.

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

향후 Markdown → Naver 형태의 **역방향 변환 가능성**도 고려한 구조입니다.

---

## Limitations

네이버 블로그는 게시글 작성 시기와 에디터 버전에 따라 내부 HTML 구조가 다를 수 있습니다.

현재 구현은 특히 **SmartEditor ONE** 게시글을 중심으로 처리하며, 일부 구형 게시글 구조도 처리할 수 있습니다.

네이버가 다음 요소를 변경할 경우 일부 기능은 추가 대응이 필요할 수 있습니다.

* SmartEditor DOM 구조
* 구형 게시글 HTML 구조
* 내부 module data
* VOD API
* 이미지 URL 형식
* 첨부파일 구조 및 다운로드 URL
* CSS / sprite 리소스
* 각 컴포넌트의 클래스명
* 소스코드 컴포넌트 구조 및 디자인 클래스

증분 백업은 현재 게시글 본문을 가져온 뒤 hash를 비교하는 방식입니다. 따라서 변경되지 않은 게시글도 변경 여부를 확인하기 위한 게시글 요청 자체는 발생합니다.

네이버가 응답마다 변경하는 임시 URL, 인증값 또는 동적 속성은 hash 비교에서 false update를 발생시킬 수 있습니다. 확인된 동적 필드는 정규화하고 있지만, 다른 에디터 버전이나 오래된 게시글에서 새로운 형태가 발견될 경우 추가 대응이 필요할 수 있습니다.

강제 종료 시 작업 중이던 `output/.tmp/` 디렉터리가 남을 수 있습니다.

또한 HTML/CSS 및 Markdown 확장 문법 지원 수준은 Markdown 뷰어마다 다르기 때문에 모든 뷰어에서 네이버와 완전히 동일하게 렌더링되는 것을 보장하지는 않습니다.
