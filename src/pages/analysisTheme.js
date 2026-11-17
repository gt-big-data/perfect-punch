// Shared look for the dashboard and the progress analysis page, so the two
// stay in step instead of drifting apart as either one changes.

// One red ramp, light -> dark, shared by every chart: the lightest tone is
// always the best outcome (Jab / Dodged) and the darkest the worst (Hit).
export const RED_LIGHT = "#ef8c7a";
export const RED_MID = "#df4b42";
export const RED_DARK = "#7e2026";
export const PUNCH_COLORS = [RED_LIGHT, RED_MID, RED_DARK];
export const VELOCITY_COLOR = "#f2695c";
export const ACCURACY_COLOR = "#e5c14c";
// Reaction time needs to sit beside the two warm series above without being
// mistaken for either, so it takes the one cool tone in the palette.
export const REACTION_COLOR = "#8fb8d8";

// Percentage metrics are graded by color instead of a medal:
// 0-50 red, 50-75 yellow, 75-100 green.
export const GRADE_RED = "#d6392c";
export const GRADE_YELLOW = "#e3b341";
export const GRADE_GREEN = "#3fb950";
// Softer green for a smaller gain, so verdicts read as a scale rather than
// two greens that look identical.
export const GRADE_GREEN_SOFT = "#7fc243";

const PERCENT_COLORS = [
  { max: 50, color: GRADE_RED },
  { max: 75, color: GRADE_YELLOW },
  { max: Infinity, color: GRADE_GREEN },
];
export const percentColor = (pct) =>
  PERCENT_COLORS.find((t) => pct < t.max).color;

// Neutrals, named so a page never has to guess which grey to reach for.
export const INK = "#ffffff";
export const INK_SOFT = "#e8e8e8";
export const INK_MUTED = "#9a9a9a";
export const INK_FAINT = "#8a8a8a";
export const SURFACE = "#101010";
export const PAGE_BG = "#000000";
export const BORDER = "#262626";
export const BORDER_SOFT = "#1f1f1f";
export const GRID = "#232323";

export const cardStyle = {
  borderRadius: "18px",
  padding: "28px 32px 24px",
  background: SURFACE,
  border: `1px solid ${BORDER}`,
};
export const titleStyle = {
  fontSize: "1.3rem",
  fontWeight: "700",
  color: "#f2f2f2",
  margin: 0,
};
export const eyebrowStyle = {
  fontSize: "0.72rem",
  letterSpacing: "0.18em",
  color: INK_FAINT,
  fontWeight: "600",
};
export const dividerStyle = { height: "1px", background: BORDER };

// Shared dark tooltip so the hover layer stops flashing white on black.
export const tooltipStyle = {
  background: "#1c1c1c",
  border: "1px solid #3a3a3a",
  borderRadius: "10px",
  color: "#f5f5f5",
};

// The red call-to-action used for page navigation.
export const primaryButtonStyle = {
  backgroundColor: GRADE_RED,
  color: "white",
  border: "none",
  borderRadius: "16px",
  padding: "12px 24px",
  fontSize: "1rem",
  fontWeight: "700",
  cursor: "pointer",
  boxShadow: "0 8px 24px rgba(214, 57, 44, 0.45)",
};
