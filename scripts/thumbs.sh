#!/bin/sh
# Small copies of the covers for the View all wall (src/allView.ts): they show while it flies in, and the full
# covers load over them once a cover is in view. Run after adding or changing a cover.
set -e
cd "$(dirname "$0")/../public/covers"
mkdir -p small
for f in *.jpg; do
  sips -s format jpeg -s formatOptions 70 --resampleWidth 160 "$f" --out "small/$f" >/dev/null
done
