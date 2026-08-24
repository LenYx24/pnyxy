#!/usr/bin/env bash
# Rebuilds the PWA home-screen icons from a clean, rasterizable source SVG.
#
# The previous PNGs were exported from a Figma SVG whose gradient is encoded
# as an HTML <foreignObject> conic-gradient and whose <path> has fill="none"
# with only a stroke. Most rasterizers (and Android's launcher) cannot render
# that foreignObject, so the icons came out as a transparent canvas with a
# barely-visible outline and a small filled triangle, which the Android
# launcher then wraps in a white circle, producing the "white circle with a
# black dot" look on the home screen.
#
# Requires: rsvg-convert.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="$(mktemp --suffix=.svg)"
SRC_INNER="$(mktemp --suffix=.svg)"
trap 'rm -f "$SRC" "$SRC_INNER"' EXIT

# Full-bleed icon, used for the "any" purpose and apple-touch-icon. The P
# occupies the canvas as in the original logo (~75% width/height), with a
# solid #0a0a0f background filling all 1024x1024 so the launcher doesn't
# wrap it in a white circle.
cat > "$SRC" <<'SVG'
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pgrad" x1="205" y1="127" x2="800" y2="898" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#64FFDA"/>
      <stop offset="100%" stop-color="#64FFF7"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="#0a0a0f"/>
  <path d="M205 898V307V127H576.917C910.573 127 888.629 646 576.917 646H398.554V898H205Z" fill="url(#pgrad)"/>
  <path d="M564 402H205V574L564 402Z" fill="#0a0a0f"/>
</svg>
SVG

# Maskable icon, same content but scaled to ~70% inside an 1024x1024 frame
# so it stays within the Android adaptive-icon safe zone (inner 80%). The
# launcher mask can crop the outer 20% without eating into the P.
cat > "$SRC_INNER" <<'SVG'
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pgrad" x1="205" y1="127" x2="800" y2="898" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#64FFDA"/>
      <stop offset="100%" stop-color="#64FFF7"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="#0a0a0f"/>
  <g transform="translate(512 512) scale(0.7) translate(-512 -512)">
    <path d="M205 898V307V127H576.917C910.573 127 888.629 646 576.917 646H398.554V898H205Z" fill="url(#pgrad)"/>
    <path d="M564 402H205V574L564 402Z" fill="#0a0a0f"/>
  </g>
</svg>
SVG

rsvg-convert -w 192 -h 192 "$SRC"       -o public/icon-192.png
rsvg-convert -w 512 -h 512 "$SRC"       -o public/icon-512.png
rsvg-convert -w 180 -h 180 "$SRC"       -o public/apple-touch-icon.png
rsvg-convert -w 512 -h 512 "$SRC_INNER" -o public/icon-maskable-512.png

echo "Wrote public/icon-192.png public/icon-512.png public/apple-touch-icon.png public/icon-maskable-512.png"
