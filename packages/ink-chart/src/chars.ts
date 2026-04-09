// block elements u+2581 through u+2588
export const BLOCKS = Array.from({ length: 8 }, (_, i) =>
  String.fromCodePoint(0x2581 + i),
);

// full block u+2588
export const FULL_BLOCK = String.fromCodePoint(0x2588);

// box drawing
export const BOX_VERTICAL = String.fromCodePoint(0x2502);
export const BOX_UP_RIGHT = String.fromCodePoint(0x2514);
export const BOX_HORIZONTAL = String.fromCodePoint(0x2500);
export const BOX_DIAGONAL_UP = String.fromCodePoint(0x2571);
export const BOX_DIAGONAL_DOWN = String.fromCodePoint(0x2572);
export const MIDDLE_DOT = String.fromCodePoint(0x00B7);
