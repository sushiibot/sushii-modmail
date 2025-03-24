// Colors from Catpuccin
// https://github.com/catppuccin/catppuccin

export const Color = {
  Pink: "#f5c2e7",
  Blue: "#89dceb",
  Lavender: "#b4befe",
  Gray: "#313244",
} as const;

export type ColorKey = keyof typeof Color;
export type ColorValue = (typeof Color)[ColorKey];
