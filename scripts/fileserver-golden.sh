#!/usr/bin/env bash
# Golden curl matrix for the /files/* file server (file-server design
# D8). Exercises the whole Range/conditional/content/auth matrix
# against a RUNNING Stratofold server with a seeded SSH fixture, from
# the client side — real curl, real HTTP stack.
#
# Required environment:
#   SF_BASE_URL     e.g. http://127.0.0.1:8090
#   SF_EMAIL        a Stratofold user (owns the vdirs)
#   SF_PASSWORD     that user's password
#   SF_VDIR_ID      a non-public vdir whose root contains the seeded
#                   dataset (docs/a.txt, docs/index.html, index.html,
#                   blob.xyz, big/range.bin, noindex/, docs/link-out)
#   SF_PUB_VDIR_ID  a public vdir over the same root
#
# Exits 0 when every row passes, 1 otherwise. The in-repo runner is
# internal/fileserver/golden_test.go (in-proc fixture locally,
# SF_TESTSSH_MODE=external on the build server).
set -uo pipefail

BASE="${SF_BASE_URL:?SF_BASE_URL required}"
EMAIL="${SF_EMAIL:?SF_EMAIL required}"
PASSWORD="${SF_PASSWORD:?SF_PASSWORD required}"
VD="${SF_VDIR_ID:?SF_VDIR_ID required}"
PUB="${SF_PUB_VDIR_ID:?SF_PUB_VDIR_ID required}"

JAR="$(mktemp)"
BODY="$(mktemp)"
HDRS="$(mktemp)"
trap 'rm -f "$JAR" "$BODY" "$HDRS"' EXIT

fails=0
check() { # desc expected actual
  if [ "$2" = "$3" ]; then
    printf 'ok   %s\n' "$1"
  else
    printf 'FAIL %s: got %q, want %q\n' "$1" "$3" "$2"
    fails=$((fails + 1))
  fi
}

# code URL [curl args...] -> HTTP status of the request
code() {
  local status
  status=$(curl -s -o "$BODY" -w '%{http_code}' "$@")
  printf '%s' "$status"
}

# ---- auth rows ------------------------------------------------------

anon_code=$(code "$BASE/files/$VD/docs/a.txt")
check "anonymous on non-public vdir is 401" 401 "$anon_code"

forged_code=$(code -H 'Cookie: sf_session=forged-token' "$BASE/files/$VD/docs/a.txt")
check "forged cookie is 401" 401 "$forged_code"

login_status=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$BASE/api/sf/auth")
check "login succeeds" 200 "$login_status"

owner_code=$(code -b "$JAR" "$BASE/files/$VD/docs/a.txt")
check "owner with session serves" 200 "$owner_code"

pub_anon_code=$(code "$BASE/files/$PUB/docs/a.txt")
check "public vdir serves anonymously" 200 "$pub_anon_code"

# ---- content rows ---------------------------------------------------

full=$(curl -s -b "$JAR" "$BASE/files/$VD/docs/a.txt")
full_len=$(curl -s -b "$JAR" -o /dev/null -w '%{size_download}' "$BASE/files/$VD/docs/a.txt")
check "content is the seeded 44-byte file" "44" "$full_len"

slice=$(curl -s -b "$JAR" -H 'Range: bytes=2-5' "$BASE/files/$VD/docs/a.txt")
check "range slice matches the full body" "${full:2:4}" "$slice"

cl=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/files/$VD/docs/a.txt" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')
check "Content-Length equals the size" "$full_len" "$cl"

ar=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/files/$VD/docs/a.txt" | tr -d '\r' | awk 'tolower($1)=="accept-ranges:"{print $2}')
check "Accept-Ranges: bytes" "bytes" "$ar"

ct=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/files/$VD/docs/a.txt" | tr -d '\r' | awk 'tolower($1)=="content-type:"{print $2}')
check "Content-Type for .txt" "text/plain" "$ct"

ct=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/files/$VD/blob.xyz" | tr -d '\r' | awk 'tolower($1)=="content-type:"{print $2}')
check "Content-Type default" "application/octet-stream" "$ct"

# ---- range rows -----------------------------------------------------

