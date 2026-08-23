import type { CSSProperties } from "react";

/** ChessPaa's warm park board — sand & teal, big rounded corners. */
export const LIGHT_SQ: CSSProperties = { backgroundColor: "#fdf4e0" };
export const DARK_SQ: CSSProperties = { backgroundColor: "#7cc5cc" };

export const BOARD_STYLE: CSSProperties = {
  borderRadius: "14px",
  boxShadow: "0 14px 40px rgba(15,23,42,0.18)",
  overflow: "hidden",
};

export const SELECTED_STYLE: CSSProperties = {
  background:
    "radial-gradient(circle, rgba(250,204,21,0.55) 0%, rgba(250,204,21,0.28) 60%, transparent 70%)",
  boxShadow: "inset 0 0 0 3px rgba(250,204,21,0.9)",
};

export const LEGAL_DOT: CSSProperties = {
  background: "radial-gradient(circle, rgba(15,118,110,0.45) 22%, transparent 26%)",
  cursor: "pointer",
};

export const LEGAL_CAPTURE: CSSProperties = {
  background: "radial-gradient(circle, transparent 58%, rgba(239,68,68,0.5) 62%)",
  cursor: "pointer",
};

export const LAST_MOVE: CSSProperties = { backgroundColor: "rgba(250,204,21,0.35)" };
export const CHECK_SQ: CSSProperties = {
  background: "radial-gradient(circle, rgba(239,68,68,0.65) 0%, rgba(239,68,68,0.2) 70%)",
};
export const HINT_SQ: CSSProperties = {
  boxShadow: "inset 0 0 0 4px rgba(37,169,180,0.95)",
  borderRadius: "8px",
};
export const STAR_SQ: CSSProperties = {
  background:
    "radial-gradient(circle, rgba(250,204,21,0.85) 0%, rgba(250,204,21,0.25) 55%, transparent 65%)",
};
