// The landing page at the base path. Design follows seaof.glass:
// monospace, amber on near-black, a 700px column, hairline-separated
// cards, lowercase section labels.

import { BASE, CACHE_OK, WATCH_ORIGIN } from './config';
import { esc, html } from './render';

const REPO = 'https://github.com/Lasimeri/quartz';
const REPO_NAME = 'Lasimeri/quartz';

const CSS = `
:root {
	--bg: #0a0a0f;
	--surface: #12121a;
	--border: #1e1e2e;
	--text: #c4945a;
	--text-dim: #8a6a3e;
	--accent: #c4945a;
	--accent-dim: #7a5c38;
	--mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
	font-family: var(--mono);
	background: var(--bg);
	color: var(--text);
	min-height: 100vh;
	display: flex;
	justify-content: center;
	padding: 2rem;
}
.container { max-width: 700px; width: 100%; }
header { margin-bottom: 2.5rem; }
h1 {
	font-size: 1.1rem;
	font-weight: 400;
	color: var(--accent);
	margin-bottom: 0.5rem;
	letter-spacing: 0.05em;
}
.tagline { font-size: 0.7rem; color: var(--text-dim); opacity: 0.6; line-height: 1.6; }
.tagline em { display: block; margin-top: 0.2rem; font-style: normal; opacity: 0.8; }
.sep { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
.section-label {
	font-size: 0.65rem;
	color: var(--text-dim);
	margin-bottom: 0.75rem;
	letter-spacing: 0.1em;
	text-transform: lowercase;
}
.rows {
	display: flex;
	flex-direction: column;
	gap: 1px;
	background: var(--border);
	border: 1px solid var(--border);
	margin-bottom: 2rem;
}
.row {
	background: var(--bg);
	padding: 1rem 1.2rem;
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	text-decoration: none;
	transition: background 0.15s;
}
a.row:hover { background: var(--surface); }
.row-name { font-size: 0.8rem; color: var(--text); letter-spacing: 0.02em; }
.row-name span { color: var(--accent); }
.row-desc {
	font-size: 0.65rem;
	color: var(--text-dim);
	text-align: right;
	flex-shrink: 0;
	margin-left: 1rem;
}
.transform {
	background: var(--bg);
	border: 1px solid var(--border);
	padding: 1.2rem;
	margin-bottom: 2rem;
	font-size: 0.75rem;
	line-height: 2;
	overflow-x: auto;
	white-space: nowrap;
}
.transform .before { color: var(--text-dim); opacity: 0.7; }
.transform .after { color: var(--text); }
.transform .ins { color: var(--bg); background: var(--accent); padding: 0 0.15rem; }
.transform .mark { color: var(--accent-dim); }
.convert { margin-bottom: 2rem; }
.convert input {
	width: 100%;
	background: var(--surface);
	border: 1px solid var(--border);
	color: var(--text);
	font-family: var(--mono);
	font-size: 0.72rem;
	padding: 0.8rem 1rem;
	outline: none;
}
.convert input::placeholder { color: var(--text-dim); opacity: 0.5; }
.convert input:focus { border-color: var(--accent-dim); }
.convert-out {
	display: flex;
	gap: 1px;
	background: var(--border);
	border: 1px solid var(--border);
	border-top: none;
}
.convert-out output {
	background: var(--bg);
	flex: 1;
	padding: 0.8rem 1rem;
	font-size: 0.72rem;
	color: var(--text-dim);
	overflow-x: auto;
	white-space: nowrap;
}
.convert-out button {
	background: var(--bg);
	border: none;
	color: var(--accent);
	font-family: var(--mono);
	font-size: 0.65rem;
	letter-spacing: 0.1em;
	padding: 0 1.2rem;
	cursor: pointer;
	transition: background 0.15s;
}
.convert-out button:hover { background: var(--surface); }
.convert-out button:disabled { color: var(--text-dim); opacity: 0.4; cursor: default; }
.repo {
	display: block;
	background: var(--bg);
	border: 1px solid var(--border);
	padding: 1.2rem;
	margin-bottom: 2rem;
	text-decoration: none;
	transition: background 0.15s;
}
.repo:hover { background: var(--surface); }
.repo-head { font-size: 0.8rem; color: var(--text); margin-bottom: 0.5rem; }
.repo-head span { color: var(--text-dim); }
.repo-desc { font-size: 0.68rem; color: var(--text-dim); line-height: 1.7; margin-bottom: 0.8rem; }
.repo-meta, .status-line {
	display: flex;
	gap: 1.5rem;
	flex-wrap: wrap;
	font-size: 0.6rem;
	color: var(--text-dim);
}
.repo-meta { opacity: 0.7; }
.status-line { opacity: 0.4; margin-bottom: 2rem; }
.repo-meta span::before, .status-line span::before {
	content: '';
	display: inline-block;
	width: 5px;
	height: 5px;
	border-radius: 50%;
	background: var(--accent-dim);
	margin-right: 0.4rem;
	vertical-align: middle;
}
.about { font-size: 0.7rem; color: var(--text-dim); line-height: 1.8; margin-bottom: 2rem; }
.about p { margin-bottom: 0.75rem; }
.about a, .footer a { color: var(--accent); text-decoration: none; }
.about a:hover, .footer a:hover { text-decoration: underline; }
.footer { font-size: 0.6rem; color: var(--text-dim); opacity: 0.35; line-height: 1.8; }
@media (max-width: 600px) {
	body { padding: 1.25rem; }
	.row { flex-direction: column; gap: 0.25rem; }
	.row-desc { text-align: left; margin-left: 0; }
	.status-line, .repo-meta { flex-direction: column; gap: 0.5rem; }
	.transform { font-size: 0.65rem; }
}
`;

