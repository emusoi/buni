import { expect, test } from "bun:test";
import { allowedCall, allowedOrigin, localOrigins, isDesignFile, isDesignPath, mockOrigin } from "./guard.ts";

const local = localOrigins(7720);
const req = (headers: Record<string, string>) => new Request("http://localhost:7720/rpc/removeFile", { method: "POST", headers });

test("another site's page can't call in; buni's page and local tools can", () => {
  expect(allowedCall(req({ origin: "https://evil.example", "content-type": "application/json" }), local)).toBe(false);
  expect(allowedCall(req({ origin: "http://localhost:7720", "content-type": "text/plain" }), local)).toBe(false);
  expect(allowedCall(req({ origin: "http://localhost:7720", "content-type": "application/json" }), local)).toBe(true);
  expect(allowedCall(req({ "content-type": "application/json; charset=utf-8" }), local)).toBe(true);
  expect(allowedOrigin(req({ origin: "http://localhost:3000" }), local)).toBe(false);
  // Hosted, only the public origin calls in.
  expect(allowedCall(req({ origin: "https://buni.emusoi.app", "content-type": "application/json" }), new Set(["https://buni.emusoi.app"]))).toBe(true);
  expect(allowedCall(req({ origin: "http://localhost:7720", "content-type": "application/json" }), new Set(["https://buni.emusoi.app"]))).toBe(false);
});

test("the mock answers local pages on any port, never other sites", () => {
  expect(mockOrigin(req({ origin: "http://localhost:3000" }))).toBe("http://localhost:3000");
  expect(mockOrigin(req({ origin: "http://127.0.0.1:5173" }))).toBe("http://127.0.0.1:5173");
  expect(mockOrigin(req({ origin: "https://evil.example" }))).toBeUndefined();
  expect(mockOrigin(req({ origin: "http://localhost.evil.example" }))).toBeUndefined();
});

test("only a design's own file can be deleted or moved, and /files/ serves only design folders", () => {
  expect(isDesignPath("/designs/Parcel returns/Parcel returns.buni")).toBe(true);
  for (const p of ["/designs/x.buni", "/x", "/designs/a/../b/c.buni", "/designs/a/b/c.buni", 42]) expect(isDesignPath(p)).toBe(false);
  expect(isDesignFile("/designs/Parcel returns/assets/logo.png")).toBe(true);
  expect(isDesignFile("/designs/../secrets")).toBe(false);
  expect(isDesignFile("/other/file")).toBe(false);
  // Hosted, each person's designs are their own folder: another's are out of reach.
  expect(isDesignPath("/people/u1/Shop/Shop.buni", "/people/u1")).toBe(true);
  expect(isDesignPath("/people/u2/Shop/Shop.buni", "/people/u1")).toBe(false);
  expect(isDesignPath("/people/u1/../u2/Shop/Shop.buni", "/people/u1")).toBe(false);
  expect(isDesignFile("/people/u1/Shop/assets/a.png", "/people/u1")).toBe(true);
  expect(isDesignFile("/people/u10/Shop/assets/a.png", "/people/u1")).toBe(false);
});
