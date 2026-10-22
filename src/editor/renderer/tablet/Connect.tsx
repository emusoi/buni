// Open on tablet: a tablet on a USB cable to this Mac opens the design in its Chrome, to draw on with a pen.
import { useEffect, useRef, useState } from "react";
import { Cable, Tablet, TabletSmartphone } from "lucide-react";
import type { Device, WiredList } from "../../usb.ts";

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 10 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
};

export function TabletButton({ onToast }: { onToast: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [wired, setWired] = useState<WiredList | undefined>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [opening, setOpening] = useState<string>();
  const ref = useRef<HTMLSpanElement>(null);
  const list = window.buni.tablets;

  // While it's open, the cable is watched: plugging in, allowing this Mac, unplugging all show within a couple of seconds.
  useEffect(() => {
    if (!open || !list) return;
    let live = true;
    const poll = () => {
      void list().then((w) => live && setWired(w), (e: unknown) => live && setWired({ error: e instanceof Error ? e.message : String(e) }));
      void window.buni.devices?.().then((d) => live && setDevices(d), () => undefined);
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { live = false; clearInterval(t); };
  }, [open, list]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  if (!list) return null;

  const show = async (serial: string) => {
    setOpening(serial);
    const r = await window.buni.openOnTablet?.(serial).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    setOpening(undefined);
    if (!r) return;
    onToast("error" in r ? r.error : r.locked ? `Opened on ${r.name}: unlock it to see the design.` : `Opened on ${r.name}. Draw with the S Pen.`);
  };
  const install = async (serial: string) => {
    setOpening(serial);
    onToast("Building the buni app and installing it on the tablet…");
    const r = await window.buni.installTabletApp?.(serial).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    setOpening(undefined);
    if (r) onToast("error" in r ? r.error : `The buni app is on ${r.name}. Open on tablet opens it there.`);
  };
  const fresh = devices.filter((d) => Date.now() - d.seen < 60_000);
  const tablets = wired && "tablets" in wired ? wired.tablets : [];
  return (
    <span className="export-anchor" ref={ref}>
      <button type="button" className={`icon-btn${open || fresh.length ? " on" : ""}`} title="Open on tablet" aria-label="Open on tablet" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <TabletSmartphone size={16} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="tablet-pop" role="dialog" aria-label="Open on your tablet">
          <div className="tablet-pop-head">
            <b>Open on your tablet</b>
            <span>Plug the tablet into this Mac with a USB cable. It reaches buni only through the cable; unplug it and it's gone.</span>
          </div>
          {!wired ? (
            <div className="tablet-wait">Looking for a tablet on the cable…</div>
          ) : "error" in wired ? (
            <div className="tablet-error"><span>{wired.error}</span></div>
          ) : tablets.length === 0 ? (
            <div className="tablet-steps">
              <span><Cable size={16} /> No tablet on the cable yet.</span>
              <ol>
                <li>Plug it in with a USB cable.</li>
                <li>On the tablet, turn on USB debugging (Settings, Developer options).</li>
                <li>Tap Allow when it asks about this Mac.</li>
              </ol>
            </div>
          ) : (
            <div className="tablet-wired">
              {tablets.map((t) => (
                <div key={t.serial} className="tablet-device">
                  <Tablet size={18} />
                  <div>
                    <b>{t.name}</b>
                    <span>{t.state === "ready" ? (t.app ? "On the cable · buni app" : "On the cable · opens in Chrome") : t.state === "unauthorized" ? "Unlock it and tap Allow on the USB debugging prompt" : "Not answering: plug it in again"}</span>
                    {t.state === "ready" && !t.app && <button type="button" className="tablet-link" disabled={opening === t.serial} onClick={() => void install(t.serial)}>Install the buni app</button>}
                  </div>
                  <button type="button" className="tablet-btn dark" disabled={t.state !== "ready" || opening === t.serial} onClick={() => void show(t.serial)}>
                    {opening === t.serial ? "Opening…" : "Open on tablet"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {devices.length > 0 && (
            <div className="tablet-devices">
              <span className="tablet-label">Opened on</span>
              {devices.map((d) => (
                <div key={d.id} className="tablet-device">
                  <span className={`tablet-dot${Date.now() - d.seen < 60_000 ? " on" : ""}`} />
                  <div><b>{d.name}</b><span>Seen {ago(d.seen)}</span></div>
                  <button type="button" className="tablet-link" onClick={() => void window.buni.forgetDevice?.(d.id).then(() => setDevices((all) => all.filter((x) => x.id !== d.id)))}>Disconnect</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
