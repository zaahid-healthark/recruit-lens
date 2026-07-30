import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

/**
 * ── DIALER — intentional placeholder (stub for a future release) ────────────
 *
 * Planned shape (CPaaS click-to-call, e.g. Exotel/Plivo):
 *   1. This screen collects a candidate phone number and POSTs /calls to the
 *      backend; the provider dials the recruiter first, then bridges the
 *      candidate, recording the call server-side.
 *   2. A provider webhook on the backend stores the finished call recording
 *      and imports it as a Recording (status UNEVALUATED) automatically —
 *      reusing the exact same evaluation pipeline as shared files.
 *
 * Keep this component as the mount point; replace the body below with the
 * number pad / call UI when the integration lands.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function DialerScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name="call-outline" size={40} color={colors.primary} />
      </View>
      <Text style={styles.title}>Calling from the app is coming soon.</Text>
      <Text style={styles.subtitle}>
        You&apos;ll be able to dial candidates directly and have the call recorded and evaluated
        automatically. For now, record calls with your phone&apos;s recorder and share the audio
        into this app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 36,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    color: colors.subtext,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 10,
  },
});
