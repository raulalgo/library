#!/usr/bin/env bash
#
# Deploy the built site to library.raulalgo.es on Hostinger over FTP.
#
#   npm run deploy                     # build, then upload
#   npm run deploy -- --no-build       # upload existing dist/ as-is
#   npm run deploy -- --dry-run        # show what would change, upload nothing
#
# Credentials come from .env.deploy (gitignored). See .env.deploy.example.
# Requires: lftp (brew install lftp).

set -euo pipefail
cd "$(dirname "$0")/.."

# --- flags -----------------------------------------------------------------
BUILD=1
DRY_RUN=""
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --dry-run)  DRY_RUN="--dry-run" ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

# --- load credentials ------------------------------------------------------
if [[ ! -f .env.deploy ]]; then
  echo "Missing .env.deploy — copy .env.deploy.example to .env.deploy and fill it in." >&2
  exit 1
fi
set -a; source .env.deploy; set +a
: "${FTP_HOST:?set FTP_HOST in .env.deploy}"
: "${FTP_USER:?set FTP_USER in .env.deploy}"
: "${FTP_PASS:?set FTP_PASS in .env.deploy}"
: "${FTP_REMOTE_DIR:?set FTP_REMOTE_DIR in .env.deploy}"
FTP_PORT="${FTP_PORT:-21}"
# Tolerate FTP_HOST written with a scheme and/or trailing slash (ftp://host/ -> host).
FTP_HOST="${FTP_HOST#ftp://}"; FTP_HOST="${FTP_HOST#ftps://}"; FTP_HOST="${FTP_HOST%%/*}"

if [[ "$FTP_PASS" == "your-ftp-password" ]]; then
  echo ".env.deploy still has the example credentials — fill in FTP_USER and FTP_PASS." >&2
  exit 1
fi

# mirror --delete empties whatever FTP_REMOTE_DIR points at. The FTP account's root is the portfolio
# (raulalgo.es), so only accept a single plain folder name inside it: no ".", "/" or "..".
if [[ ! "$FTP_REMOTE_DIR" =~ ^[A-Za-z0-9_-]+$ || "$FTP_REMOTE_DIR" == "public_html" ]]; then
  echo "FTP_REMOTE_DIR=$FTP_REMOTE_DIR could touch the main site. Set it to the subdomain's folder name, e.g. library." >&2
  exit 1
fi

# --- build -----------------------------------------------------------------
if [[ "$BUILD" == "1" ]]; then
  echo "▶ Building production site…"
  npm run build
fi

if [[ ! -d dist ]]; then
  echo "No dist/ directory — run a build first." >&2
  exit 1
fi

# --- upload ----------------------------------------------------------------
# mirror -R  : reverse mirror = upload local → remote
# --delete   : remove remote files no longer present locally
# --parallel : concurrent transfers
case "${FTP_TLS:-explicit}" in
  explicit) SSL_SETTINGS=$'set ftp:ssl-force true\nset ftp:ssl-protect-data true' ;;
  allow)    SSL_SETTINGS=$'set ftp:ssl-force false\nset ftp:ssl-allow true' ;;
  plain)    SSL_SETTINGS=$'set ftp:ssl-allow false' ;;
  *) echo "FTP_TLS must be explicit|allow|plain" >&2; exit 1 ;;
esac

echo "▶ Uploading dist/ → ${FTP_HOST}:/${FTP_REMOTE_DIR}  (TLS=${FTP_TLS:-explicit}) ${DRY_RUN:+(dry run)}"
# cmd:fail-exit stops at the first failed command (a bad login included) instead of carrying on.
# The sed strips "user:password@" from the URLs lftp prints in --verbose and --dry-run output.
lftp -p "$FTP_PORT" "ftp://$FTP_HOST" <<EOF 2>&1 | sed -E 's#(ftps?://)[^/]*@#\1#g'
$SSL_SETTINGS
set cmd:fail-exit yes
set ssl:verify-certificate no
set net:max-retries 3
set net:timeout 20
user "$FTP_USER" "$FTP_PASS"
mkdir -p -f "$FTP_REMOTE_DIR"
mirror -R $DRY_RUN --delete --parallel=4 --verbose \
  --exclude-glob '.DS_Store' \
  dist/ "$FTP_REMOTE_DIR/"
bye
EOF

if [[ -n "$DRY_RUN" ]]; then
  echo "✓ Dry run complete — nothing was uploaded or deleted."
else
  echo "✓ Deploy complete: https://library.raulalgo.es"
fi
