interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "confirm",
  cancelLabel = "cancel",
  danger,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="edit-panel-overlay" onClick={onCancel}>
      <div
        className="edit-panel confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>{title}</span>
        </header>
        <div className="confirm-body">
          <p>{message}</p>
        </div>
        <footer>
          <div className="row">
            <button onClick={onCancel}>{cancelLabel}</button>
            <button
              className={danger ? "danger" : "primary"}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
