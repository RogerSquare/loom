import { type TokenLogprob } from "../lib/ipc";

interface Props {
  logprobs: TokenLogprob[];
}

/** Map logprob → CSS rgba. Logprob 0 = 100% prob = deep green; -5 = ~0.6% = red-tinged. */
function heatBg(logprob: number): string {
  const prob = Math.exp(logprob);
  // Clamp to [0.001, 1]; map to hue 0 (red) at low prob, 130 (green) at high.
  const p = Math.max(0.001, Math.min(1, prob));
  const hue = p * 130;
  const sat = 55 + (1 - p) * 20;
  const lightness = 18 + p * 8;
  const alpha = 0.35 + p * 0.35;
  return `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${lightness.toFixed(0)}%, ${alpha.toFixed(2)})`;
}

function tooltipFor(tp: TokenLogprob): string {
  const pct = (Math.exp(tp.logprob) * 100).toFixed(2);
  const head = `${JSON.stringify(tp.token)}  p=${pct}%  logp=${tp.logprob.toFixed(3)}`;
  if (!tp.top_logprobs || tp.top_logprobs.length === 0) return head;
  const alts = tp.top_logprobs
    .slice(0, 8)
    .map(
      (a) =>
        `${JSON.stringify(a.token)} ${(Math.exp(a.logprob) * 100).toFixed(2)}%`,
    )
    .join("\n");
  return `${head}\n\ntop-${tp.top_logprobs.length}:\n${alts}`;
}

export function LogprobsBody({ logprobs }: Props) {
  return (
    <pre className="turn-body logprob-body">
      {logprobs.map((tp, i) => (
        <span
          key={i}
          className="logprob-token"
          style={{ backgroundColor: heatBg(tp.logprob) }}
          title={tooltipFor(tp)}
        >
          {tp.token}
        </span>
      ))}
    </pre>
  );
}
