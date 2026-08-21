import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { DashboardScreen } from "../screens/DashboardScreen";
import { DialerScreen } from "../screens/DialerScreen";
import { JobsScreen } from "../screens/JobsScreen";
import { RecordingDetailScreen } from "../screens/RecordingDetailScreen";
import { RecordingsScreen } from "../screens/RecordingsScreen";
import { colors } from "../theme";

export type RecordingsStackParamList = {
  RecordingsList: undefined;
  RecordingDetail: { id: string };
};

export type RootTabParamList = {
  RecordingsTab: undefined;
  Jobs: undefined;
  Dashboard: undefined;
  Dialer: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<RecordingsStackParamList>();

function RecordingsStack(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { fontWeight: "800", color: colors.text },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="RecordingsList"
        component={RecordingsScreen}
        options={{ title: "Recordings" }}
      />
      <Stack.Screen
        name="RecordingDetail"
        component={RecordingDetailScreen}
        options={{ title: "Evaluation" }}
      />
    </Stack.Navigator>
  );
}

export function RootNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.subtext,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { fontWeight: "800", color: colors.text },
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
        name="Jobs"
        component={JobsScreen}
        options={{
          title: "Jobs",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="briefcase" color={color} size={size} />
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
      <Tab.Screen
        name="Dialer"
        component={DialerScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="call" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}
