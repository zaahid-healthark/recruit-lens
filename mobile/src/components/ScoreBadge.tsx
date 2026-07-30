import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { scoreColor } from "../theme";

interface Props {
  score: number;
  size?: "small" | "large";
}

/** Colored circular score badge (color follows the 5 scoring bands). */
export function ScoreBadge({ score, size = "small" }: Props): React.JSX.Element {
  const dim = size === "large" ? 84 : 44;
  const fontSize = size === "large" ? 28 : 15;
  return (
    <View
      style={[
        styles.badge,
        { width: dim, height: dim, borderRadius: dim / 2, backgroundColor: scoreColor(score) },
      ]}
    >
      <Text style={[styles.text, { fontSize }]}>{score}</Text>
      {size === "large" ? <Text style={styles.outOf}>/ 100</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  outOf: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: -2,
  },
});
