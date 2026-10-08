/**
 * Getting this page onto a headset.
 *
 * Typing a long URL on a VR keyboard is hopeless, so the headset gets a short
 * pairing code instead: the pairing service holds code -> link for a while,
 * and a headset that opens the service and types the code is sent on to the
 * link. Ported from cramera's `core/share-link.js`; kept free of React.
 */

/** Query parameter an access token travels in (Jupyter's, behind its proxy). */
const TOKEN_PARAM = "token";
/** sessionStorage key the token is remembered under once the page has seen it. */
const TOKEN_KEY = "bambot.session-token";
/** Where headsets redeem pairing codes; overridden with `?pair=<url>`. */
export const PAIRING_SERVICE = "https://vr.aicor.dev";

export type Pairing = {
  code: string;
  /** Expiry in ms since the epoch, or null if the service gave none. */
  expiresAt: number | null;
};

/**
 * The access token this page was opened with, remembered for the rest of the
 * tab: once the proxy has set its cookie the token can drop out of the address
 * bar while the page keeps working, which would leave nothing to share.
 */
export function sessionToken(search: string, storage: Storage | null): string | null {
  const token = new URLSearchParams(search).get(TOKEN_PARAM);
  try {
    if (token) {
      storage?.setItem(TOKEN_KEY, token);
      return token;
    }
    return storage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    // Storage blocked (private mode): fall back to what the URL says.
    return token;
  }
}

/**
 * The link a headset should open: this page with the token added, opened as
 * the ROS 2 leader - the headset is where the VR controllers are, so it is
 * the one sending commands.
 */
export function headsetLink(href: string, token: string | null): string {
  const url = new URL(href);
  url.hash = "";
  if (token) url.searchParams.set(TOKEN_PARAM, token);
  url.searchParams.set("ros2role", "leader");
  return url.toString();
}

/** The pairing service's base URL, without a trailing slash. */
export function pairingService(search: string): string {
  const override = new URLSearchParams(search).get("pair");
  return (override || PAIRING_SERVICE).replace(/\/+$/, "");
}

/** The service address shown to headset users, without its scheme - the part they type. */
export function typedAddress(service: string): string {
  return service.replace(/^https?:\/\//, "");
}

/**
 * Asks the pairing service for a code that leads to `target`.
 *
 * @throws When the service cannot be reached, refuses, or sends no code.
 */
export async function requestPairingCode(service: string, target: string): Promise<Pairing> {
  const response = await fetch(`${service}/api/pairings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: target }),
    credentials: "omit",
  });
  if (!response.ok) throw new Error(`pairing service answered ${response.status}`);
  const answer = await response.json();
  if (!answer?.code) throw new Error("pairing service sent no code");
  return { code: String(answer.code), expiresAt: Date.parse(answer.expires_at) || null };
}

/**
 * Why the link may not work on a headset, or null. A headset cannot reach
 * this machine's localhost, and a page behind Jupyter's proxy opened without
 * a token sends the headset to a login it cannot complete.
 */
export function linkWarning(href: string, token: string | null): string | null {
  const url = new URL(href);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return "This page is on localhost, which the headset cannot reach. Open it by this machine's network address (over HTTPS) before sharing.";
  }
  if (!token && url.pathname.includes("/proxy/")) {
    return "This page was opened without an access token, so the headset will be asked to sign in. Open it with ?token=… to share it.";
  }
  return null;
}
