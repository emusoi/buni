import { review } from "./review.ts";
import { sourceSelector } from "./captureHtml.ts";

export interface ReviewOptions {
  /** The edit tier only: the quick, clear-cut checks run after each edit. */
  edit?: boolean;
  selector?: string;
}
/** A finding as the host reads it: the layers it is on (Buni's b-<id> classes), else where on the page. */
export interface FoundIssue { rule: string; message: string; nodes: string[]; selector: string }

declare global {
  interface Window { buniReview(options: ReviewOptions): string }
}

window.buniReview = (options) => {
  try {
    const root = options.selector ? document.querySelector(options.selector) : document.body;
    if (!root) throw new Error(`Nothing on the page matches ${options.selector}.`);
    const found = review(root, (rule) => !options.edit || rule.tier === "edit").map((f): FoundIssue => {
      const layer = f.el.closest("[class*='b-']");
      const nodes = layer ? [...layer.classList].filter((c) => c.startsWith("b-")).map((c) => c.slice(2)).slice(0, 1) : [];
      return { rule: f.rule, message: f.message, nodes, selector: sourceSelector(f.el) };
    });
    return JSON.stringify(found);
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
};
