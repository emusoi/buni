// An endpoint as a front-end developer meets it: an example request, the response for success or for each designed
// error, and, on the web, a curl line against the mock API that answers the same way.
import { useState } from "react";
import { Copy } from "lucide-react";
import type { Doc, Endpoint } from "buni/format/doc.ts";
import { exampleBody } from "buni/tools/backend.ts";

export function TryIt({ doc, endpoint: e, onToast }: { doc: Doc; endpoint: Endpoint; onToast: (m: string) => void }) {
  const [status, setStatus] = useState("200");
  const err = (e.errors ?? []).find((x) => x.code === status);
  const request = exampleBody(doc, e, "request");
  const hasBody = e.method !== "GET" && e.method !== "DELETE" && Object.keys(request).length > 0;
  const response = err ? { error: err.when } : exampleBody(doc, e, "response");
  const path = e.path.replace(/\{[^}]+\}/g, "1");
  const file = new URLSearchParams(location.search).get("file");
  const curl = file
    ? `curl -X ${e.method} '${location.origin}/mock${path}?file=${encodeURIComponent(file)}${status !== "200" ? `&status=${status}` : ""}'${hasBody ? ` \\\n  -H 'content-type: application/json' -d '${JSON.stringify(request)}'` : ""}`
    : undefined;
  return (
    <section className="try-it" aria-label="Try it">
      <div className="sys-row-label">Try it <span className="sys-row-hint">· example data from its shapes</span></div>
      <div className="try-line"><b>{e.method}</b> <span className="mono">{path}</span></div>
      {hasBody && (<><span className="prop-name">Request</span><pre className="try-json">{JSON.stringify(request, null, 2)}</pre></>)}
      <div className="try-status" role="radiogroup" aria-label="Response">
        {["200", ...(e.errors ?? []).map((x) => x.code)].map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === status} className={c === status ? "on" : ""} title={c === "200" ? "Success" : (e.errors ?? []).find((x) => x.code === c)?.when} onClick={() => setStatus(c)}>{c}</button>
        ))}
      </div>
      <pre className={`try-json${err ? " err" : ""}`}>{JSON.stringify(response, null, 2)}</pre>
      {curl && (
        <button type="button" className="link-btn" onClick={() => void navigator.clipboard.writeText(curl).then(() => onToast("Copied a curl line for the mock API."))}>
          <Copy size={12} /> Copy curl for the mock API
        </button>
      )}
    </section>
  );
}
