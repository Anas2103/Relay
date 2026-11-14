import { useState } from "react";
import { LIMITS, type PollInfo } from "../../shared/types";
import { Sheet } from "./Dialogs";
import { PlusIcon, XIcon } from "./ui";

const input =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 dark:border-zinc-700 dark:bg-zinc-800";

/** Create a poll (like Telegram / Discord polls): a question and 2–10 answers. */
export function PollDialog({ onCreate, onClose }: { onCreate: (question: string, poll: PollInfo) => void; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;
  const valid = question.trim().length > 0 && filled.length >= LIMITS.pollOptionsMin && !duplicate;

  function setOption(i: number, value: string) {
    setOptions((prev) => {
      const next = prev.map((o, j) => (j === i ? value : o));
      // A new empty answer appears as soon as the last one is used (up to the limit).
      if (i === next.length - 1 && value.trim() && next.length < LIMITS.pollOptionsMax) next.push("");
      return next;
    });
  }

  function create() {
    if (!valid) return;
    onCreate(question.trim(), { options: filled, multiple });
    onClose();
  }

  return (
    <Sheet
      title="New poll"
      onClose={onClose}
      footer={
        <button onClick={create} disabled={!valid} className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-40">
          Create poll
        </button>
      }
    >
      <div className="space-y-5 pt-1">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Question</span>
          <input className={input} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={LIMITS.pollQuestionMax} placeholder="Ask something…" autoFocus />
        </label>
        <div>
          <p className="mb-1.5 text-sm font-medium">Answers</p>
          <ul className="space-y-2">
            {options.map((o, i) => (
              <li key={i} className="flex items-center gap-2">
                <input className={input} value={o} onChange={(e) => setOption(i, e.target.value)} maxLength={LIMITS.pollOptionMax} placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1}`} />
                {options.length > 2 && (
                  <button onClick={() => setOptions((p) => p.filter((_, j) => j !== i))} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800" aria-label={`Remove answer ${i + 1}`}>
                    <XIcon className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {options.length < LIMITS.pollOptionsMax && options.every((o) => o.trim()) && (
            <button onClick={() => setOptions((p) => [...p, ""])} className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-accent-fg hover:bg-accent/10">
              <PlusIcon className="size-4" /> Add an answer
            </button>
          )}
          {duplicate && <p className="mt-2 text-xs text-red-600 dark:text-red-400">Each answer must be different.</p>}
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {LIMITS.pollOptionsMin}–{LIMITS.pollOptionsMax} answers. Everyone in the chat can see who voted for what.
          </p>
        </div>
        <label className="-mx-2 flex cursor-pointer items-center justify-between gap-4 rounded-xl px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
          <span>
            <span className="block text-sm font-medium">Allow multiple answers</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">People can pick more than one.</span>
          </span>
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="size-5 accent-[var(--accent)]" />
        </label>
      </div>
    </Sheet>
  );
}
