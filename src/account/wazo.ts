// Signing in with Wazo, the device flow: buni asks Wazo for a code, the person approves it on Wazo's site, and buni
// collects an access token of its own. A buni server accepts that token as a bearer, so the command line can work on
// the designs kept there.

/** Wazo's site; BUNI_WAZO_URL points buni at another one (a local Wazo, staging). */
export const WAZO_URL = process.env.BUNI_WAZO_URL ?? "https://wazo.emusoi.app";

/** The signed-in person, as Wazo knows them. */
export interface Person {
  id: string;
  name: string;
  username: string;
  email?: string;
  /** A data: URL, ready for an <img>. */
  avatar?: string;
}

/** A sign-in in progress: the code the person compares by eye, and the page that approves it. */
export interface Started {
  deviceCode: string;
  userCode: string;
  url: string;
  intervalMs: number;
  expiresAt: number;
}

export class WazoError extends Error {}

type Fetch = typeof fetch;
type Reply<T> = { status: number; data: T | undefined; error: string | undefined };

/** Tokens only ever travel over https, or to this machine while developing against a local Wazo. */
export function checkServer(server: string): string {
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    throw new WazoError(`"${server}" is not a Wazo address`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new WazoError(`buni only signs in to Wazo over https, not ${url.protocol}`);
  return url.origin;
}

async function call<T>(server: string, path: string, init: RequestInit, fetcher: Fetch): Promise<Reply<T>> {
  let response: Response;
  try {
    response = await fetcher(`${checkServer(server)}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  } catch {
    throw new WazoError("Couldn't reach Wazo. Check your connection and try again.");
  }
  const body: unknown = await response.json().catch(() => undefined);
  const o: Record<string, unknown> = typeof body === "object" && body !== null ? { ...body } : {};
  const error = typeof o.error === "string" ? o.error : typeof o.message === "string" && !response.ok ? o.message : undefined;
  // Wazo wraps every answer as { success, data }; the shape of data is checked by each caller.
  return { status: response.status, data: o.data as T | undefined, error };
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Asks Wazo for a code; the person opens `url` to approve it. `clientName` is what the approval page shows. */
export async function startSignIn(server: string, clientName: string, fetcher: Fetch = fetch): Promise<Started> {
  const r = await call<Record<string, unknown>>(server, "/api/auth/device/start", { method: "POST", body: JSON.stringify({ clientName }) }, fetcher);
  if (r.status === 404) throw new WazoError(`${new URL(server).host} can't sign other apps in yet. It needs the Wazo update that adds device sign-in.`);
  const deviceCode = text(r.data?.deviceCode);
  const userCode = text(r.data?.userCode);
  const page = text(r.data?.verificationUri);
  if (r.status !== 200 || !deviceCode || !userCode || !page) throw new WazoError(r.error ?? "Wazo couldn't start a sign-in. Try again in a moment.");
  checkServer(page); // It opens in the browser: only ever an https page (or this machine).
  const interval = typeof r.data?.interval === "number" ? r.data.interval : 3;
  const expiresIn = typeof r.data?.expiresIn === "number" ? r.data.expiresIn : 900;
  const approve = new URL(page);
  approve.searchParams.set("code", userCode);
  return { deviceCode, userCode, url: approve.href, intervalMs: Math.max(1, interval) * 1000, expiresAt: Date.now() + expiresIn * 1000 };
}

export type Poll = { state: "pending" } | { state: "approved"; token: string } | { state: "expired" };

/** One look at whether the person approved the code yet. */
export async function pollSignIn(server: string, deviceCode: string, fetcher: Fetch = fetch): Promise<Poll> {
  const r = await call<Record<string, unknown>>(server, "/api/auth/device/token", { method: "POST", body: JSON.stringify({ deviceCode }) }, fetcher);
  if (r.status === 410) return { state: "expired" };
  if (r.status !== 200) throw new WazoError(r.error ?? "Wazo couldn't finish the sign-in.");
  const token = text(r.data?.token);
  if (r.data?.state === "approved" && token) return { state: "approved", token };
  return { state: "pending" };
}

/** Polls until the person approves, the code expires, or `signal` aborts. */
export async function waitForApproval(server: string, started: Started, signal: AbortSignal, fetcher: Fetch = fetch): Promise<string> {
  while (!signal.aborted) {
    if (Date.now() > started.expiresAt) break;
    const p = await pollSignIn(server, started.deviceCode, fetcher);
    if (p.state === "approved") return p.token;
    if (p.state === "expired") break;
    await new Promise<void>((done) => {
      const stop = () => { clearTimeout(t); done(); };
      const t = setTimeout(() => { signal.removeEventListener("abort", stop); done(); }, started.intervalMs);
      signal.addEventListener("abort", stop, { once: true });
    });
  }
  if (signal.aborted) throw new WazoError("Sign-in cancelled.");
  throw new WazoError("That code expired. Start the sign-in again.");
}

/** Who the token belongs to; undefined when Wazo no longer accepts it (revoked, or the account is gone). */
export async function fetchPerson(server: string, token: string, fetcher: Fetch = fetch): Promise<Person | undefined> {
  const r = await call<Record<string, unknown>>(server, "/api/auth/me", { headers: { Authorization: `Bearer ${token}` } }, fetcher);
  if (r.status === 401 || r.status === 403) return undefined;
  const id = text(r.data?.id);
  const username = text(r.data?.username);
  if (r.status !== 200 || !id || !username) throw new WazoError(r.error ?? "Wazo didn't say who you are.");
  const email = text(r.data?.email);
  const avatar = await avatarData(text(r.data?.avatar), fetcher);
  return {
    id, username, name: text(r.data?.name) ?? username,
    // A workspace carries a reserved .invalid address; it's not somewhere to write to.
    ...(email && !email.endsWith(".invalid") ? { email } : {}),
    ...(avatar ? { avatar } : {}),
  };
}

/** Avatars come as data: URLs (uploaded) or https links (Google, GitHub); the window only shows data: images. */
async function avatarData(avatar: string | undefined, fetcher: Fetch): Promise<string | undefined> {
  if (!avatar) return undefined;
  if (/^data:image\/(png|jpeg|gif|webp);base64,/.test(avatar)) return avatar;
  if (!avatar.startsWith("https://")) return undefined;
  try {
    const response = await fetcher(avatar);
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || !/^image\/(png|jpeg|gif|webp)$/.test(type) || bytes.length > 1_000_000) return undefined;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** Signs this token out on Wazo. A Wazo from before tokens could sign themselves out says 404; nothing more to do then. */
export async function revokeToken(server: string, token: string, fetcher: Fetch = fetch): Promise<void> {
  await call(server, "/api/tokens/self", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }, fetcher).catch(() => undefined);
}
