#!/bin/sh
set -eu
cd "$(dirname "$0")"

INK="#111111"
BG="#ffffff"
CX=31.75
CY=30.15
RIM=2.5

INNER=$(sed -e '/^<svg[ >]/d' -e '/^<\/svg>/d' mark.svg)
BUBBLE=$(sed -n 's/.*class="ink".* d="\([^"]*\)".*/\1/p' mark.svg)
[ -n "$INNER" ] && [ -n "$BUBBLE" ] || { echo "icons.sh: mark.svg not as expected" >&2; exit 1; }

icon() {
  side=$(awk -v w="$3" 'BEGIN { printf "%.4f", 51 / w }')
  x0=$(awk -v s="$side" -v c="$CX" 'BEGIN { printf "%.4f", c - s / 2 }')
  y0=$(awk -v s="$side" -v c="$CY" 'BEGIN { printf "%.4f", c - s / 2 }')
  {
    echo "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"$2\" height=\"$2\" viewBox=\"$x0 $y0 $side $side\">"
    [ "$4" = none ] || echo "<rect x=\"$x0\" y=\"$y0\" width=\"$side\" height=\"$side\" fill=\"$4\"/>"
    [ "$5" = 0 ] || echo "<path d=\"$BUBBLE\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\"$(awk -v r="$RIM" 'BEGIN { print 3 + 2 * r }')\" stroke-linejoin=\"round\"/>"
    echo "$INNER"
    echo "<style>.ink{fill:$INK;stroke:$INK}</style>"
    echo "</svg>"
  } > "$1.svg"
  rsvg-convert -w "$2" -h "$2" "$1.svg" -o "$1"
  rm -f "$1.svg"
}

icon icon-192.png          192 0.80 none  1
icon icon-512.png          512 0.80 none  1
icon icon-maskable-192.png 192 0.50 "$BG" 0
icon icon-maskable-512.png 512 0.50 "$BG" 0
icon apple-touch-icon.png  180 0.60 "$BG" 0
echo "icons.sh: icon-192.png icon-512.png icon-maskable-192.png icon-maskable-512.png apple-touch-icon.png"
