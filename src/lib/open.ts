// Handing an address or a file to the operating system: the default handler for a link (claude://, https://), and
// the file manager for a saved file. macOS and Windows; elsewhere xdg-open.
import { execFile } from "node:child_process";

export function openUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (error: Error | null) => resolve(!error);
    // rundll32 hands the address to its registered handler without going through cmd, which would read & and ^.
    if (process.platform === "win32") execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], done);
    else if (process.platform === "darwin") execFile("/usr/bin/open", [url], done);
    else execFile("xdg-open", [url], done);
  });
}

export function revealFile(path: string): void {
  if (process.platform === "win32") execFile("explorer.exe", [`/select,${path}`], () => undefined);
  else if (process.platform === "darwin") execFile("/usr/bin/open", ["-R", path], () => undefined);
  else execFile("xdg-open", [path.replace(/[\\/][^\\/]*$/, "")], () => undefined);
}
