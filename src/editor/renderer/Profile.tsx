// You, at the bottom of the rail: signed in with Wazo (your picture, name and a menu), or a way to sign in.
import { useEffect, useState } from "react";
import { ExternalLink, LogIn, LogOut, Monitor, Moon, Sun, UserRound, X } from "lucide-react";
import type { AccountState, ThemeChoice } from "../api.ts";

export function useAccount(): AccountState {
  const [state, setState] = useState<AccountState>({ state: "signed-out" });
  useEffect(() => {
    void window.buni.account().then(setState);
    return window.buni.onAccount(setState);
  }, []);
  return state;
}

function Avatar({ name, src, size = 24 }: { name: string; src?: string | undefined; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
  return src
    ? <img className="avatar" src={src} alt="" width={size} height={size} />
    : <span className="avatar initials" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">{initials || "?"}</span>;
}

const THEMES: [ThemeChoice, string, typeof Sun][] = [["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "Match System", Monitor]];

/** Light, dark or the system's, always in reach at the foot of the rail. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  useEffect(() => void window.buni.theme().then(setTheme), []);
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Appearance">
      {THEMES.map(([t, label, Icon]) => (
        <button key={t} type="button" role="radio" aria-checked={theme === t} title={label} className={theme === t ? "on" : ""} onClick={() => { setTheme(t); void window.buni.setTheme(t); }}>
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

/** `compact`: a sign-in button or your picture, beside the agents' status at the foot of a file's rail. */
export function Profile({ compact = false }: { compact?: boolean }) {
  const account = useAccount();
  const [menu, setMenu] = useState(false);
  const [asked, setAsked] = useState(false);
  // The dialog stays up from asking until signed in, cancelled, or it failed and was dismissed.
  const dialog = asked && account.state !== "signed-in";
  useEffect(() => {
    if (account.state === "signed-in") setAsked(false);
  }, [account.state]);

  if (window.buni.noAccounts) return null;
  if (account.state !== "signed-in") {
    return (
      <div className={`profile${compact ? " compact" : ""}`}>
        <button type="button" className="profile-row sign-in" title="Sign in with Wazo: one account for Wazo and buni" onClick={() => { setAsked(true); void window.buni.signIn(); }}>
          <LogIn size={15} strokeWidth={1.75} />
          {compact ? <span>Sign in</span> : <span className="profile-who"><b>Sign in with Wazo</b><small>One account for Wazo and buni</small></span>}
        </button>
        {dialog && <SignInDialog account={account} onClose={() => { setAsked(false); void window.buni.cancelSignIn(); }} onRetry={() => void window.buni.signIn()} />}
      </div>
    );
  }
  const { person, server } = account;
  return (
    <div className={`profile${compact ? " compact" : ""}`}>
      {menu && (
        <div className="profile-menu" role="menu" onPointerLeave={() => setMenu(false)} onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
          <div className="profile-head">
            <Avatar name={person.name} src={person.avatar} size={36} />
            <span className="profile-who"><b>{person.name}</b><small>{person.email ?? `@${person.username}`}</small></span>
          </div>
          <div className="profile-note">Signed in with Wazo{new URL(server).host === "wazo.emusoi.app" ? "" : ` · ${new URL(server).host}`}</div>
          <button type="button" role="menuitem" className="menu-chat preset" onClick={() => { setMenu(false); void window.buni.openAccountPage(); }}>
            <span className="menu-name"><UserRound size={14} /> Your Wazo account</span>
            <ExternalLink size={13} className="dim" />
          </button>
          <div className="menu-rule" />
          <button type="button" role="menuitem" className="menu-chat preset" onClick={() => { setMenu(false); void window.buni.signOut(); }}>
            <span className="menu-name"><LogOut size={14} /> Sign out</span>
          </button>
        </div>
      )}
      <button type="button" className="profile-row" aria-haspopup="menu" aria-expanded={menu} title={compact ? person.name : undefined} onClick={() => setMenu((m) => !m)}>
        <Avatar name={person.name} src={person.avatar} />
        {!compact && <span className="profile-who"><b>{person.name}</b><small>@{person.username}</small></span>}
      </button>
    </div>
  );
}

/** The code to compare, while the person approves it in the browser. */
function SignInDialog({ account, onClose, onRetry }: { account: AccountState; onClose: () => void; onRetry: () => void }) {
  const [left, right] = account.state === "waiting" ? account.userCode.split("-") : [];
  const error = account.state === "signed-out" ? account.error : undefined;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog sign-in-dialog" role="dialog" aria-label="Sign in with Wazo" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <button type="button" className="icon-btn small dialog-x" aria-label="Cancel" onClick={onClose}><X size={14} /></button>
        <h2>Sign in with Wazo</h2>
        {account.state === "waiting" ? (
          <>
            <p>Your browser opened Wazo. Check it shows this code, then choose Allow.</p>
            <div className="sign-in-code" aria-label={`Code ${account.userCode}`}>
              {[...(left ?? "")].map((c, i) => <span key={`l${i}`}>{c}</span>)}<i aria-hidden="true" />{[...(right ?? "")].map((c, i) => <span key={`r${i}`}>{c}</span>)}
            </div>
            <p className="sign-in-wait"><span className="live" /> Waiting for you to allow it…</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => void window.buni.openSignIn()}><ExternalLink size={13} /> Open the page again</button>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : error ? (
          <>
            <p className="sign-in-error">{error}</p>
            <div className="dialog-actions">
              <button type="button" className="btn primary" onClick={onRetry}>Try again</button>
              <button type="button" className="btn" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <p className="sign-in-wait"><span className="live" /> Asking Wazo for a code…</p>
        )}
      </div>
    </div>
  );
}
