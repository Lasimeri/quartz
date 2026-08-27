/* boxes - walk an ISO-BMFF file and print its box tree.
 *
 *   boxes <file> [maxdepth]
 *
 * Containers are recursed into; leaf boxes print their size only, with
 * a few fields broken out where they matter for muxing. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned char *buf;
static long blen;

static unsigned rd32(long o) {
	return ((unsigned)buf[o] << 24) | (buf[o+1] << 16) | (buf[o+2] << 8) | buf[o+3];
}
static unsigned long long rd64(long o) {
	return ((unsigned long long)rd32(o) << 32) | rd32(o + 4);
}

static int container(const char *t) {
	static const char *c[] = { "moov","trak","mdia","minf","stbl","dinf","edts",
	                           "moof","traf","mvex","mfra","udta", 0 };
	for (int i = 0; c[i]; i++) if (!memcmp(t, c[i], 4)) return 1;
	return 0;
}

static void walk(long off, long end, int depth, int maxdepth) {
	while (off + 8 <= end) {
		unsigned long long size = rd32(off);
		char type[5] = {0};
		memcpy(type, buf + off + 4, 4);
		long hdr = 8;

		if (size == 1) { size = rd64(off + 8); hdr = 16; }
		else if (size == 0) size = end - off;
		if (size < (unsigned long long)hdr || off + (long)size > end) {
			printf("%*s%s  <bad size %llu at %ld>\n", depth * 2, "", type, size, off);
			return;
		}

		printf("%*s%s  size=%llu  off=%ld\n", depth * 2, "", type, size, off);

		if (!memcmp(type, "tfhd", 4)) {
			unsigned flags = rd32(off + 8) & 0xffffff;
			printf("%*s  track_id=%u flags=0x%06x%s\n", depth * 2, "",
			       rd32(off + 12), flags,
			       (flags & 0x020000) ? " default-base-is-moof" : "");
		} else if (!memcmp(type, "trun", 4)) {
			unsigned flags = rd32(off + 8) & 0xffffff;
			printf("%*s  sample_count=%u flags=0x%06x%s\n", depth * 2, "",
			       rd32(off + 12), flags,
			       (flags & 0x000001) ? " data-offset-present" : "");
		} else if (!memcmp(type, "mfhd", 4)) {
			printf("%*s  sequence=%u\n", depth * 2, "", rd32(off + 12));
		} else if (!memcmp(type, "sidx", 4)) {
			unsigned cnt = rd32(off + 8) >> 24 == 0 ? rd32(off + 28) & 0xffff : 0;
			printf("%*s  reference_count~=%u\n", depth * 2, "", cnt);
		} else if (!memcmp(type, "hdlr", 4)) {
			char h[5] = {0};
			memcpy(h, buf + off + 16, 4);
			printf("%*s  handler=%s\n", depth * 2, "", h);
		}

		if (container(type) && depth < maxdepth)
			walk(off + hdr, off + size, depth + 1, maxdepth);

		off += size;
	}
}

int main(int argc, char **argv) {
	if (argc < 2) { fputs("usage: boxes <file> [maxdepth]\n", stderr); return 2; }
	int maxdepth = argc > 2 ? atoi(argv[2]) : 6;

	FILE *f = fopen(argv[1], "rb");
	if (!f) { perror(argv[1]); return 1; }
	fseek(f, 0, SEEK_END); blen = ftell(f); fseek(f, 0, SEEK_SET);
	buf = malloc(blen);
	if (fread(buf, 1, blen, f) != (size_t)blen) { fputs("short read\n", stderr); return 1; }
	fclose(f);

	walk(0, blen, 0, maxdepth);
	return 0;
}
