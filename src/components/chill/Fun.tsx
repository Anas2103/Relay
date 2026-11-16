import { useCallback, useEffect, useState } from "react";
import type { FunItem } from "../../../shared/types";
import { api, ApiError } from "../../lib/api";
import { CopyIcon, Spinner } from "../ui";

const EIGHT_BALL = [
  "It is certain.", "Without a doubt.", "Yes — definitely.", "You may rely on it.", "Most likely.", "Outlook good.", "Signs point to yes.",
  "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.",
  "Don't count on it.", "My reply is no.", "Outlook not so good.", "Very doubtful.",
];
const WOULD_YOU_RATHER = [
  ["be able to fly", "be invisible"], ["never use social media again", "never watch another movie"], ["always be 10 minutes late", "always be 20 minutes early"],
  ["speak every language", "play every instrument"], ["live by the beach", "live in the mountains"], ["have unlimited pizza", "have unlimited couscous"],
  ["travel 100 years back", "travel 100 years forward"], ["never feel cold", "never feel hot"], ["be famous", "be rich and unknown"],
  ["have a rewind button for your life", "have a pause button"], ["only whisper", "only shout"], ["read minds", "see the future"],
  ["lose your phone for a week", "lose your wallet for a week"], ["be a famous singer", "be a famous athlete"], ["have no internet", "have no air conditioning"],
];

/** Light fun: jokes, facts, a magic 8-ball, would-you-rather, dice and coin. */
export function FunTab() {
  return (
    <div className="h-full overflow-y-auto px-3 pb-4">
      <div className="mx-auto grid max-w-3xl gap-3 md:grid-cols-2">
        <FetchCard kind="joke" title="😂 Joke" button="Another one" />
        <FetchCard kind="fact" title="🤓 Random fact" button="Another fact" />
        <EightBall />
        <WouldYouRather />
        <DiceAndCoin />
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => void navigator.clipboard?.writeText(text).then(() => (setDone(true), window.setTimeout(() => setDone(false), 1500)))}
      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-zinc-500 hover:bg-black/10 dark:hover:bg-zinc-700"
      aria-label="Copy to send to a friend"
    >
      <CopyIcon className="size-3.5" /> {done ? "Copied" : "Copy"}
    </button>
  );
}

function FetchCard({ kind, title, button }: { kind: "joke" | "fact"; title: string; button: string }) {
  const [item, setItem] = useState<FunItem | null>(null);
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setReveal(false);
    setError(null);
    api.fun(kind).then(
      (r) => (setItem(r.item), setLoading(false)),
      (err) => (setError(err instanceof ApiError ? err.message : "Couldn't load."), setLoading(false)),
    );
  }, [kind]);
  useEffect(load, [load]);

  const text = item ? (item.answer ? `${item.text}\n${item.answer}` : item.text) : "";
  return (
    <Card title={title}>
      <div className="min-h-20">
        {loading && !item ? (
          <Spinner className="size-5" />
        ) : error ? (
          <p className="text-sm text-zinc-500">{error}</p>
        ) : (
          item && (
            <>
              <p className="whitespace-pre-wrap">{item.text}</p>
              {item.answer &&
                (reveal ? (
                  <p className="pop-in mt-2 font-semibold">{item.answer}</p>
                ) : (
                  <button onClick={() => setReveal(true)} className="mt-2 rounded-full bg-accent/15 px-3 py-1 text-sm font-medium text-accent-fg">
                    Show the punchline
                  </button>
                ))}
            </>
          )
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button onClick={load} disabled={loading} className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-60">
          {button}
        </button>
        {item && <CopyButton text={text} />}
      </div>
    </Card>
  );
}

function EightBall() {
  const [q, setQ] = useState("");
  const [a, setA] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const ask = () => {
    setShaking(true);
    setA(null);
    window.setTimeout(() => {
      setShaking(false);
      setA(EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)]);
    }, 700);
  };
  return (
    <Card title="🎱 Magic 8-ball">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="flex gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a yes/no question" aria-label="Your question" className="h-10 min-w-0 flex-1 rounded-xl bg-black/5 px-3 text-sm outline-none dark:bg-zinc-900" />
        <button className="rounded-xl bg-accent px-3 text-sm font-semibold text-accent-ink">Ask</button>
      </form>
      <div className={`mx-auto mt-3 flex size-28 items-center justify-center rounded-full bg-zinc-900 shadow-inner ${shaking ? "animate-[shake_0.5s_ease-in-out]" : ""}`}>
        <span className="flex size-16 items-center justify-center rounded-full bg-indigo-900 p-1 text-center text-[10px] leading-tight font-semibold text-indigo-100">{a ?? (shaking ? "…" : "8")}</span>
      </div>
    </Card>
  );
}

function WouldYouRather() {
  const [i, setI] = useState(() => Math.floor(Math.random() * WOULD_YOU_RATHER.length));
  const [pick, setPick] = useState<number | null>(null);
  const [a, b] = WOULD_YOU_RATHER[i];
  return (
    <Card title="🤔 Would you rather…">
      <div className="grid gap-2">
        {[a, b].map((opt, n) => (
          <button key={n} onClick={() => setPick(n)} className={`rounded-2xl px-4 py-3 text-left font-medium transition ${pick === n ? "bg-accent text-accent-ink" : "bg-black/5 hover:bg-black/10 dark:bg-zinc-900 dark:hover:bg-zinc-950"}`}>
            …{opt}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={() => {
            setI((x) => (x + 1 + Math.floor(Math.random() * (WOULD_YOU_RATHER.length - 1))) % WOULD_YOU_RATHER.length);
            setPick(null);
          }}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink"
        >
          Next question
        </button>
        <CopyButton text={`Would you rather ${a} or ${b}?`} />
      </div>
    </Card>
  );
}

function DiceAndCoin() {
  const [dice, setDice] = useState<number[]>([]);
  const [coin, setCoin] = useState<string | null>(null);
  const FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  return (
    <Card title="🎲 Dice & coin">
      <div className="flex min-h-16 items-center justify-center gap-3 text-5xl">
        {dice.length ? dice.map((d, i) => <span key={i}>{FACES[d - 1]}</span>) : coin ? <span className="text-2xl font-bold">{coin}</span> : <span className="text-sm text-zinc-500">Roll or flip</span>}
      </div>
      {dice.length > 1 && <p className="text-center text-sm text-zinc-500">Total: {dice.reduce((x, y) => x + y)}</p>}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            onClick={() => {
              setCoin(null);
              setDice(Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6)));
            }}
            className="rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold hover:bg-black/10 dark:bg-zinc-900"
          >
            Roll {n} {n === 1 ? "die" : "dice"}
          </button>
        ))}
        <button
          onClick={() => {
            setDice([]);
            setCoin(Math.random() < 0.5 ? "🪙 Heads" : "🪙 Tails");
          }}
          className="rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold hover:bg-black/10 dark:bg-zinc-900"
        >
          Flip a coin
        </button>
      </div>
    </Card>
  );
}
