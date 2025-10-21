import * as React from "react";
import { Button, Platform, Text, View } from "react-native";
import * as Notifications from "expo-notifications";

// Make notifications visible while the app is open (handy for testing)
Notifications.setNotificationHandler({
  handleNotification: async (): Promise<Notifications.NotificationBehavior> => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    // newer SDK fields expected by types
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function App() {
  const [perm, setPerm] = React.useState("unknown");

  React.useEffect(() => {
    (async () => {
      // iOS permission prompt
      const { status } = await Notifications.requestPermissionsAsync();
      setPerm(status);

      // Android needs a channel to show notifications
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
    })();
  }, []);

  const scheduleTest = async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Bedtime drift test",
        body: "This is a local test nudge. It should fire in ~60 seconds.",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 60,
        repeats: false,
      },
      // If you want it instantly instead (for sanity check), use:
      // trigger: null,
    });
  };

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Text style={{ fontSize: 18, marginBottom: 12 }}>Sleep Nudge Dev</Text>
      <Text style={{ marginBottom: 12 }}>Notification permission: {perm}</Text>
      <Button title="Schedule test nudge in 60s" onPress={scheduleTest} />
      <Text style={{ marginTop: 12, fontSize: 12 }}>
        After tapping, lock your phone and wait about a minute.
      </Text>
    </View>
  );
}
