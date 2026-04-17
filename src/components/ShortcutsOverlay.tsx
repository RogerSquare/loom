interface Props {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: "Ctrl+Enter", action: "send message" },
  { keys: "?", action: "toggle this shortcuts reference" },
  { keys: "Esc", action: "close any modal or overlay" },
  { keys: "double-click title", action: "rename session" },
  { keys: "click ctx: value", action: "edit context limit" },
  { keys: "hover turn → edit", action: "fork from this turn" },
  { keys: "hover turn → note", action: "add annotation" },
  { keys: "hover turn → pin", action: "keep in context regardless of limit" },
  { keys: "hover turn → rerun", action: "re-generate with different params" },
  { keys: "hover turn → sweep", action: "run N variants for consistency" },
  { keys: "hover turn → judge", action: "score with a second model" },
  { keys: "hover turn → compare", action: "word-diff with a sibling" },
  { keys: "← N/M →", action: "swipe between sibling variants" },
  { keys: "{ } JSON toggle", action: "edit raw outbound API payload" },
];

export function ShortcutsOverlay({ onClose }: Props) {
  return (
    <div className="edit-panel-overlay" onClick={onClose}>
      <div
        className="edit-panel shortcuts-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>keyboard shortcuts &amp; actions</span>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="shortcuts-body">
          <table className="shortcuts-table">
            <tbody>
              {SHORTCUTS.map((s, i) => (
                <tr key={i}>
                  <td>
                    <kbd>{s.keys}</kbd>
                  </td>
                  <td>{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>
          <span className="muted">press <kbd>?</kbd> or <kbd>Esc</kbd> to close</span>
        </footer>
      </div>
    </div>
  );
}
