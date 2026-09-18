# Naver Blog to Markdown

네이버 블로그 게시글을 **Markdown 파일로 백업하는 Node.js 도구**입니다.

본문의 텍스트, 이미지, 링크, YouTube 영상 등을 최대한 원본 구조에 가깝게 보존하면서 Markdown으로 변환합니다.

## Features

* 네이버 블로그 게시글 → Markdown 변환
* 게시글 제목 및 원본 URL 보존
* 이미지 URL 보존
* 링크(`<a>`) 보존
* YouTube 영상 `<iframe>` 보존
* YouTube Shorts 지원
* YouTube 시작 시간(`t=65s` 등) 보존
* 목록 구조 정리
* 불필요한 연속 개행 자동 정리
* 원문의 빈 줄 간격 보존
* Windows / Git Bash 환경 지원

## Installation

먼저 저장소를 클론합니다.

```bash
git clone https://github.com/sansoohan/naver-blog-to-markdown.git
cd naver-blog-to-markdown
```

의존성을 설치합니다.

```bash
npm install
```

## Usage

기본 사용법:

```bash
node ./main.js <네이버 블로그 게시글 URL>
```

예:

```bash
node ./main.js https://blog.naver.com/sansoo2002/224289001583
```

별도의 출력 폴더를 지정하지 않으면 결과는 `output` 폴더에 저장됩니다.

```text
output/
└── 게시글 제목.md
```

### 출력 폴더 지정

두 번째 인자로 저장할 폴더를 지정할 수 있습니다.

```bash
node ./main.js <URL> <폴더>
```

예:

```bash
node ./main.js https://blog.naver.com/sansoo2002/224289001583 dst
```

그러면 Markdown 파일이 `dst` 폴더에 저장됩니다.

## Output

변환된 Markdown은 대략 다음과 같은 구조를 가집니다.

```markdown
# 게시글 제목

> 원본: https://blog.naver.com/...

본문 내용...

![](IMAGE_URL)

<a href="YOUTUBE_URL" target="_blank">YOUTUBE_URL</a>

<iframe ...></iframe>
```

원본 게시글 주소도 Markdown 상단에 함께 기록됩니다.

## YouTube

게시글에 삽입된 일반 YouTube 영상과 Shorts를 보존합니다.

원본 YouTube 링크가 게시글에 존재하는 경우 링크와 영상 iframe을 각각 보존합니다.

시간이 지정된 링크:

```text
https://www.youtube.com/watch?v=VIDEO_ID&t=65s
```

는 iframe에서도 해당 위치부터 시작할 수 있도록:

```html
<iframe src="https://www.youtube.com/embed/VIDEO_ID?start=65&..."></iframe>
```

형태로 변환됩니다.

## Markdown Preview

생성된 Markdown에는 raw HTML `<iframe>`이 포함될 수 있습니다.

Markdown 뷰어에 따라 iframe 표시 또는 YouTube 재생이 제한될 수 있습니다. 이는 생성된 Markdown이나 iframe 자체의 문제가 아니라 뷰어의 HTML/WebView 정책에 따라 달라질 수 있습니다.

브라우저에서 iframe 동작을 확인하려면 `file://`로 직접 여는 대신 로컬 HTTP 서버를 사용하는 것을 권장합니다.

예:

```bash
npx http-server .
```

이후 브라우저에서:

```text
http://localhost:8080/
```

으로 접속합니다.

## Requirements

* Node.js
* npm

## Notes

네이버 블로그의 HTML 구조가 변경되면 일부 게시글이 정상적으로 변환되지 않을 수 있습니다.

또한 게시글의 구성 요소나 작성 시기에 따라 네이버 블로그 내부 HTML 구조가 서로 다를 수 있습니다.

## License

MIT License
