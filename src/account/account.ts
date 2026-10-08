// The buni account the command line is signed in to: which buni server keeps the designs, and the Wazo token it
// accepts. Kept in the OS keychain beside provider keys; where there is no keychain (a bare Linux server), in a file
// only this user can read. $BUNI_TOKEN stands in for a sign-in in CI and for agents.
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { osSecrets, type Secrets } from "./keychain.ts";
import { checkServer, type Person } from "./wazo.ts";

/** Where designs are kept unless $BUNI_SERVER_URL or `buni login --server` says otherwise. */
export const DEFAULT_SERVER = process.env.BUNI_SERVER_URL ?? "https://buni.emusoi.app";

export interface Account {
  /** The buni server, as an origin: https://buni.emusoi.app */
  server: string;
  token: string;
  /** Who signed in; unknown for a token given in $BUNI_TOKEN until the server is asked. */
  person?: Person;
}

const NAME = "account:buni";
/** Where the sign-in is kept when there is no keychain. */
export const ACCOUNT_FILE = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "buni", "account.json");

function text(o: object, k: string): string | undefined {
  const fields: Record<string, unknown> = { ...o };
  const v = fields[k];
  return typeof v === "string" && v ? v : undefined;
}

function personOf(v: unknown): Person | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const [id, name, username, email, avatar] = ["id", "name", "username", "email", "avatar"].map((k) => text(v, k));
  return id && name && username ? { id, name, username, ...(email ? { email } : {}), ...(avatar ? { avatar } : {}) } : undefined;
}

function parse(raw: string | undefined): Account | undefined {
  if (!raw) return undefined;
  try {
    const o: unknown = JSON.parse(raw);
    if (typeof o !== "object" || o === null) return undefined;
    const server = text(o, "server");
    const token = text(o, "token");
    if (!server || !token) return undefined;
    const person = personOf("person" in o ? o.person : undefined);
    return { server, token, ...(person ? { person } : {}) };
  } catch {
    return undefined;
  }
}

/** The account in use: $BUNI_TOKEN, else the one saved by `buni login`. */
export async function loadAccount(secrets: Secrets = osSecrets, file = ACCOUNT_FILE): Promise<Account | undefined> {
  const token = process.env.BUNI_TOKEN;
  if (token) return { server: checkServer(DEFAULT_SERVER), token };
  return parse(await secrets.get(NAME)) ?? parse(await readFile(file, "utf8").catch(() => undefined));
}

/** Keeps the account; says where, since a file is weaker than the keychain. */
export async function saveAccount(account: Account, secrets: Secrets = osSecrets, file = ACCOUNT_FILE): Promise<"keychain" | "file"> {
  const text = JSON.stringify(account);
  try {
    await secrets.set(NAME, text);
    return "keychain";
  } catch {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, text, { mode: 0o600 });
    // The mode above only applies to a new file; one left from before is tightened too.
    await chmod(file, 0o600);
    return "file";
  }
}

export async function forgetAccount(secrets: Secrets = osSecrets, file = ACCOUNT_FILE): Promise<void> {
  await secrets.remove(NAME);
  await rm(file, { force: true });
}

/** The account to work as, or a clear way to get one. */
export async function signedIn(): Promise<Account> {
  const account = await loadAccount();
  if (!account) throw new Error("Not signed in. Run: buni login");
  return account;
}
