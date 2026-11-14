"""利用規約(TERMS.md)を、ブラウザやアプリ内でそのまま読めるHTMLのページにする。

Markdownのテキストのまま返すと、記号がそのまま表示されたり、端末によってはダウンロードに
なったりするため。TERMS.mdで使っている書式(見出し・番号付き/箇条書きのリスト・引用・段落)
だけを変換する小さな変換器で、外部ライブラリには依存しない。
"""
import html
import re

_URL_OR_EMAIL = re.compile(r"(https?://[^\s、。)）]+)|([\w.+-]+@[\w-]+\.[\w.-]+)")


def _inline(text: str) -> str:
    """1行分のテキストをエスケープし、URLとメールアドレスをリンクにする。"""
    parts = []
    last = 0
    for match in _URL_OR_EMAIL.finditer(text):
        parts.append(html.escape(text[last:match.start()]))
        url, email = match.groups()
        href = url or f"mailto:{email}"
        parts.append(f'<a href="{html.escape(href)}">{html.escape(match.group(0))}</a>')
        last = match.end()
    parts.append(html.escape(text[last:]))
    return "".join(parts)


def markdown_to_html(markdown: str) -> str:
    out = []
    list_tag = None
    title = ""

    def close_list():
        nonlocal list_tag
        if list_tag:
            out.append(f"</{list_tag}>")
            list_tag = None

    for raw in markdown.splitlines():
        line = raw.rstrip()
        ordered = re.match(r"^\d+\.\s+(.*)$", line)
        bullet = re.match(r"^[-*]\s+(.*)$", line)
        if ordered or bullet:
            tag = "ol" if ordered else "ul"
            if list_tag != tag:
                close_list()
                out.append(f"<{tag}>")
                list_tag = tag
            out.append(f"<li>{_inline((ordered or bullet).group(1))}</li>")
            continue

        close_list()
        if not line:
            continue
        heading = re.match(r"^(#{1,3})\s+(.*)$", line)
        if heading:
            level = len(heading.group(1))
            if level == 1 and not title:
                title = heading.group(2)
            out.append(f"<h{level}>{_inline(heading.group(2))}</h{level}>")
        elif line.startswith(">"):
            out.append(f"<blockquote>{_inline(line.lstrip('> '))}</blockquote>")
        else:
            out.append(f"<p>{_inline(line)}</p>")
    close_list()

    return _PAGE.format(title=html.escape(title or "THYNORA"), body="\n".join(out))


_PAGE = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
:root {{ color-scheme: light dark; --bg: #f5f4ef; --fg: #1d1d1f; --muted: #5f5f66; --line: #dcdad2; --link: #2639a6; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg: #08090b; --fg: #ececee; --muted: #a0a0a8; --line: #2a2b30; --link: #8fa2ff; }} }}
body {{ margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.8 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif; }}
main {{ max-width: 760px; margin: 0 auto; padding: max(24px, env(safe-area-inset-top)) 16px 64px; }}
h1 {{ font-size: 1.6rem; line-height: 1.4; margin: 0.5em 0; }}
h2 {{ font-size: 1.15rem; margin: 2em 0 0.5em; padding-top: 1em; border-top: 1px solid var(--line); }}
p, li {{ overflow-wrap: anywhere; }}
ol, ul {{ padding-left: 1.5em; }}
li {{ margin: 0.3em 0; }}
blockquote {{ margin: 1em 0; padding: 0.5em 1em; border-left: 3px solid var(--line); color: var(--muted); }}
a {{ color: var(--link); }}
</style>
</head>
<body>
<main>
{body}
</main>
</body>
</html>
"""
