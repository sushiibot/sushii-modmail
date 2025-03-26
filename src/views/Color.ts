// Colors from Catpuccin
// https://github.com/catppuccin/catppuccin

export const Color = {
  Pink: "#f5c2e7",
  Blue: "#89b4fa",
  Green: "#a6e3a1",
  Purple: "#b4befe", // Lavender
  Gray: "#585b70",
} as const;

export type ColorKey = keyof typeof Color;
export type ColorValue = (typeof Color)[ColorKey];
