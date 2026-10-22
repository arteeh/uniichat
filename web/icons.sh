#!/bin/sh
# icons.sh: remakes the web app's PNG icons from mark.svg (rsvg-convert
# draws them; nothing is drawn by hand), into this folder:
#   icon-192.png, icon-512.png  "any" (Windows, Linux, Edge, older macOS):
#       the mark at its own size (the bubble 80% wide) on transparent, its
#       infinity filled white and a thin white rim round the bubble, so it
#       still reads on a dark taskbar or dock
#   icon-maskable-192.png, icon-maskable-512.png  "maskable" (Android,
#       ChromeOS, newer macOS, Chrome's app list): opaque white to the edge,
#       the bubble half as wide, well inside the safe zone (the centred
#       circle of radius 40%) a mask may cut to
#   apple-touch-icon.png  180x180 (iPhone, iPad home screens): opaque
#       white, iOS rounds its corners; the bubble 60% wide
# The manifest's theme_color and background_color are both the dark page
# colour (#171719, style.css's dark --paper): a workaround for #10, white
# buttons on a white Android navigation bar. What Chrome does with them
# depends on its version and on whether the app runs edge to edge; a
# manifest takes one colour, so light mode gets a dark bar where Chrome
# paints it. Check on a phone. index.html's theme-color, light and dark,
# colours the status bar. Each icon is
# centred optically: on the point halfway between the bubble's box centre
# (32,32 in mark.svg's 64x64) and its ink's centroid (31.5,28.3), as the
# tail weighs little. Run where rsvg-convert is, e.g. from the repo:
#   podman run --rm -v "$PWD/web:/w:z" -w /w docker.io/library/alpine:latest \
#     sh -c 'apk add -q rsvg-convert && sh icons.sh'
set -eu
cd "$(dirname "$0")"

INK="#111111"
BG="#ffffff"
CX=31.75
CY=30.15
RIM=2.5

# the mark's insides (its <svg> tag dropped), and the bubble's outline
INNER=$(sed -e '/^<svg[ >]/d' -e '/^<\/svg>/d' mark.svg)
BUBBLE=$(sed -n 's/.*class="ink".* d="\([^"]*\)".*/\1/p' mark.svg)
[ -n "$INNER" ] && [ -n "$BUBBLE" ] || { echo "icons.sh: mark.svg not as expected" >&2; exit 1; }

# icon FILE PX WIDTH BG RIM: the mark in a PX square, the bubble WIDTH of
# it (a fraction: its 51 units of 64), on BG (none: transparent), with
# the white rim and filled infinity if RIM is 1
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
