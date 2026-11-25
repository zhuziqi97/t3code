import { expect, it } from "vite-plus/test";

import { conveneSessionNeedsNavigation } from "./conveneSessionRecovery";

it.each([
  { code: "REMOTE_SESSION_EXPIRED", status: 401, details: {}, navigate: true },
  { code: "REMOTE_SESSION_NOT_FOUND", status: 401, details: {}, navigate: true },
  { code: "RUNNER_REVOKED", status: 401, details: {}, navigate: false },
  { code: "REMOTE_SESSION_UNAVAILABLE", status: 409, details: {}, navigate: false },
  {
    code: "REMOTE_SESSION_UNAVAILABLE",
    status: 409,
    details: { detail: { reason: "CLIENT_BUILD_CHANGED" } },
    navigate: true,
  },
])(
  "uses both Convene's status and error contract for $code ($navigate)",
  async ({ code, status, details, navigate }) => {
    const response = Response.json({ code, ...details }, { status });
    expect(await conveneSessionNeedsNavigation(response)).toBe(navigate);
  },
);
