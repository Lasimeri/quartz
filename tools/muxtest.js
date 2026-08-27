const fs = require('fs');
const { execFileSync } = require('child_process');
const M = '/tmp/claude-1000/-home-lasimeri/0162c2ae-f2d0-4da7-825e-256a9febdda9/scratchpad/muxjs';
const { find, readBox } = require(`${M}/boxes.js`);
const { parseSidx } = require(`${M}/sidx.js`);
const { buildCombinedInit, trakId } = require(`${M}/init.js`);
const { rewriteFragment, isRelocatable } = require(`${M}/fragment.js`);

const UA = 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip';
const TOOLS = '/home/lasimeri/quartz/tools';
const PJ = `${__dirname}/pr2.json`;

const fld = (itag, f) => execFileSync(`${TOOLS}/fmt`, [PJ, String(itag), f]).toString().trim();
const rng = s => { const m = s.match(/"start":\s*"(\d+)"[\s\S]*?"end":\s*"(\d+)"/); return [ +m[1], +m[2] ]; };

async function getRange(url, start, end) {
	const r = await fetch(url, { headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` } });
	if (!r.ok && r.status !== 206) throw new Error(`range ${start}-${end}: ${r.status}`);
	return new Uint8Array(await r.arrayBuffer());
}

async function track(itag) {
	const url = fld(itag, 'url');
	const [is, ie] = rng(fld(itag, 'initRange'));
	const [xs, xe] = rng(fld(itag, 'indexRange'));
	const init = await getRange(url, is, ie);
	const idxBytes = await getRange(url, xs, xe);
	const box = readBox(idxBytes, 0);
	if (!box || box.type !== 'sidx') throw new Error(`itag ${itag}: indexRange is ${box && box.type}, not sidx`);
	const sidx = parseSidx(idxBytes, box, xs);
	return { url, init, sidx };
}

(async () => {
	const v = await track(136);
	const a = await track(140);
	console.log(`video: ${v.sidx.fragments.length} fragments, timescale ${v.sidx.timescale}`);
	console.log(`audio: ${a.sidx.fragments.length} fragments, timescale ${a.sidx.timescale}`);

	const combined = buildCombinedInit(v.init, a.init);
	const moov = find(combined, 'moov');
	const traks = [];
	{ // list track ids in the combined init
		const { boxes } = require(`${M}/boxes.js`);
		for (const b of boxes(combined, moov.start + moov.headerSize, moov.start + moov.size))
			if (b.type === 'trak') traks.push(trakId(combined.subarray(b.start, b.start + b.size)));
	}
	console.log(`combined init: ${combined.length} bytes, track ids [${traks}]`);

	// Interleave the first few seconds by presentation time.
	const N = 4;
	const items = [];
	for (const f of v.sidx.fragments.slice(0, N)) items.push({ t: f.time / v.sidx.timescale, f, url: v.url, id: 1 });
	for (const f of a.sidx.fragments.slice(0, N * 2)) items.push({ t: f.time / a.sidx.timescale, f, url: a.url, id: 2 });
	items.sort((x, y) => x.t - y.t);

	const parts = [combined];
	let seq = 1, checked = false;
	for (const it of items) {
		const raw = await getRange(it.url, it.f.offset, it.f.offset + it.f.size - 1);
		if (!checked) { console.log(`relocatable: ${isRelocatable(raw)}`); checked = true; }
		parts.push(rewriteFragment(raw, it.id, seq++));
	}

	const out = Buffer.concat(parts.map(Buffer.from));
	fs.writeFileSync(`${__dirname}/muxed.mp4`, out);
	console.log(`wrote muxed.mp4: ${out.length} bytes, ${items.length} fragments`);
})();
