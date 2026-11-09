// The open flow in the inspector: its steps in walking order (each opens its page) and Play.
import { Play } from "lucide-react";
import { walkFlow, type Doc, type Id } from "buni/format/doc.ts";

export function FlowSummary({ doc, flow, onOpenPage, onPlay }: { doc: Doc; flow: Id; onOpenPage: (page: Id) => void; onPlay: (page: Id) => void }) {
  const f = doc.flows[flow];
  if (!f) return null;
  const steps = walkFlow(doc, f.start).pages.filter((p) => doc.pages[p]);
  return (
    <div className="page-summary flow-summary">
      <div className="layer-head">
        <div className="layer-who"><b>{f.name}</b><span>Flow · {steps.length} screen{steps.length === 1 ? "" : "s"}</span></div>
        <button type="button" className="btn small" onClick={() => onPlay(f.start)}><Play size={12} /> Play</button>
      </div>
      <section className="sum-group">
        <h3>Steps <span className="n">{steps.length}</span></h3>
        <ol className="flow-steps">
          {steps.map((p, i) => (
            <li key={p}><button type="button" className="sum-row" onClick={() => onOpenPage(p)}><span className="step-n">{i + 1}</span><span className="sum-title">{doc.pages[p]?.name}</span></button></li>
          ))}
        </ol>
      </section>
    </div>
  );
}
