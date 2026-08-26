import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createNavigationContainerRef } from "@react-navigation/native";
import React from "react";
import { DashboardScreen } from "../screens/DashboardScreen";
import { DialerScreen } from "../screens/DialerScreen";
import { JobsScreen } from "../screens/JobsScreen";
import { LocalAudioScreen } from "../screens/LocalAudioScreen";
import { NotUsefulScreen } from "../screens/NotUsefulScreen";
import { RecordingDetailScreen } from "../screens/RecordingDetailScreen";
import { RecordingsScreen } from "../screens/RecordingsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { colors } from "../theme";
import { MenuButton, MenuDestination, SideMenuProvider } from "./SideMenu";

/**
 * Three tabs for the screens used constantly, a slide-in menu for everything
 * else. The Dialer used to be a tab AND the home of every auto-import setting;
 * both moved out — settings to their own screen, the dialer to the menu, since
 * recruiters mostly dial from the phone's own dialer now.
 */

export type RecordingsStackParamList = {
  RecordingsList: undefined;
  RecordingDetail: { id: string };
};

export type RootTabParamList = {
  RecordingsTab: undefined;
  LocalAudio: undefined;
  Dashboard: undefined;
};

export type RootStackParamList = {
  Main: undefined;
  Dialer: undefined;
  Jobs: undefined;
  NotUseful: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<RecordingsStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

/** Lets the menu (rendered outside the navigator) push onto the root stack. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const headerStyling = {
  headerShadowVisible: false,
  headerStyle: { backgroundColor: colors.background },
  headerTitleStyle: { fontWeight: "800" as const, color: colors.text },
  contentStyle: { backgroundColor: colors.background },
};

function RecordingsStack(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={headerStyling}>
      <Stack.Screen
        name="RecordingsList"
        component={RecordingsScreen}
        options={{ title: "Recordings", headerLeft: () => <MenuButton /> }}
      />
      <Stack.Screen
        name="RecordingDetail"
        component={RecordingDetailScreen}
        options={{ title: "Evaluation" }}
      />
    </Stack.Navigator>
  );
}

function MainTabs(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.subtext,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { fontWeight: "800", color: colors.text },
        headerLeft: () => <MenuButton />,
      }}
    >
      <Tab.Screen
        name="RecordingsTab"
        component={RecordingsStack}
        options={{
          title: "Recordings",
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="mic" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="LocalAudio"
        component={LocalAudioScreen}
        options={{
          title: "On this phone",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="folder-open" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator(): React.JSX.Element {
  const go = (to: MenuDestination): void => {
    if (navigationRef.isReady()) navigationRef.navigate(to);
  };

  return (
    <SideMenuProvider onNavigate={go}>
      <RootStack.Navigator screenOptions={headerStyling}>
        <RootStack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <RootStack.Screen
          name="Dialer"
          component={DialerScreen}
          options={{ title: "Call a candidate" }}
        />
        <RootStack.Screen name="Jobs" component={JobsScreen} options={{ title: "Job descriptions" }} />
        <RootStack.Screen
          name="NotUseful"
          component={NotUsefulScreen}
          options={{ title: "Not useful" }}
        />
        <RootStack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
      </RootStack.Navigator>
    </SideMenuProvider>
  );
}
