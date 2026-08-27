// ISO-BMFF primitives. Enough of the box format to read a DASH init
// segment and rewrite the handful of fields a mux touches, and no more.

export interface Box {
	type: string;
	/** Offset of the box header within the buffer it was found in. */
	start: number;
	/** Total size including the header. */
	size: number;
	/** 8, or 16 for a 64-bit largesize box. */
	headerSize: number;
}

const td = new TextDecoder('latin1');

export function u32(b: Uint8Array, o: number): number {
	return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

export function writeU32(b: Uint8Array, o: number, v: number): void {
	b[o] = (v >>> 24) & 0xff;
	b[o + 1] = (v >>> 16) & 0xff;
	b[o + 2] = (v >>> 8) & 0xff;
	b[o + 3] = v & 0xff;
}

export function u64(b: Uint8Array, o: number): number {
	// Sizes and times here stay far inside 2^53, so number is safe and
	// avoids dragging BigInt through every call site.
	return u32(b, o) * 0x100000000 + u32(b, o + 4);
}

/** Read one box header at `off`, or null if the buffer is too short. */
export function readBox(b: Uint8Array, off: number): Box | null {
	if (off + 8 > b.length) return null;

	let size = u32(b, off);
	let headerSize = 8;
	if (size === 1) {
		if (off + 16 > b.length) return null;
		size = u64(b, off + 8);
		headerSize = 16;
	} else if (size === 0) {
		size = b.length - off;
	}
	if (size < headerSize) return null;

	return { type: td.decode(b.subarray(off + 4, off + 8)), start: off, size, headerSize };
}

/** Every top-level box between `start` and `end`. */
export function* boxes(b: Uint8Array, start = 0, end = b.length): Generator<Box> {
	let off = start;
	while (off + 8 <= end) {
		const box = readBox(b, off);
		if (!box || off + box.size > end) return;
		yield box;
		off += box.size;
	}
}

/** First direct child of the given type, or null. */
export function find(b: Uint8Array, type: string, start = 0, end = b.length): Box | null {
	for (const box of boxes(b, start, end)) if (box.type === type) return box;
	return null;
}

/**
 * Descend a slash-separated path of box types, e.g. "moov/trak/tkhd".
 * Returns the bytes of the box including its header.
 */
export function path(b: Uint8Array, spec: string): Uint8Array | null {
	let start = 0;
	let end = b.length;
	let found: Box | null = null;

	for (const type of spec.split('/')) {
		found = find(b, type, start, end);
		if (!found) return null;
		start = found.start + found.headerSize;
		end = found.start + found.size;
	}
	return found ? b.subarray(found.start, found.start + found.size) : null;
}

/** All direct children of the given type. */
export function findAll(b: Uint8Array, type: string, start = 0, end = b.length): Box[] {
	const out: Box[] = [];
	for (const box of boxes(b, start, end)) if (box.type === type) out.push(box);
	return out;
}

/** Concatenate a size+type header onto the given payloads. */
export function buildBox(type: string, ...parts: Uint8Array[]): Uint8Array {
	let payload = 0;
	for (const p of parts) payload += p.length;

	const out = new Uint8Array(8 + payload);
	writeU32(out, 0, out.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);

	let o = 8;
	for (const p of parts) { out.set(p, o); o += p.length; }
	return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
	let n = 0;
	for (const p of parts) n += p.length;

	const out = new Uint8Array(n);
	let o = 0;
	for (const p of parts) { out.set(p, o); o += p.length; }
	return out;
}

/** Version byte of a full box, read from its payload. */
export function version(b: Uint8Array, box: Box): number {
	return b[box.start + box.headerSize];
}

/**
 * A direct child of a buffer that begins with a container box header.
 * `path()` walks from the buffer start, so it cannot be used to reach
 * inside a box the caller has already isolated; this can.
 */
export function child(container: Uint8Array, type: string): Uint8Array | null {
	const outer = readBox(container, 0);
	if (!outer) return null;

	const box = find(container, type, outer.headerSize, container.length);
	return box ? container.subarray(box.start, box.start + box.size) : null;
}
