/*!
Palette adaptations from Nodecode: https://github.com/nodecode-ai/nodecode
MIT License

Copyright (c) 2025-2026 Nodecode AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Everforest palettes: https://github.com/sainnhe/everforest
MIT License

Copyright (c) 2019 sainnhe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Ghostty palette collection: https://github.com/mbadolato/iTerm2-Color-Schemes
MIT License

Copyright (c) 2011 to Present Mark Badolato

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

This license covers the iTerm-Color-Schemes repository collection of themes.

The copyright/license for each individual theme belongs to the author of that theme.
*/

type Mode = "auto" | "light" | "dark";
export type Preference = { mode: Mode; light: string; dark: string };
export type Palette = {
  id: string; name: string; mode: "light" | "dark";
  bg: string; fg: string; muted: string; soft: string;
  surface: string; input: string; hover: string; border: string;
  accent: string; success: string; error: string; warm: string;
};

const CATALOG: Palette[] = [
  {
    "id": "unii-light",
    "name": "Unii Light",
    "mode": "light",
    "bg": "#ffffff",
    "fg": "#111111",
    "muted": "#5f5f5f",
    "soft": "#5f5f5f",
    "surface": "#f2f2f2",
    "input": "#ffffff",
    "hover": "#e8e8e8",
    "border": "#cccccc",
    "accent": "#6d3fd8",
    "success": "#1a7f37",
    "error": "#b42318",
    "warm": "#e8590c"
  },
  {
    "id": "unii-dark",
    "name": "Unii Dark",
    "mode": "dark",
    "bg": "#171719",
    "fg": "#e3e3e6",
    "muted": "#a6a6ad",
    "soft": "#a6a6ad",
    "surface": "#2c2c31",
    "input": "#222226",
    "hover": "#37373d",
    "border": "#4c4c53",
    "accent": "#ad94ff",
    "success": "#55b874",
    "error": "#f8857c",
    "warm": "#f59f4c"
  },
  {
    "id": "tungstene",
    "name": "Tungstene",
    "mode": "dark",
    "bg": "#1c1917",
    "fg": "#e7e5e4",
    "muted": "#78716c",
    "soft": "#78716c",
    "surface": "#292524",
    "input": "#3b3937",
    "hover": "#2b2826",
    "border": "#292524",
    "accent": "#fca864",
    "success": "#55bfa3",
    "error": "#ef4444",
    "warm": "#fdba74"
  },
  {
    "id": "hello-kitty",
    "name": "Hello Kitty Lo-Fi",
    "mode": "dark",
    "bg": "#1f1719",
    "fg": "#ffe4e6",
    "muted": "#bfa2ac",
    "soft": "#bfa2ac",
    "surface": "#36252e",
    "input": "#291d23",
    "hover": "#36252e",
    "border": "#4a2c36",
    "accent": "#f798ca",
    "success": "#86efac",
    "error": "#f43f5e",
    "warm": "#60a5fa"
  },
  {
    "id": "komorebi",
    "name": "Komorebi",
    "mode": "dark",
    "bg": "#1a1d1a",
    "fg": "#ecfccb",
    "muted": "#84a98c",
    "soft": "#84a98c",
    "surface": "#2f3e2f",
    "input": "#222722",
    "hover": "#263026",
    "border": "#2f3e2f",
    "accent": "#a3e635",
    "success": "#84cc16",
    "error": "#ef4444",
    "warm": "#bef264"
  },
  {
    "id": "blueprint-daylight",
    "name": "Blueprint Daylight",
    "mode": "light",
    "bg": "#f4f7fb",
    "fg": "#1b2733",
    "muted": "#5c6f87",
    "soft": "#5c6f87",
    "surface": "#ffffff",
    "input": "#ffffff",
    "hover": "#e6edf7",
    "border": "#b4c4d8",
    "accent": "#1d6fd1",
    "success": "#0d6b41",
    "error": "#b91c1c",
    "warm": "#1450a3"
  },
  {
    "id": "everforest-light",
    "name": "Everforest Light Med",
    "mode": "light",
    "bg": "#efebd4",
    "fg": "#5c6a72",
    "muted": "#7a8478",
    "soft": "#7a8478",
    "surface": "#eaedc8",
    "input": "#efebd4",
    "hover": "#eaedc8",
    "border": "#a6b0a0",
    "accent": "#7fbbb3",
    "success": "#9ab373",
    "error": "#e67e80",
    "warm": "#c1a266"
  },
  {
    "id": "everforest-dark",
    "name": "Everforest Dark Hard",
    "mode": "dark",
    "bg": "#1e2326",
    "fg": "#d3c6aa",
    "muted": "#7a8478",
    "soft": "#7a8478",
    "surface": "#4c3743",
    "input": "#1e2326",
    "hover": "#4c3743",
    "border": "#a6b0a0",
    "accent": "#7fbbb3",
    "success": "#a7c080",
    "error": "#e67e80",
    "warm": "#dbbc7f"
  }
];

function rgb(hex: string): number[] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
}

function luminance(hex: string): number {
  return rgb(hex).reduce((sum, c, i) => {
    const v = c / 255;
    return sum + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
  }, 0);
}

function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

function readable(color: string, grounds: string[], mode: Palette["mode"]): string {
  const target = mode === "dark" ? 255 : 0;
  const from = rgb(color);
  for (let step = 0; step <= 100; step++) {
    const hex = "#" + from.map((c) => Math.round(c + (target - c) * step / 100).toString(16).padStart(2, "0")).join("");
    if (grounds.every((bg) => contrast(hex, bg) >= 4.5)) {
      return hex;
    }
  }
  return target === 255 ? "#ffffff" : "#000000";
}

export const PALETTES: Palette[] = CATALOG.map((p) => {
  const grounds = [p.bg, p.surface, p.input, p.hover];
  return { ...p, ...Object.fromEntries(["fg", "muted", "soft", "accent", "success", "error", "warm"].map((k) => [k, readable(p[k as keyof Palette], grounds, p.mode)])) };
});

export const DEFAULT: Preference = { mode: "auto", light: "unii-light", dark: "unii-dark" };

export function preference(value: unknown): Preference {
  const p = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const valid = (key: "light" | "dark") => PALETTES.some((v) => v.id === p[key] && v.mode === key) ? p[key] as string : DEFAULT[key];
  return { mode: p.mode === "light" || p.mode === "dark" ? p.mode : "auto", light: valid("light"), dark: valid("dark") };
}

export function resolve(p: Preference, dark: boolean): Palette {
  const mode = p.mode === "auto" ? dark ? "dark" : "light" : p.mode;
  return PALETTES.find((v) => v.id === p[mode] && v.mode === mode) ?? PALETTES[mode === "light" ? 0 : 1];
}
