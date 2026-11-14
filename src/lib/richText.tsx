import { useState, type ReactNode } from "react";

/**
 * Message formatting, like Telegram / Discord:
 *   **bold**  *italic* or _italic_  __underline__  ~~strike~~  `code`  ||spoiler||
 *   ```code block```   > quote   links   @mentions
 * Rendered as React elements only, never as HTML, so a message can't inject anything.
 */

const INLINE = new RegExp(
  [
    /(`[^`\n]+`)/.source, // 1 code
    /(\|\|[\s\S]+?\|\|)/.source, // 2 spoiler
    /(\*\*(?!\s)[\s\S]+?\*\*)/.source, // 3 bold
    /(__(?!\s)[\s\S]+?__)/.source, // 4 underline
    /(~~(?!\s)[\s\S]+?~~)/.source, // 5 strike
    /((?<![\w*])\*(?![\s*])[^*\n]+?(?<!\s)\*(?![\w*]))/.source, // 6 italic *
    /((?<![\w_])_(?![\s_])[^_\n]+?(?<!\s)_(?![\w_]))/.source, // 7 italic _
    /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?*_~|])/.source, // 8 link
    /((?<![\w@])@[A-Za-z0-9_]{3,20}(?!\w))/.source, // 9 mention
  ].join("|"),
  "g",
);

export interface RichOptions {
  /** On a colored bubble: links are underlined instead of colored. */
  tinted: boolean;
  /** Your username, so mentions of you stand out. */
  me: string;
}

export function RichText({ text, tinted, me }: { text: string } & RichOptions) {
  return <>{renderBlocks(text, { tinted, me })}</>;
}

/** Quick check so plain messages skip the parser entirely. */
const MAYBE_RICH = /[`*_~|@>]|https?:\/\//;

function renderBlocks(text: string, o: RichOptions): ReactNode {
  if (!MAYBE_RICH.test(text)) return text;
  const out: ReactNode[] = [];
  const parts = text.split(/```(?:[a-zA-Z0-9+#-]{0,15}\n)?([\s\S]*?)```/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(
        <pre key={`c${i}`} className="my-1 overflow-x-auto rounded-lg bg-black/10 px-2.5 py-2 font-mono text-[0.85em] leading-snug whitespace-pre dark:bg-black/30">
          <code>{part.replace(/\n$/, "")}</code>
        </pre>,
      );
      return;
    }
    // Quote lines ("> text") are grouped into one block.
    const lines = part.split("\n");
    let buffer: string[] = [];
    let quote: string[] = [];
    const flushText = () => {
      if (buffer.length) out.push(<span key={`t${i}-${out.length}`}>{renderInline(buffer.join("\n"), o)}</span>);
      buffer = [];
    };
    const flushQuote = () => {
      if (quote.length) {
        out.push(
          <span key={`q${i}-${out.length}`} className="my-0.5 block border-l-[3px] border-current/40 pl-2.5 opacity-90">
            {renderInline(quote.join("\n"), o)}
          </span>,
        );
      }
      quote = [];
    };
    lines.forEach((line, n) => {
      const m = /^>\s?(.*)$/.exec(line);
      if (m) {
        flushText();
        quote.push(m[1]);
      } else {
        flushQuote();
        buffer.push(n === lines.length - 1 ? line : line);
      }
    });
    flushText();
    flushQuote();
  });
  return out;
}

function renderInline(text: string, o: RichOptions, depth = 0): ReactNode {
  if (depth > 4 || !MAYBE_RICH.test(text)) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index!;
    if (start > last) out.push(text.slice(last, start));
    const t = m[0];
    const k = `${depth}-${start}`;
    if (m[1]) {
      out.push(
        <code key={k} className="rounded bg-black/10 px-1 py-px font-mono text-[0.88em] dark:bg-black/30">
          {t.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<Spoiler key={k}>{renderInline(t.slice(2, -2), o, depth + 1)}</Spoiler>);
    } else if (m[3]) {
      out.push(<strong key={k} className="font-semibold">{renderInline(t.slice(2, -2), o, depth + 1)}</strong>);
    } else if (m[4]) {
      out.push(<u key={k} className="underline-offset-2">{renderInline(t.slice(2, -2), o, depth + 1)}</u>);
    } else if (m[5]) {
      out.push(<s key={k}>{renderInline(t.slice(2, -2), o, depth + 1)}</s>);
    } else if (m[6] || m[7]) {
      out.push(<em key={k}>{renderInline(t.slice(1, -1), o, depth + 1)}</em>);
    } else if (m[8]) {
      out.push(
        <a
          key={k}
          href={t}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={`underline underline-offset-2 ${o.tinted ? "" : "text-accent-fg"}`}
          onClick={(e) => e.stopPropagation()}
        >
          {t}
        </a>,
      );
    } else if (m[9]) {
      const isMe = t.slice(1).toLowerCase() === o.me.toLowerCase();
      out.push(
        <span
          key={k}
          className={`rounded px-0.5 font-medium ${isMe ? "bg-amber-300/40 dark:bg-amber-400/25" : o.tinted ? "underline decoration-current/40 underline-offset-2" : "text-accent-fg"}`}
        >
          {t}
        </span>,
      );
    }
    last = start + t.length;
  }
  if (last === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Hidden until tapped (Discord / Telegram spoilers). */
function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      role="button"
      tabIndex={shown ? -1 : 0}
      aria-label={shown ? undefined : "Spoiler, tap to reveal"}
      onClick={(e) => {
        e.stopPropagation();
        setShown(true);
      }}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setShown(true)}
      className={`rounded px-0.5 transition ${shown ? "bg-black/10 dark:bg-white/10" : "cursor-pointer bg-zinc-500 text-transparent select-none [&_*]:text-transparent dark:bg-zinc-400"}`}
    >
      {children}
    </span>
  );
}

/** Removes formatting marks, for previews and notifications. */
export function plainText(text: string): string {
  return text
    .replace(/```(?:[a-zA-Z0-9+#-]{0,15}\n)?([\s\S]*?)```/g, "$1")
    .replace(/\|\|([\s\S]+?)\|\|/g, "▒▒▒")
    .replace(/(\*\*|__|~~)(?!\s)([\s\S]+?)\1/g, "$2")
    .replace(/`([^`\n]+)`/g, "$1");
}
