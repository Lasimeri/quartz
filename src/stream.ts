// Stream acquisition via InnerTube.
//
// The ANDROID_VR client returns direct googlevideo urls with no PO
// token, no signature cipher, and no "n" throttling parameter, for both
// progressive and adaptive formats. That is what makes proxying viable
// from a Worker at all. It is also undocumented and can change without
// notice: if playback starts 403ing, this is the file to look at.

import { CACHE_OK } from './config';

const INNERTUBE = 'https://www.youtube.com/youtubei/v1/player';
const VR_UA = 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip';

/** Progressive, already-muxed format. 360p, H.264 + AAC. */
const PROGRESSIVE_ITAG = 18;

export interface Format {
	itag: number;
	url?: string;
	mimeType?: string;
	width?: number;
	height?: number;
	fps?: number;
	contentLength?: string;
}

function vrBody(id: string): string {
	return JSON.stringify({
		context: {
			client: {
				clientName: 'ANDROID_VR',
				clientVersion: '1.60.19',
				deviceMake: 'Oculus',
				deviceModel: 'Quest 3',
				androidSdkVersion: 32,
				osName: 'Android',
				osVersion: '12',
				hl: 'en',
			},
		},
		videoId: id,
		contentCheckOk: true,
		racyCheckOk: true,
	});
}


/** The single-file 360p stream, or null if this video has none. */
/**
 * Every format the player response offers, progressive and adaptive.
 *
 * InnerTube rejects a small share of requests coming from Cloudflare's
 * edge ranges, measured at roughly one in ten, and answers the rest
 * normally. The failure is transient rather than sticky, so a couple of
 * retries turn a visible error into nothing at all.
 */
export async function fetchFormats(id: string, attempts = 3): Promise<Format[]> {
	for (let i = 0; i < attempts; i++) {
		const res = await fetch(INNERTUBE, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'User-Agent': VR_UA },
			body: vrBody(id),
		});

		if (res.ok) {
			const d: any = await res.json().catch(() => null);
			const sd = d?.streamingData;
			if (sd) return [...(sd.formats ?? []), ...(sd.adaptiveFormats ?? [])];
		}

		// Brief, growing pause; the whole budget stays well inside the
		// time a chat client will wait for media.
		if (i < attempts - 1) await new Promise(r => setTimeout(r, 150 * (i + 1)));
	}
	return [];
}
export function pickProgressive(formats: Format[]): Format | null {
	return formats.find(f => f.itag === PROGRESSIVE_ITAG && f.url) ?? null;
}

/**
 * Proxy a googlevideo url, forwarding Range so players can seek.
 *
 * The bytes have to pass through here: googlevideo binds a url to the
 * ip that requested it, so handing the raw url to a viewer earns a 403.
 * The body is streamed rather than buffered, which keeps this cheap in
 * CPU and memory no matter how large the file is.
 */
export async function proxyMedia(url: string, request: Request): Promise<Response> {
	const headers: Record<string, string> = { 'User-Agent': VR_UA };
	const range = request.headers.get('Range');
	if (range) headers['Range'] = range;

	const upstream = await fetch(url, { headers, redirect: 'follow' });

	const out = new Headers();
	for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
		const v = upstream.headers.get(h);
		if (v) out.set(h, v);
	}
	if (!out.has('Content-Type')) out.set('Content-Type', 'video/mp4');
	if (!out.has('Accept-Ranges')) out.set('Accept-Ranges', 'bytes');
	out.set('Cache-Control', `public, max-age=${CACHE_OK}`);
	out.set('Access-Control-Allow-Origin', '*');

	return new Response(upstream.body, { status: upstream.status, headers: out });
}
