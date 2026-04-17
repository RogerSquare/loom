interface Props {
  onClose: () => void;
}

export function WelcomeModal({ onClose }: Props) {
  const dismiss = () => {
    localStorage.setItem("loom_first_run_done", "true");
    onClose();
  };

  return (
    <div className="edit-panel-overlay" onClick={dismiss}>
      <div
        className="edit-panel welcome-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>welcome to <strong>Loom</strong></span>
        </header>
        <div className="welcome-body">
          <p>
            Loom is a local-only test harness for experimenting with LLM
            context-window editing. Every message you send is stored as an
            immutable <strong>turn</strong> in a branching DAG.
          </p>

          <h4>Core concepts</h4>
          <ul>
            <li>
              <strong>Edit any turn</strong> — editing creates a sibling on a
              new branch. The original is never mutated.
            </li>
            <li>
              <strong>Fork &amp; compare</strong> — see how different prompts
              or parameters change the model's response, side-by-side.
            </li>
            <li>
              <strong>Pin turns</strong> — keep important messages in context
              even when the rolling limit drops older ones.
            </li>
            <li>
              <strong>Variance sweep</strong> — run the same prompt N times at
              different seeds to measure consistency.
            </li>
          </ul>

          <h4>Quick shortcuts</h4>
          <table className="shortcuts-table">
            <tbody>
              <tr><td><kbd>Ctrl+Enter</kbd></td><td>send message</td></tr>
              <tr><td><kbd>?</kbd></td><td>show all shortcuts</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>close any modal</td></tr>
              <tr><td>double-click title</td><td>rename session</td></tr>
            </tbody>
          </table>

          <p className="muted">
            All data stays on your machine. Sessions are stored as JSON files
            in your app-data directory.
          </p>
        </div>
        <footer>
          <div className="row">
            <button className="primary" onClick={dismiss}>
              get started
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
