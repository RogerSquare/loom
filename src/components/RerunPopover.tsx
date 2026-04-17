import { useState } from "react";

import { type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";

interface Props {
  turn: Turn;
  onClose: () => void;
}

export function RerunPopover({ turn, onClose }: Props) {
  const rerunWithParams = useLoom((s) => s.rerunWithParams);
  const streaming = useLoom((s) => s.streaming);

  const orig = turn.generated_by?.options;
  const [temp, setTemp] = useState(orig?.temperature ?? 0.7);
  const [topP, setTopP] = useState(orig?.top_p ?? 0.9);
  const [seed, setSeed] = useState(orig?.seed?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (busy || streaming) return;
    setBusy(true);
    try {
      await rerunWithParams(turn.id, {
        temperature: temp,
        top_p: topP,
        ...(seed ? { seed: Number(seed) } : {}),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rerun-popover" onClick={(e) => e.stopPropagation()}>
      <div className="rerun-title">rerun with different params</div>
      <label className="field">
        <span>temp</span>
        <input
          type="number"
          min={0}
          max={2}
          step={0.05}
          value={temp}
          onChange={(e) => setTemp(Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span>top_p</span>
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={topP}
          onChange={(e) => setTopP(Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span>seed</span>
        <input
          type="text"
          placeholder="(random)"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
        />
      </label>
      <div className="row">
        <button onClick={onClose} disabled={busy}>
          cancel
        </button>
        <button className="primary" onClick={go} disabled={busy}>
          {busy ? "running…" : "rerun"}
        </button>
      </div>
    </div>
  );
}
