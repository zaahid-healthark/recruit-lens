import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { colors } from "../theme";

interface Props {
  options: string[];
  /** null = "All" */
  selected: string | null;
  onSelect: (value: string | null) => void;
}

/** Horizontal chip row with an implicit "All" option. */
export function FilterChips({ options, selected, onSelect }: Props): React.JSX.Element {
  const all = [null, ...options];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {all.map((option) => {
        const active = option === selected;
        return (
          <Pressable
            key={option ?? "__all__"}
            onPress={() => onSelect(option)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{option ?? "All"}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.subtext,
  },
  labelActive: {
    color: "#FFFFFF",
  },
});
