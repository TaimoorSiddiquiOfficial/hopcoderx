// HOPCODERX HDR block logo
// Left  panel: H O P C  — 5-wide letters, 7 rows (▄ top-cap · 5 body · ▀ base)
// Right panel: O D E R X — 5-wide letters, 7 rows
// Each letter is exactly 5 chars wide; single-space separator between letters.
// ▄/▀ half-blocks give sub-pixel crispness at letter edges (HDR effect).
export const logo = {
  left: [
    "▄   ▄  ▄▄▄  ▄▄▄▄  ▄▄▄▄ ",  // top cap
    "█   █  ███  ████  ████ ",  // H  O  P  C  — row 0
    "█   █ █   █ █   █ █    ",  // row 1
    "█████ █   █ ████  █    ",  // row 2  (H crossbar · O side · P bowl close · C side)
    "█   █ █   █ █     █    ",  // row 3
    "█   █  ███  █     ████ ",  // row 4
    "▀   ▀  ▀▀▀  ▀     ▀▀▀▀ ",  // base cap
  ],
  right: [
    " ▄▄▄  ▄▄▄▄  ▄▄▄▄▄ ▄▄▄▄  ▄   ▄",  // top cap
    " ███  ████  █████ ████  █   █",  // O  D  E  R  X  — row 0
    "█   █ █   █ █     █   █  █ █ ",  // row 1
    "█   █ █   █ ████  ████    █  ",  // row 2  (E mid-bar · R bowl close · X centre)
    "█   █ █   █ █     █  █   █ █ ",  // row 3  (R leg begins)
    " ███  ████  █████ █   █ █   █",  // row 4
    " ▀▀▀  ▀▀▀▀  ▀▀▀▀▀ ▀   ▀ ▀   ▀",  // base cap
  ],
}

export const marks = "_^~"
