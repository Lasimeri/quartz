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
export const USE_PLAYER_CARD = false;

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
