// The OS keychain, for anything buni keeps secret on this machine: the Wazo sign-in, and the agent's model keys.
import { AsyncEntry } from "@napi-rs/keyring";

/** Secret text by name: "provider:<id>" and "service:<name>". The OS keychain here; a hosted server keeps one per person. */
export interface Secrets {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** Off the main thread, so a macOS "allow access" prompt never freezes an app while it waits for you. */
const wait = () => AbortSignal.timeout(120_000);

/**
 * The OS keychain (macOS Keychain, libsecret, Windows Credential Manager). Every host on this machine uses the same
 * entries, the command line and the buni apps alike, so signing in anywhere works everywhere.
 */
export const osSecrets: Secrets = {
  async get(name) {
    try {
      return (await new AsyncEntry("buni", name).getPassword(wait())) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (name, value) => new AsyncEntry("buni", name).setPassword(value, wait()),
  async remove(name) {
    await new AsyncEntry("buni", name).deletePassword(wait()).catch(() => false);
  },
};
