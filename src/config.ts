// Everything worth tweaking lives here.
//
// The worker reads its own hostname and base path from each request, so
// nothing in src/ needs editing to run somewhere else.

/** Where humans land. Point this at a self-hosted frontend (Invidious,
 *  Piped) to route viewers there instead; leave as YouTube otherwise.
 *  Format: origin only, no trailing slash. */
export const WATCH_ORIGIN = 'https://www.youtube.com';

/** Path prefix the worker is mounted under, matching the route pattern. */
export const BASE = '/yt';

/** Accent colour of the Discord embed's left bar. */
export const THEME_COLOR = '#c4945a';

/**
 * Serve a player card instead of a large image card. Discord only
 * renders inline players for domains on its own allowlist, so this is
 * off by default: an unhonoured player card shows less than an image
 * card, not more.
 */
/**
 * How the embed offers video.
 *
 *   'off'      image card only.
 *   'iframe'   youtube.com/embed tags; only renders where the chat
 *              client allowlists that host, which Discord mobile does
 *              not. Costs nothing to try.
 *   'proxy'    the worker serves the single-file 360p stream itself at
 *              <BASE>/media/<id>.mp4. Real inline playback everywhere,
 *              no allowlist involved, no backend to run. Bytes transit
 *              the worker, which is the cost.
 *   'external' same, but the file comes from MEDIA_ORIGIN, a backend
 *              that can mux above 360p. See SETUP.md section 7.
 */
export type MediaMode = 'off' | 'iframe' | 'proxy' | 'external';
export const MEDIA_MODE: MediaMode = 'off';

/**
 * Origin of a backend that serves a single muxed MP4 per video id, at
 * `${MEDIA_ORIGIN}/<id>.mp4`. Set this and Discord's native player
 * takes over: real inline playback, at whatever quality the backend
 * muxes, with no dependence on anyone's allowlist.
 *
 * Empty disables it and the worker falls back to an image card or the
 * allowlist-dependent iframe tags. See SETUP.md section 7 for the
 * contract the backend must satisfy and a reference implementation.
 *
 * Format: origin only, no trailing slash.
 */
export const MEDIA_ORIGIN = '';

/** Dimensions advertised for the muxed file. Match your backend. */
export const MEDIA_WIDTH = 1280;
export const MEDIA_HEIGHT = 720;

/** User agents that receive OpenGraph HTML instead of a redirect. */
export const BOT_UA =
	/discordbot|telegrambot|slackbot|twitterbot|whatsapp|facebookexternalhit|linkedinbot|mastodon|pleroma|misskey|summalybot|bluesky|skypeuripreview|redditbot|embed/i;

/** YouTube video ids: exactly 11 url-safe base64 characters. */
export const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Timestamps: 90, or 1h2m3s. */
export const TIME_RE = /^(\d+|(?:\d+h)?(?:\d+m)?(?:\d+s)?)$/;

/** Playlist ids. */
export const LIST_RE = /^[A-Za-z0-9_-]{2,50}$/;

/** Requests per IP per window before a 429. */
export const RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60_000;

/** Edge cache lifetimes, seconds. */
export const CACHE_OK = 3600;
export const CACHE_MISSING = 300;
