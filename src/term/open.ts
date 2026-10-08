// Opening a page in this machine's browser, for a sign-in.

/** Opens a page in this machine's browser, for a sign-in. */
export function openUrl(url: string): void {
  // Not cmd /c start on Windows: cmd reads & in a URL as the start of another command.
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", url] : ["xdg-open", url];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}