range_row() { # header expected_status expected_content_range
  local st cr
  st=$(code -b "$JAR" -H "Range: $1" "$BASE/files/$VD/docs/a.txt")
  check "Range $1 status" "$2" "$st"
  if [ $# -ge 3 ]; then
    cr=$(curl -s -b "$JAR" -D - -o /dev/null -H "Range: $1" "$BASE/files/$VD/docs/a.txt" | tr -d '\r' | awk 'tolower($1)=="content-range:"{sub(/^[Cc]ontent-[Rr]ange: /,""); print}')
    check "Range $1 Content-Range" "$3" "$cr"
  fi
}
range_row "bytes=2-5"     206 "bytes 2-5/44"
range_row "bytes=7-"      206 "bytes 7-43/44"
range_row "bytes=-3"      206 "bytes 41-43/44"
range_row "bytes=8-100"   206 "bytes 8-43/44"
range_row "bytes=-50"     206 "bytes 0-43/44"
range_row "bytes=40-42"   206 "bytes 40-42/44"
range_row "bytes=44-"     416 "bytes */44"
range_row "bytes=-0"      416 "bytes */44"
range_row "bytes=0-1,3-4" 200
range_row "bytes=abc"     200
range_row "chunks=0-1"    200

big_st=$(code -b "$JAR" -H "Range: bytes=1000-2003" "$BASE/files/$PUB/big/range.bin")
check "binary range status" 206 "$big_st"
big_cl=$(curl -s -o /dev/null -w '%{size_download}' -b "$JAR" -H "Range: bytes=1000-2003" "$BASE/files/$PUB/big/range.bin")
check "binary range downloads 1004 bytes" "1004" "$big_cl"

# ---- conditional rows -----------------------------------------------

ETAG=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/files/$VD/docs/a.txt" | tr -d '\r' | awk 'tolower($1)=="etag:"{sub(/^[Ee][Tt][Aa][Gg]: /,""); print}')
LM=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/files/$VD/docs/a.txt" | tr -d '\r' | awk 'tolower($1)=="last-modified:"{sub(/^[Ll]ast-[Mm]odified: /,""); print}')

check "ETag present" "1" "$([ -n "$ETAG" ] && echo 1 || echo 0)"
check "Last-Modified present" "1" "$([ -n "$LM" ] && echo 1 || echo 0)"

st=$(code -b "$JAR" -H "If-None-Match: $ETAG" "$BASE/files/$VD/docs/a.txt")
check "If-None-Match match is 304" 304 "$st"
st=$(code -b "$JAR" -H "If-None-Match: *" "$BASE/files/$VD/docs/a.txt")
check "If-None-Match * is 304" 304 "$st"
st=$(code -b "$JAR" -H 'If-None-Match: "deadbeef-deadbeef"' "$BASE/files/$VD/docs/a.txt")
check "If-None-Match mismatch serves" 200 "$st"
st=$(code -b "$JAR" -H "If-Modified-Since: $LM" "$BASE/files/$VD/docs/a.txt")
check "If-Modified-Since match is 304" 304 "$st"
st=$(code -b "$JAR" -H 'If-Modified-Since: Mon, 01 Jan 2001 00:00:00 GMT' "$BASE/files/$VD/docs/a.txt")
check "stale If-Modified-Since serves" 200 "$st"
st=$(code -b "$JAR" -H "If-None-Match: $ETAG" -H 'If-Modified-Since: Mon, 01 Jan 2001 00:00:00 GMT' "$BASE/files/$VD/docs/a.txt")
check "If-None-Match takes precedence" 304 "$st"

# ---- directory rows -------------------------------------------------

st=$(code -b "$JAR" "$BASE/files/$VD/")
check "root slash serves index" 200 "$st"
root_index=$(curl -s -b "$JAR" "$BASE/files/$VD/")
bare_index=$(curl -s -b "$JAR" "$BASE/files/$VD")
check "bare vdir form serves the same index" "$root_index" "$bare_index"

st=$(code -b "$JAR" "$BASE/files/$VD/docs")
check "unslashed directory is 301" 301 "$st"
loc=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/files/$VD/docs" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
check "redirect Location" "/files/$VD/docs/" "$loc"

st=$(code -b "$JAR" "$BASE/files/$VD/docs/")
check "slashed directory serves its index" 200 "$st"
st=$(code -b "$JAR" "$BASE/files/$VD/noindex/")
check "directory without index is 404" 404 "$st"
st=$(code -b "$JAR" "$BASE/files/$VD/docs/a.txt/")
check "file with trailing slash is 404" 404 "$st"

ct=$(curl -s -b "$JAR" -D - -o /dev/null "$BASE/files/$VD/" | tr -d '\r' | awk 'tolower($1)=="content-type:"{print $2}')
check "index Content-Type is text/html" "text/html" "$ct"

# ---- sandbox rows ---------------------------------------------------

st=$(code -b "$JAR" "$BASE/files/$VD/%2e%2e/outside/secret.txt")
check "encoded traversal is 404" 404 "$st"
st=$(code -b "$JAR" "$BASE/files/$VD/docs/link-out/secret.txt")
check "symlink escape is 404" 404 "$st"

# ---- verdict --------------------------------------------------------

if [ "$fails" -ne 0 ]; then
  printf '\n%d row(s) FAILED\n' "$fails"
  exit 1
fi
printf '\nall rows passed\n'
exit 0
