/* fmt - pull one format object's fields out of an InnerTube player response.
 *
 *   fmt <player.json> <itag> [field]
 *
 * With no field, prints every field of interest. The object is bounded
 * at the next "itag" key so a short object never borrows the next
 * one's url. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *slurp(const char *path, long *len) {
	FILE *f = fopen(path, "rb");
	if (!f) { perror(path); exit(1); }
	fseek(f, 0, SEEK_END);
	*len = ftell(f);
	fseek(f, 0, SEEK_SET);
	char *b = malloc(*len + 1);
	if (fread(b, 1, *len, f) != (size_t)*len) { fputs("short read\n", stderr); exit(1); }
	b[*len] = 0;
	fclose(f);
	return b;
}

/* Value of "key" inside [s,e): copies through the closing quote for
 * strings, or to the next comma/brace for numbers and objects. */
static int field(const char *s, const char *e, const char *key, char *out, size_t cap) {
	char pat[64];
	snprintf(pat, sizeof pat, "\"%s\"", key);
	const char *p = s;
	size_t plen = strlen(pat);
	while (p < e - plen) {
		if (!memcmp(p, pat, plen)) break;
		p++;
	}
	if (p >= e - plen) return 0;

	p += plen;
	while (p < e && (*p == ':' || *p == ' ' || *p == '\n' || *p == '\t')) p++;
	if (p >= e) return 0;

	size_t n = 0;
	if (*p == '"') {
		p++;
		while (p < e && *p != '"' && n < cap - 1) {
			if (*p == '\\' && p + 1 < e) { out[n++] = p[1]; p += 2; continue; }
			out[n++] = *p++;
		}
	} else if (*p == '{') {
		int depth = 0;
		while (p < e && n < cap - 1) {
			if (*p == '{') depth++;
			if (*p == '}') { out[n++] = *p++; if (--depth == 0) break; continue; }
			out[n++] = *p++;
		}
	} else {
		while (p < e && *p != ',' && *p != '}' && *p != '\n' && n < cap - 1) out[n++] = *p++;
	}
	out[n] = 0;
	return 1;
}

int main(int argc, char **argv) {
	if (argc < 3) { fputs("usage: fmt <player.json> <itag> [field]\n", stderr); return 2; }
	long len;
	char *j = slurp(argv[1], &len);

	char want[64];
	snprintf(want, sizeof want, "\"itag\": %s,", argv[2]);

	char *hit = strstr(j, want);
	if (!hit) { fprintf(stderr, "itag %s not present\n", argv[2]); return 1; }

	/* Bound the object at the following "itag" key, if any. */
	char *next = strstr(hit + 4, "\"itag\"");
	char *end = next ? next : j + len;

	const char *keys[] = { "url", "mimeType", "contentLength", "initRange",
	                       "indexRange", "width", "height", "fps", "bitrate", 0 };
	char buf[8192];

	if (argc >= 4) {
		if (!field(hit, end, argv[3], buf, sizeof buf)) return 1;
		puts(buf);
		return 0;
	}
	for (int i = 0; keys[i]; i++)
		if (field(hit, end, keys[i], buf, sizeof buf))
			printf("%-14s %s\n", keys[i], buf);
	return 0;
}
