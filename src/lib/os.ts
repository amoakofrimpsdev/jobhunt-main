"use client";
// The system Jobhunt runs on, for the words on screen ("Finder" or "File Explorer"). The server and the browser are
// the same computer, so the browser's own report is the answer. The first render, on the server, uses words that fit
// any system.
import { useSyncExternalStore } from "react";

export type Os = "mac" | "windows" | "other";

function detect(): Os {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`;
  return /win/i.test(p) ? "windows" : /mac/i.test(p) ? "mac" : "other";
}

const subscribe = () => () => undefined;

export function useOs(): Os {
  return useSyncExternalStore(subscribe, detect, () => "other");
}

export const FILE_MANAGER: Record<Os, string> = { mac: "Finder", windows: "File Explorer", other: "its folder" };
export const KEY_STORE: Record<Os, string> = {
  mac: "Kept in the macOS Keychain",
  windows: "Kept encrypted with your Windows sign-in",
  other: "Kept in a file only your account can read",
};
export const RESUME_FOLDER_EXAMPLE: Record<Os, string> = {
  mac: "~/Documents/Resumes", windows: "C:\\Users\\you\\Documents\\Resumes", other: "~/Documents/Resumes",
};
