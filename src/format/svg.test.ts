import { expect, test } from "bun:test";
import { svgProblem } from "./svg.ts";

test("drawings pass: icons, gradients, filters, text and animation", () => {
  for (const ok of [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><circle cx="12" cy="12" r="10"/></svg>',
    '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs><rect width="10" height="10" fill="url(#g)" style="filter:url(#f)"/></svg>',
    '<svg><text x="1" y="9">Hi <tspan>there</tspan></text><use href="#g"/><a href="https://buni.emusoi.app"><rect width="1" height="1"/></a></svg>',
    '<svg><circle r="4"><animate attributeName="r" values="4;6;4" dur="2s" repeatCount="indefinite"/></circle></svg>',
    '<svg><image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/></svg>',
  ]) expect(svgProblem(ok)).toBeUndefined();
});

test("nothing that runs, embeds HTML or loads from elsewhere gets in, however it's spelled", () => {
  for (const bad of [
    '<svg onload="alert(1)"></svg>',
    "<svg><script>alert(1)</script></svg>",
    "<svg><foreignObject><div>x</div></foreignObject></svg>",
    '<svg><a href="javas&#99;ript:alert(1)"><rect width="9" height="9"/></a></svg>',
    '<svg><a href=" java\tscript:alert(1)"><rect/></a></svg>',
    '<svg><a xlink:href="javascript:alert(1)"><rect/></a></svg>',
    '<svg><a><animate attributeName="href" values="javas&#x63;ript:alert(1)"/></a></svg>',
    '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
    '<svg><image href="https://tracker.example/p.png"/></svg>',
    '<svg><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>',
    '<svg><use href="https://example.com/sprite.svg#a"/></svg>',
    "<svg><style>@import url(https://example.com/x.css)</style></svg>",
    '<svg><rect style="fill:url(https://example.com/t.png)"/></svg>',
    "<svg><iframe src=\"https://example.com\"></iframe></svg>",
    "<div><svg></svg></div>",
    "<svg></svg><svg></svg>",
  ]) expect(svgProblem(bad), bad).toBeDefined();
});
