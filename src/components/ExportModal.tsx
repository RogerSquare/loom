import { useMemo, useRef, useState } from "react";

import { exportAsCurl, type SessionFile } from "../lib/ipc";

interface Props {
  file: SessionFile;
  branchId?: string;
  onClose: () => void;
}

export function ExportModal({ file, branchId, onClose }: Props) {
  const script = useMemo(
    () => exportAsCurl(file, branchId),
    [file, branchId],
  );
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);

  const copy = () => {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="edit-panel-overlay" onClick={onClose}>
      <div
        className="edit-panel export-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>
            export branch as curl — <strong>{file.session.title}</strong>
          </span>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>
        <pre className="export-body" ref={preRef}>
          {script}
        </pre>
        <footer>
          <span className="muted">
            copy and save as .sh — run with <code>bash script.sh</code>
          </span>
          <div className="row">
            <button onClick={onClose}>close</button>
            <button className="primary" onClick={copy}>
              {copied ? "copied ✓" : "copy to clipboard"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
