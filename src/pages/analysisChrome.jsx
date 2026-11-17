import React from "react";
import {
  dividerStyle,
  eyebrowStyle,
  titleStyle,
  INK,
  INK_FAINT,
  RED_MID,
} from "./analysisTheme";

// The card chrome every chart on the dashboard and progress page sits in.

// Title on the left, a headline stat (or a custom node) on the right.
export const ChartHeader = ({ title, statLabel, statValue, statUnit, statColor, right }) => (
  <>
    <div
      style={{
        display: "flex",
        alignItems: right ? "center" : "flex-end",
        justifyContent: "space-between",
        gap: "24px",
        flexWrap: "wrap",
      }}
    >
      <h2 style={titleStyle}>{title}</h2>
      {right || (
        <div style={{ textAlign: "right" }}>
          <div style={eyebrowStyle}>{statLabel}</div>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: "800",
              lineHeight: "1.1",
              color: statColor || INK,
            }}
          >
            {statValue}
            <span style={{ color: statColor || RED_MID }}>{statUnit}</span>
          </div>
        </div>
      )}
    </div>
    <div style={{ ...dividerStyle, margin: "18px 0 4px" }} />
  </>
);

export const ChartFooter = ({ items, note }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "16px",
      flexWrap: "wrap",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: "22px", flexWrap: "wrap" }}>
      {items.map((item) => (
        <span
          key={item.name}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "9px",
            color: "#d2d2d2",
            fontSize: "0.95rem",
          }}
        >
          <span
            style={{
              width: "11px",
              height: "11px",
              borderRadius: "3px",
              background: item.color,
            }}
          />
          {item.name}
        </span>
      ))}
    </div>
    {note && <span style={{ color: INK_FAINT, fontSize: "0.9rem" }}>{note}</span>}
  </div>
);
