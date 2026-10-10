// Small questions asked in the window, instead of the browser's own prompt and confirm boxes.
import { useState } from "react";
import { X } from "lucide-react";

/** Asks for a name; Enter keeps it, Escape or a click outside cancels. */
export function NameDialog({ title, label, initial, action, onSubmit, onClose }: { title: string; label: string; initial: string; action: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const ok = name.trim() !== "";
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()} onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(name.trim()); }}>
        <button type="button" className="icon-btn small dialog-x" aria-label="Cancel" onClick={onClose}><X size={14} /></button>
        <h2>{title}</h2>
        <label className="dialog-field">
          <span>{label}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <div className="dialog-actions">
          <button type="submit" className="btn primary" disabled={!ok}>{action}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/** Asks before something that can't be undone, naming exactly what goes. */
export function ConfirmDialog({ title, body, action, onConfirm, onClose }: { title: string; body: string; action: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="alertdialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="dialog-actions">
          <button type="button" className="btn danger" autoFocus onClick={onConfirm}>{action}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
