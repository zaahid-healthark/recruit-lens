import { Ionicons } from "@expo/vector-icons";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors } from "../theme";

/**
 * Slide-in menu for the screens that do not deserve a permanent tab.
 *
 * Rendered as an absolutely-positioned overlay inside the app tree rather than
 * in a Modal. A Modal has to mount a whole new native window before anything
 * can animate, which on Android shows up as a stutter on every open — the
 * panel is always mounted here, so opening is nothing but a transform that the
 * native driver owns end to end.
 *
 * Deliberately not @react-navigation/drawer: that needs
 * react-native-gesture-handler and react-native-reanimated, two native modules
 * for one panel.
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

interface Item {
  key: MenuDestination;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  hint: string;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Work",
    items: [
      {
        key: "Dialer",
        label: "Call a candidate",
        icon: "call-outline",
        hint: "Attach a name and JD up front",
      },
      {
        key: "Jobs",
        label: "Job descriptions",
        icon: "briefcase-outline",
        hint: "Roles candidates are scored against",
      },
    ],
  },
  {
    title: "Manage",
    items: [
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
        hint: "Watched folder and sending rules",
      },
    ],
  },
];

const SCREEN_W = Dimensions.get("window").width;
const PANEL_W = Math.min(316, SCREEN_W * 0.82);
const OPEN_MS = 260;
const CLOSE_MS = 200;

export function SideMenuProvider({
  onNavigate,
  children,
}: {
  onNavigate: (to: MenuDestination) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [mounted, setMounted] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const animate = useCallback(
    (to: 0 | 1, done?: () => void): void => {
      Animated.timing(progress, {
        toValue: to,
        duration: to === 1 ? OPEN_MS : CLOSE_MS,
        // Decelerate on the way in, accelerate on the way out — the panel
        // arrives gently and leaves briskly, which reads as responsive.
        easing: to === 1 ? Easing.bezier(0.16, 1, 0.3, 1) : Easing.bezier(0.4, 0, 1, 1),
        useNativeDriver: true,
      }).start(({ finished }) => finished && done?.());
    },
    [progress]
  );

  const open = useCallback((): void => {
    setMounted(true);
    animate(1);
  }, [animate]);

  const close = useCallback((): void => {
    animate(0, () => setMounted(false));
  }, [animate]);

  const go = useCallback(
    (to: MenuDestination): void => {
      // Navigate immediately and let the panel close behind it; waiting for the
      // animation first makes every tap feel like it lagged.
      onNavigate(to);
      animate(0, () => setMounted(false));
    },
    [animate, onNavigate]
  );

  // Android back should close the menu before it pops a screen.
  useEffect(() => {
    if (!mounted) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [mounted, close]);

  const value = useMemo(() => ({ open, close }), [open, close]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-PANEL_W - 8, 0], // extra px hides the shadow when closed
  });

  return (
    <MenuContext.Provider value={value}>
      <View style={styles.host}>
        {children}

        {/* Always mounted; pointerEvents is what makes it inert when closed,
            so no native view is created or destroyed on open. */}
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents={mounted ? "auto" : "none"}
          accessibilityElementsHidden={!mounted}
        >
          <Animated.View style={[styles.scrim, { opacity: progress }]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={close}
              accessibilityLabel="Close menu"
            />
          </Animated.View>

          <Animated.View style={[styles.panel, { transform: [{ translateX }] }]}>
            <View style={styles.brand}>
              <View style={styles.brandMark}>
                <Ionicons name="mic" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.brandName}>RecruitLens</Text>
                <Text style={styles.brandSub}>Interview evaluation</Text>
              </View>
              <Pressable onPress={close} hitSlop={12} accessibilityLabel="Close menu">
                <Ionicons name="close" size={21} color={colors.subtext} />
              </Pressable>
            </View>

            {GROUPS.map((group) => (
              <View key={group.title} style={styles.group}>
                <Text style={styles.groupTitle}>{group.title.toUpperCase()}</Text>
                {group.items.map((item) => (
                  <Pressable
                    key={item.key}
                    style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                    onPress={() => go(item.key)}
                    android_ripple={{ color: colors.border }}
                  >
                    <View style={styles.itemIcon}>
                      <Ionicons name={item.icon} size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemLabel}>{item.label}</Text>
                      <Text style={styles.itemHint} numberOfLines={1}>
                        {item.hint}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={colors.border} />
                  </Pressable>
                ))}
              </View>
            ))}
          </Animated.View>
        </View>
      </View>
    </MenuContext.Provider>
  );
}

/** Hamburger for a screen's headerLeft. */
export function MenuButton(): React.JSX.Element {
  const { open } = useSideMenu();
  return (
    <Pressable onPress={open} hitSlop={14} style={styles.menuButton} accessibilityLabel="Open menu">
      <Ionicons name="menu" size={23} color={colors.text} />
    </Pressable>
  );
}

const STATUS_H = Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) : 44;

const styles = StyleSheet.create({
  host: { flex: 1 },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.5)",
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: PANEL_W,
    backgroundColor: colors.card,
    paddingTop: STATUS_H + 14,
    // Rounded on the free edge only; the other side meets the screen edge.
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    elevation: 16,
    shadowColor: "#0F172A",
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 4, height: 0 },
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { fontSize: 16.5, fontWeight: "800", color: colors.text },
  brandSub: { fontSize: 11.5, color: colors.subtext, marginTop: 1 },
  group: { paddingTop: 6 },
  groupTitle: {
    fontSize: 10.5,
    fontWeight: "800",
    color: colors.subtext,
    letterSpacing: 0.8,
    paddingHorizontal: 18,
    paddingBottom: 6,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  itemPressed: { backgroundColor: colors.background },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  itemLabel: { fontSize: 14, fontWeight: "700", color: colors.text },
  itemHint: { fontSize: 11, color: colors.subtext, marginTop: 2 },
  menuButton: { paddingHorizontal: 4 },
});
