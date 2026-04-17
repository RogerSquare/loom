import { memo, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface Props {
  content: string;
}

/** Render markdown with syntax-highlighted code blocks. */
export const MarkdownBody = memo(function MarkdownBody({ content }: Props) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

/** Code block with syntax highlighting, language label, and copy button. */
function CodeBlock({
  className,
  children,
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className || "");
  const lang = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");
  const isInline = !className && !code.includes("\n");

  if (isInline) {
    return <code className="inline-code">{children}</code>;
  }

  return <CodeBlockFenced lang={lang} code={code} />;
}

function CodeBlockFenced({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        {lang && <span className="code-block-lang">{lang}</span>}
        <button className="code-block-copy" onClick={copy}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={lang || "text"}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "12px 16px",
          borderRadius: "0 0 8px 8px",
          fontSize: "13px",
          lineHeight: "1.5",
          background: "var(--bg)",
        }}
        codeTagProps={{
          style: { fontFamily: '"SF Mono", Consolas, monospace' },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
