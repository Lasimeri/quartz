// Stream acquisition via InnerTube.
//
// Clients differ in what they are allowed to see. ANDROID_VR returns
// direct googlevideo urls with no PO token, no signature cipher and no
// "n" throttling parameter, which is what makes proxying viable from a
// Worker at all, but YouTube refuses it outright for some videos with
// LOGIN_REQUIRED. IOS is usually allowed where ANDROID_VR is not, at
// the cost of offering no progressive format. Trying them in order
// covers considerably more videos than either alone.
//
// All of this is undocumented and can change without notice. If
// playback starts failing everywhere, this is the file to look at.

const INNERTUBE = 'https://www.youtube.com/youtubei/v1/player';

interface ClientSpec {
	name: string;
	ua: string;
	context: Record<string, unknown>;
}

const CLIENTS: ClientSpec[] = [
	{
		name: 'ANDROID_VR',
		ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip',
		context: {
			client: {
				clientName: 'ANDROID_VR', clientVersion: '1.60.19',
				deviceMake: 'Oculus', deviceModel: 'Quest 3',
				androidSdkVersion: 32, osName: 'Android', osVersion: '12', hl: 'en',
			},
		},
	},
	{
		name: 'IOS',
		ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',
		context: {
			client: {
				clientName: 'IOS', clientVersion: '20.10.4',
				deviceMake: 'Apple', deviceModel: 'iPhone16,2',
				osName: 'iPhone', osVersion: '18.3.2.22D82', hl: 'en',
			},
		},
	},
];

export interface Format {
	itag: number;
	url?: string;
	mimeType?: string;
	width?: number;
	height?: number;
	fps?: number;
	bitrate?: number;
	contentLength?: string;
	initRange?: { start: string; end: string };
	indexRange?: { start: string; end: string };
}

export type PlayerOutcome =
	| { ok: true; formats: Format[]; client: string }
	| { ok: false; status: string; reason: string };

/**
 * Ask one client for a video's formats.
 *
 * InnerTube also rejects a small share of otherwise valid requests from
 * Cloudflare's edge ranges, measured at roughly one in ten. That
 * failure is transient rather than sticky, so each client gets a couple
 * of attempts before moving on.
 */
async function askClient(id: string, spec: ClientSpec, attempts: number): Promise<PlayerOutcome> {
	let status = 'NO_RESPONSE';
	let reason = '';

	for (let i = 0; i < attempts; i++) {
		const res = await fetch(INNERTUBE, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'User-Agent': spec.ua },
			body: JSON.stringify({
				context: spec.context,
				videoId: id,
				contentCheckOk: true,
				racyCheckOk: true,
			}),
		});

		if (res.ok) {
			const d: any = await res.json().catch(() => null);
			const sd = d?.streamingData;
			if (sd) {
				const formats = [...(sd.formats ?? []), ...(sd.adaptiveFormats ?? [])];
				if (formats.length) return { ok: true, formats, client: spec.name };
			}
			// A definite verdict from YouTube: another attempt with the
			// same client will say the same thing.
			const ps = d?.playabilityStatus;
			if (ps?.status && ps.status !== 'OK') {
				return { ok: false, status: ps.status, reason: ps.reason ?? '' };
			}
			status = ps?.status ?? 'NO_FORMATS';
		}

		if (i < attempts - 1) await new Promise(r => setTimeout(r, 150 * (i + 1)));
	}

	return { ok: false, status, reason };
}

/** Try each client in turn, returning the first that yields formats. */
export async function fetchPlayer(id: string): Promise<PlayerOutcome> {
	let last: PlayerOutcome = { ok: false, status: 'NO_CLIENT', reason: '' };

	for (const spec of CLIENTS) {
		const out = await askClient(id, spec, 2);
		if (out.ok) return out;
		last = out;
	}
	return last;
}

/** Backwards-compatible shape for callers that only want the list. */
export async function fetchFormats(id: string): Promise<Format[]> {
	const out = await fetchPlayer(id);
	return out.ok ? out.formats : [];
}

/** The single-file 360p stream, if this video still publishes one. */
export function pickProgressive(formats: Format[]): Format | null {
	return formats.find(f => f.itag === 18 && f.url) ?? null;
}

/**
 * Best H.264 video and AAC audio for muxing, capped at `maxHeight`.
 *
 * H.264 and AAC specifically: they pair into an MP4 without re-encoding,
 * and they are what every chat client's player decodes. VP9, Opus and
 * AV1 are all offered too and all wrong for this purpose.
 */
export function pickMuxPair(formats: Format[], maxHeight = 720): { video: Format; audio: Format } | null {
	const usable = (f: Format) => f.url && f.initRange && f.indexRange;

	const video = formats
		.filter(f => usable(f) && f.mimeType?.startsWith('video/mp4') && f.mimeType.includes('avc1'))
		.filter(f => (f.height ?? 0) <= maxHeight)
		.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0))[0];

	const audio = formats
		.filter(f => usable(f) && f.mimeType?.startsWith('audio/mp4') && f.mimeType.includes('mp4a'))
		.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];

	return video && audio ? { video, audio } : null;
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
	const headers: Record<string, string> = { 'User-Agent': CLIENTS[0].ua };
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
	out.set('Cache-Control', 'public, max-age=3600');
	out.set('Access-Control-Allow-Origin', '*');

	return new Response(upstream.body, { status: upstream.status, headers: out });
}

/** Fetch a byte range from a googlevideo url. */
export async function getRange(url: string, start: number, end: number): Promise<Uint8Array> {
	const res = await fetch(url, {
		headers: { 'User-Agent': CLIENTS[0].ua, Range: `bytes=${start}-${end}` },
	});
	if (!res.ok && res.status !== 206) throw new Error(`range ${start}-${end}: ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}
