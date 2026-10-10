import type { Doc, Id } from "buni/format/doc.ts";
import { srcdoc } from "./Canvas.tsx";

const SIZES = [16, 32, 48, 64];

/**
 * A graphic drawn at the sizes it will live at — a favicon, a tab, the Dock — on a light and a
 * dark surface, so a mark that falls apart small shows it here rather than after export.
 */
export function SmallSizes({ doc, page, dir }: { doc: Doc; page: Id; dir: string }) {
  const style = doc.nodes[doc.pages[page]?.frame ?? ""]?.style ?? {};
  const width = Number.parseInt(style.width ?? "", 10);
  const height = Number.parseInt(style.height ?? "", 10);
  if (!(width > 0) || !(height > 0)) return null;
  const html = srcdoc(doc, page, dir);
  return (
    <section className="group small-sizes">
      <div className="group-title">At small sizes</div>
      {["light", "dark"].map((surface) => (
        <div key={surface} className={`sizes-row ${surface}`}>
          {SIZES.map((s) => {
            const scale = s / Math.max(width, height);
            return (
              <div key={s} className="size-cell">
                <div className="size-box" style={{ width: width * scale, height: height * scale }}>
                  <iframe title={`${s}px`} sandbox="" srcDoc={html} tabIndex={-1} style={{ width, height, transform: `scale(${scale})` }} />
                </div>
                <span>{s}</span>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