// Rewrites a pasted youtube link to this host. The page works without
// it; the box is a convenience.
const JS = `
const box = document.getElementById('in');
const out = document.getElementById('out');
const copy = document.getElementById('copy');
const PREFIX = location.origin + BASE_PATH + '/';
function convert() {
	const v = box.value.trim();
	if (!v) { out.textContent = ''; copy.disabled = true; return; }
	const m = v.match(/[A-Za-z0-9_-]{11}/);
	if (!m) { out.textContent = 'no video id found'; copy.disabled = true; return; }
	out.textContent = PREFIX + m[0];
	copy.disabled = false;
}
box.addEventListener('input', convert);
copy.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(out.textContent);
		copy.textContent = 'copied';
		setTimeout(() => { copy.textContent = 'copy'; }, 1200);
	} catch {
		copy.textContent = 'select it';
		setTimeout(() => { copy.textContent = 'copy'; }, 1200);
	}
});
`;

/** The landing page at the base path. */
export function homePage(host: string): Response {
	const prefix = `${host}${BASE}`;
	const dest = WATCH_ORIGIN.replace(/^https?:\/\//, '');

	const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>quartz</title>
<meta name="theme-color" content="#c4945a">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(host)}">
<meta property="og:url" content="https://${esc(prefix)}/">
<meta property="og:title" content="quartz">
<meta property="og:description" content="A youtube redirect on ${esc(host)}. Paste a link behind ${esc(BASE)}/ and it embeds with a title, channel, and thumbnail.">
<meta property="twitter:card" content="summary">
<style>${CSS}</style>
</head>
<body>
<div class="container">

<header>
	<h1>quartz</h1>
	<p class="tagline">
		a youtube redirect, with embeds that say what the video is.
		<em>paste any youtube link behind ${esc(BASE)}/</em>
	</p>
</header>
<div class="section-label">-- usage --</div>
<div class="transform">
	<div><span class="mark">x</span> <span class="before">https://youtu.be/dQw4w9WgXcQ</span></div>
	<div><span class="mark">y</span> <span class="after">https://<span class="ins">${esc(prefix)}/</span>dQw4w9WgXcQ</span></div>
	<div><span class="mark">p</span> <span class="after">https://${esc(prefix)}/dQw4w9WgXcQ<span class="ins">.mp4</span></span></div>
</div>
<div class="about" style="margin-top:-1rem">
	<p>
		y gives a card with the title, channel and thumbnail.
		p gives a video that plays in the chat window.
	</p>
</div>


<div class="section-label">-- convert --</div>
<div class="convert">
	<input id="in" type="text" spellcheck="false" autocomplete="off" placeholder="paste a youtube link">
	<div class="convert-out">
		<output id="out"></output>
		<button id="copy" disabled>copy</button>
	</div>
</div>

<div class="section-label">-- accepted --</div>
<div class="rows">
	<div class="row">
		<div class="row-name"><span>/</span>full link</div>
		<div class="row-desc">youtube.com/watch?v=ID, with or without scheme</div>
	</div>
	<div class="row">
		<div class="row-name"><span>/</span>short link</div>
		<div class="row-desc">youtu.be/ID</div>
	</div>
	<div class="row">
		<div class="row-name"><span>/</span>shorts</div>
		<div class="row-desc">also /embed/, /live/, /v/</div>
	</div>
	<div class="row">
		<div class="row-name"><span>/</span>bare id</div>
		<div class="row-desc">the 11 characters on their own</div>
	</div>
	<div class="row">
		<div class="row-name"><span>/</span>timestamps</div>
		<div class="row-desc">t= and list= are carried through</div>
	</div>
</div>

<div class="section-label">-- source --</div>
<a class="repo" href="${REPO}">
	<div class="repo-head"><span>github.com/</span>${REPO_NAME}</div>
	<div class="repo-desc">
		youtube redirect and embed card, on a cloudflare worker.
		metadata comes from youtube's public oembed endpoint, so there is
		no api key, no quota, and nothing to keep working.
	</div>
	<div class="repo-meta">
		<span>typescript</span>
		<span>mit</span>
		<span>setup.md</span>
	</div>
</a>

<hr class="sep">

<div class="section-label">-- about --</div>
<div class="about">
	<p>
		crawlers get opengraph tags built from youtube's public oembed
		endpoint. everyone else is redirected to ${esc(dest)} untouched.
		nothing is stored and nothing is logged.
	</p>
	<p>
		the destination is one constant, so pointing viewers at a
		self-hosted frontend later changes nothing else:
		<a href="${REPO}/blob/main/SETUP.md">setup.md</a>
	</p>
</div>

<div class="status-line">
	<span>no tracking</span>
	<span>cloudflare worker</span>
	<span>${esc(prefix)}</span>
</div>

<hr class="sep">

<div class="footer">
	mit licensed &middot; <a href="${REPO}">source</a> &middot; <a href="/">seaof.glass</a><br>
	not affiliated with, endorsed by, or connected to youtube or google.
</div>

</div>
<script>const BASE_PATH = ${JSON.stringify(BASE)};${JS}</script>
</body>
</html>`;

	return html(body, 200, CACHE_OK);
}
