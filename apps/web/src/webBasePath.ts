declare global {
  interface Window {
    /** Injected only when the native Web app is mounted by Convene. */
    __T3_BASE_PATH__?: string;
    __T3_INITIAL_PROJECT_ID__?: string | null;
  }
}

export function webBasePath(): string {
  return window.__T3_BASE_PATH__?.replace(/\/+$/, "") ?? "";
}
