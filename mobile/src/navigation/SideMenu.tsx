import { Ionicons } from "@expo/vector-icons";
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, shadow } from "../theme";

/**
 * Slide-in menu for the screens that do not deserve a permanent tab: settings,
 * the JD library, the not-useful list, and the manual dialer.
 *
 * Hand-rolled on Animated + Modal rather than @react-navigation/drawer, which
 * would pull in react-native-gesture-handler and react-native-reanimated — two
 * native modules, for one panel. This needs no new native code at all.
 */

export type MenuDestination = "Dialer" | "Jobs" | "NotUseful" | "Settings";

interface MenuContextValue {
  open: () => void;
  close: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export function useSideMenu(): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("useSideMenu must be used inside <SideMenuProvider>");
  return ctx;
}

const ITEMS: { key: MenuDestination; label: string; icon: keyof typeof Ionicons.glyphMap; hint: string }[] =
  [
    {
      key: "Dialer",
      label: "Call a candidate",
      icon: "call-outline",
      hint: "Dial from the app to attach a name and JD up front",
    },
    {
      key: "Jobs",
      label: "Job descriptions",
      icon: "briefcase-outline",
      hint: "Roles candidates are scored against",
    },
    {
      key: "NotUseful",
      label: "Not useful",
      icon: "close-circle-outline",
      hint: "Calls kept off the server",
    },
    {
      key: "Settings",
      label: "Settings",
      icon: "settings-outline",
      hint: "Watched folder and auto-send rules",
    },
  ];

const PANEL_WIDTH = Math.min(320, Dimensions.get("window").width * 0.84);
const ANIM_MS = 220;

export function SideMenuProvider({
  onNavigate,
  children,
}: {
  onNavigate: (to: MenuDestination) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  // Kept off state so the slide is driven natively rather than by re-render.
  const slide = useRef(new Animated.Value(-PANEL_WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;

  const animate = useCallback(
    (to: "in" | "out", done?: () => void): void => {
      Animated.parallel([
        Animated.timing(slide, {
          toValue: to === "in" ? 0 : -PANEL_WIDTH,
          duration: ANIM_MS,
          easing: to === "in" ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fade, {
          toValue: to === "in" ? 1 : 0,
          duration: ANIM_MS,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => finished && done?.());
    },
    [slide, fade]
  );

  const open = useCallback((): void => {
    setVisible(true);
    // One frame so the Modal is mounted before the panel starts moving.
    requestAnimationFrame(() => animate("in"));
  }, [animate]);

  const close = useCallback((): void => {
    animate("out", () => setVisible(false));
  }, [animate]);

  const go = (to: MenuDestination): void => {
    // Close first so the panel is not still on screen behind the push.
    animate("out", () => {
      setVisible(false);
      onNavigate(to);
    });
  };

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <MenuContext.Provider value={value}>
      {children}
      <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
        <View style={styles.root}>
          <Animated.View style={[styles.scrim, { opacity: fade }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close menu" />
          </Animated.View>

          <Animated.View style={[styles.panel, { transform: [{ translateX: slide }] }]}>
            <View style={styles.header}>
              <Text style={styles.title}>RecruitLens</Text>
              <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close menu">
                <Ionicons name="close" size={22} color={colors.subtext} />
              </Pressable>
            </View>

            <ScrollView>
              {ITEMS.map((item) => (
                <Pressable key={item.key} style={styles.item} onPress={() => go(item.key)}>
                  <View style={styles.itemIcon}>
                    <Ionicons name={item.icon} size={19} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemLabel}>{item.label}</Text>
                    <Text style={styles.itemHint} numberOfLines={1}>
                      {item.hint}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </MenuContext.Provider>
  );
}

/** Hamburger for a screen's headerLeft. */
export function MenuButton(): React.JSX.Element {
  const { open } = useSideMenu();
  return (
    <Pressable onPress={open} hitSlop={12} style={styles.menuButton} accessibilityLabel="Open menu">
      <Ionicons name="menu" size={23} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,24,39,0.45)",
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: PANEL_WIDTH,
    backgroundColor: colors.card,
    paddingTop: 52,
    ...shadow,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  itemLabel: {
    fontSize: 14.5,
    fontWeight: "700",
    color: colors.text,
  },
  itemHint: {
    fontSize: 11.5,
    color: colors.subtext,
    marginTop: 2,
  },
  menuButton: {
    paddingHorizontal: 4,
  },
});
