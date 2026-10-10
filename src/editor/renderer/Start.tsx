import { useState } from "react";
import { Copy } from "lucide-react";

/** An empty file opens on a question, not a blank canvas: say what you are making and hand it to a coding agent. */
export function Start({ onBlank, onSystem, mcpUrl, onToast }: {
  /** Where a coding agent connects to this file. */
  mcpUrl: string;
  onToast: (t: string) => void;
  onBlank: () => void;
  /** Starts from the system instead of a screen. */
  onSystem: () => void;
}) {
  const [text, setText] = useState("");
  const brief = () => `Using the buni MCP tools, design this in the open file. Start with read_tree and list_skills, then build page by page: ${text.trim()}`;
  const send = () => {
    if (text.trim()) void navigator.clipboard.writeText(brief()).then(() => onToast("Copied; paste it to Claude Code or Codex and watch it land here."));
  };
  return (
    <div className="start">
      <div className="start-inner">
        <h2>What are you designing?</h2>
        <p>Describe it, then hand it to Claude Code or Codex; it builds here while you watch.</p>
        <div className="start-prompt">
          <textarea
            autoFocus
            rows={3}
            placeholder="A portfolio for a product designer…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="start-foot">
            <span className="grow" />
            <button type="button" className="bar-btn dark round" disabled={!text.trim()} onClick={send}>Copy for your agent <Copy size={13} /></button>
          </div>
        </div>
        {/* Other ways in, as one quiet line: the prompt is the way most people start. */}
        <div className="start-alts">
          <button type="button" onClick={onBlank}>Blank page</button>
          <button type="button" onClick={onSystem}>Sketch the system</button>
          <button type="button" onClick={() => setText("Study https:// and design ")}>From a website</button>
        </div>
        <button type="button" className="start-connect" title="Copy" onClick={() => void navigator.clipboard.writeText(`claude mcp add --transport http buni "${mcpUrl}"`).then(() => onToast("Copied the Claude Code line."))}>
          <span>Not connected yet? In Claude Code:</span>
          <code>claude mcp add --transport http buni "{mcpUrl}"</code>
          <Copy size={13} />
        </button>
      </div>
    </div>
  );
}
