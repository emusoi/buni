/** The native renderer owns the terminal; Buni keeps authoring and web rendering. */
export async function openTerminal(args: string[]): Promise<number> {
  const bin = process.env.BUNI_TUI_BIN ?? Bun.which("buni-tui");
  if (!bin) throw new Error("Install buni-tui to open a terminal session, or use buni open FILE --web for the browser editor.");
  const child = Bun.spawn([bin, "open", ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const stop = () => child.kill("SIGTERM");
  process.on("SIGTERM", stop);
  try { return await child.exited; }
  finally { process.off("SIGTERM", stop); }
}
