// Every keyboard shortcut, on "?": the editor does a lot from the keys, and none of it is any use unless found.
import { X } from "lucide-react";

const GROUPS: [string, [string, string][]][] = [
  ["Layers", [
    ["Click / ⇧ click", "Select a layer, or add one to the selection"],
    ["Double-click text", "Edit it in place; ↵ keeps it, Esc puts it back"],
    ["↵ / ⇧↵", "Select the first child / the parent"],
    ["↑ ↓ ← →", "Move the layer among its siblings"],
    ["⌘D", "Duplicate"],
    ["⌘C / ⌘V", "Copy / paste into the selected frame or after the layer"],
    ["⌘G", "Wrap in a frame"],
    ["⌫", "Delete"],
    ["Double-click in Layers", "Rename; drag a row to move the layer"],
  ]],
  ["Canvas", [
    ["Space + drag", "Pan"],
    ["⌘ + scroll, pinch", "Zoom"],
    ["⇧1 / ⇧2", "Show every page / the selected one"],
    ["Esc", "Clear the selection"],
  ]],
  ["Editor", [
    ["⌘K", "Find anything, or run a command"],
    ["⌘I", "Insert a component"],
    ["⌘1 ⌘2 ⌘3", "Screens, System, Plan"],
    ["⌘\\", "Hide or show both side panels"],
    ["⌘Z / ⇧⌘Z", "Undo / redo"],
    ["⌘↵ in Code", "Apply the HTML"],
    ["?", "These shortcuts"],
  ]],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog shortcuts" role="dialog" aria-label="Keyboard shortcuts" onKeyDown={(e) => e.key === "Escape" && onClose()} tabIndex={-1} ref={(el) => el?.focus()}>
        <button type="button" className="icon-btn small dialog-x" aria-label="Close" onClick={onClose}><X size={14} /></button>
        <h2>Keyboard shortcuts</h2>
        <div className="shortcut-groups">
          {GROUPS.map(([title, rows]) => (
            <section key={title}>
              <h3>{title}</h3>
              <dl>{rows.map(([k, what]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{what}</dd></div>)}</dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
