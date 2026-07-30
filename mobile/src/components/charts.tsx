import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

/**
 * Dependency-free charts built from plain Views — deliberately chosen over a
 * native chart library so the dev build never breaks on a native module.
 * Swap for react-native-gifted-charts / victory-native later if fancier
 * visuals are wanted; the data shapes here already match those libraries.
 */

export interface ChartDatum {
  label: string;
  value: number;
  color?: string;
}

interface HorizontalBarsProps {
  data: ChartDatum[];
  /** Fixed scale maximum (e.g. 100 for scores). Defaults to the data max. */
  maxValue?: number;
}

export function HorizontalBars({ data, maxValue }: HorizontalBarsProps): React.JSX.Element {
  const max = Math.max(maxValue ?? 0, ...data.map((d) => d.value), 1);
  return (
    <View>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`} style={styles.hRow}>
          <Text style={styles.hLabel} numberOfLines={1}>
            {d.label}
          </Text>
          <View style={styles.hTrack}>
            <View
              style={[
                styles.hFill,
                {
                  width: `${Math.max((d.value / max) * 100, d.value > 0 ? 3 : 0)}%`,
                  backgroundColor: d.color ?? colors.primary,
                },
              ]}
            />
          </View>
          <Text style={styles.hValue}>{d.value}</Text>
        </View>
      ))}
    </View>
  );
}

interface VerticalBarChartProps {
  data: ChartDatum[];
  height?: number;
}

export function VerticalBarChart({ data, height = 132 }: VerticalBarChartProps): React.JSX.Element {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <View style={[styles.vContainer, { height: height + 38 }]}>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`} style={styles.vColumn}>
          <Text style={styles.vValue}>{d.value}</Text>
          <View
            style={[
              styles.vBar,
              {
                height: Math.max((d.value / max) * height, d.value > 0 ? 4 : 2),
                backgroundColor: d.color ?? colors.primary,
                opacity: d.value > 0 ? 1 : 0.25,
              },
            ]}
          />
          <Text style={styles.vLabel} numberOfLines={1}>
            {d.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 5,
  },
  hLabel: {
    width: 118,
    fontSize: 12,
    color: colors.text,
    marginRight: 8,
  },
  hTrack: {
    flex: 1,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#EDEEF3",
    overflow: "hidden",
  },
  hFill: {
    height: "100%",
    borderRadius: 6,
  },
  hValue: {
    width: 34,
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
    textAlign: "right",
  },
  vContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  vColumn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    height: "100%",
  },
  vValue: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.subtext,
    marginBottom: 3,
  },
  vBar: {
    width: "58%",
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  vLabel: {
    fontSize: 10,
    color: colors.subtext,
    marginTop: 5,
  },
});
