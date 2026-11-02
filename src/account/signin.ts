// Signing in to a buni server from the command line: an email and password buy an API token of the CLI's own, which
// the server then accepts as a bearer, so the command line can work on the designs kept there.

/** The signed-in person, as the server knows them. */
export interface Person {
  id: string;
  name: string;
  username: string;
  email?: string;
  /** A data: URL, ready for an <img>. */
  avatar?: string;
}

export class SignInError extends Error {}

type Fetch = typeof fetch;

/** Tokens only ever travel over https, or to this machine while developing against a local server. */
export function checkServer(server: string): string {
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    throw new SignInError(`"${server}" is not a server address`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new SignInError(`buni only signs in over https, not ${url.protocol}`);
  return url.origin;
}

async function call(server: string, path: string, init: RequestInit, fetcher: Fetch): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetcher(`${checkServer(server)}${path}`, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  } catch {
    throw new SignInError(`Couldn't reach ${new URL(server).host}. Check your connection and try again.`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  return { ok: response.ok, status: response.status, body: typeof body === "object" && body !== null ? { ...body } : {} };
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** A person as the server sends them, or undefined when the shape isn't one. */
export function personOf(v: unknown): Person | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o: Record<string, unknown> = { ...v };
  const [id, name, username, email, avatar] = [o.id, o.name, o.username, o.email, o.avatar].map(text);
  return id && name && username ? { id, name, username, ...(email ? { email } : {}), ...(avatar ? { avatar } : {}) } : undefined;
}

/** Signs in with an email and password; the server makes an API token named `name` for this machine. */
export async function signInWithPassword(server: string, email: string, password: string, name: string, fetcher: Fetch = fetch): Promise<{ token: string; person: Person }> {
  const r = await call(server, "/auth/token", { method: "POST", body: JSON.stringify({ email, password, name }) }, fetcher);
  if (r.status === 404) throw new SignInError(`${new URL(server).host} doesn't sign the command line in; is it a buni server?`);
  const token = text(r.body.token);
  const person = personOf(r.body.person);
  if (!r.ok || !token || !person) throw new SignInError(text(r.body.error) ?? "The server didn't accept the sign-in.");
  return { token, person };
}

/** Who a token belongs to; undefined once it is revoked. */
export async function fetchPerson(server: string, token: string, fetcher: Fetch = fetch): Promise<Person | undefined> {
  const r = await call(server, "/auth/me", { headers: { authorization: `Bearer ${token}` } }, fetcher);
  return r.body.state === "signed-in" ? personOf(r.body.person) : undefined;
}

/** Signs the token out on the server; a token already gone is fine. */
export async function revokeToken(server: string, token: string, fetcher: Fetch = fetch): Promise<void> {
  await call(server, "/auth/signout", { method: "POST", body: "{}", headers: { authorization: `Bearer ${token}` } }, fetcher).catch(() => undefined);
}
