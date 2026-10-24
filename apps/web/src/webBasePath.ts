declare global {
  interface Window {
    /** Injected only when the native Web app is mounted by Convene. */
    __T3_BASE_PATH__?: string;
    __T3_REQUEST_BASE_PATH__?: string;
    __T3_ASSET_BASE_PATH__?: string;
    __T3_INITIAL_PROJECT_ID__?: string | null;
  }
}

export function webBasePath(): string {
  return window.__T3_BASE_PATH__?.replace(/\/+$/, "") ?? "";
}

export function webRequestBasePath(): string {
  return window.__T3_REQUEST_BASE_PATH__?.replace(/\/+$/, "") ?? webBasePath();
}

export function webAssetBasePath(): string {
  return window.__T3_ASSET_BASE_PATH__?.replace(/\/+$/, "") ?? webBasePath();
}
