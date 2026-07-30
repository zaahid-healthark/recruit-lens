import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, shadow } from "../theme";

interface Props {
  options: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

/** Simple two-(or more-)way segmented control. */
export function SegmentedControl({ options, selectedIndex, onChange }: Props): React.JSX.Element {
  return (
    <View style={styles.container}>
      {options.map((option, i) => {
        const selected = i === selectedIndex;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(i)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#E9EAF0",
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: {
    backgroundColor: colors.card,
    ...shadow,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.subtext,
  },
  labelSelected: {
    color: colors.text,
  },
});
