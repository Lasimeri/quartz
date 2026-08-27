// Link parsing and metadata. Nothing here knows about HTML or routing.

import { CACHE_OK, ID_RE, LIST_RE, TIME_RE } from './config';

export interface Target {
	id: string;
	/** Start offset, already validated. */
	t?: string;
	/** Playlist id, already validated. */
	list?: string;
}

export interface Meta {
	title: string;
	author: string;
	authorUrl: string;
	thumbnail: string;
}

/**
 * Pull a video id out of whatever was pasted after the base path.
 *
 * The awkward case: pasting a full watch url puts everything before the
 * "?" in our pathname and everything after it in our query string, so
 * "/yt/https://youtube.com/watch?v=ID&t=30" arrives as pathname
 * "/yt/https://youtube.com/watch" plus search "?v=ID&t=30". Both halves
 * are therefore searched.
 *
 * Accepted: a bare id, youtu.be/ID, watch?v=ID, /shorts/ID, /embed/ID,
 * /live/ID, /v/ID, with or without scheme, encoded or not.
 */
export function parseTarget(rest: string, params: URLSearchParams): Target | null {
	let id = '';

	// A "v" parameter is unambiguous, so it wins.
	const v = params.get('v');
	if (v && ID_RE.test(v)) id = v;

	if (!id) {
		// Decode once, tolerating malformed escapes rather than throwing.
		let decoded = rest;
		try { decoded = decodeURIComponent(rest); } catch { /* keep raw */ }

		// Strip a fragment, then take the last path-like segment that is
		// exactly an id. Host labels ("youtube.com", "youtu.be") and verbs
		// ("watch", "shorts") never match the 11-character shape.
		const [beforeHash] = decoded.split('#');
		for (const seg of beforeHash.split(/[/?&=]/)) {
			if (ID_RE.test(seg)) id = seg;
		}
	}

	if (!id) return null;

	const target: Target = { id };

	const t = params.get('t') || params.get('start') || '';
	if (t && TIME_RE.test(t) && t !== '') target.t = t;

	const list = params.get('list') || '';
	if (list && LIST_RE.test(list)) target.list = list;

	return target;
}

/** The canonical watch url for a target, on the configured origin. */
export function watchUrl(origin: string, target: Target): string {
	const q = new URLSearchParams({ v: target.id });
	if (target.list) q.set('list', target.list);
	if (target.t) q.set('t', target.t);
	return `${origin}/watch?${q}`;
}

/**
 * Title, channel, and thumbnail from YouTube's public oEmbed endpoint.
 * No key, no quota. Returns null for anything unplayable: deleted,
 * private, or region-blocked all answer 400 or 401.
 */
export async function fetchMeta(id: string): Promise<Meta | null> {
	const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
		`https://www.youtube.com/watch?v=${id}`,
	)}`;

	const res = await fetch(url, {
		headers: { 'User-Agent': 'quartz-embed/1.0' },
		cf: { cacheTtl: CACHE_OK, cacheEverything: true },
	});
	if (!res.ok) return null;

	const d: any = await res.json().catch(() => null);
	if (!d?.title) return null;

	return {
		title: d.title,
		author: d.author_name || '',
		authorUrl: d.author_url || '',
		thumbnail: d.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
	};
}

/**
 * Prefer the 1280x720 still over oEmbed's 480x360 one, since the large
 * image card renders it at full width. maxresdefault does not exist for
 * every video, so it is probed before being used.
 */
export async function bestThumbnail(id: string, fallback: string): Promise<string> {
	const maxres = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
	try {
		const res = await fetch(maxres, {
			method: 'HEAD',
			cf: { cacheTtl: CACHE_OK, cacheEverything: true },
		});
		if (res.ok) return maxres;
	} catch { /* fall through */ }
	return fallback;
}
