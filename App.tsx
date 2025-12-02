import * as React from "react";
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";

import {
  Night,
  DerivedNight,
  readRaw as readNightsRaw,
  writeRaw as writeNightsRaw,
  clearAll,
  storageKind,
} from "./storage";

/* ---------------- UI helpers ---------------- */

const H = (props: { children: React.ReactNode }) => (
  <Text style={{ color: "white", fontSize: 36, fontWeight: "800", marginBottom: 8 }}>
    {props.children}
  </Text>
);

const LinkButton: React.FC<{
  title: string;
  onPress: () => void;
  tone?: "primary" | "danger";
}> = ({ title, onPress, tone = "primary" }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.8}
    style={{ marginRight: 18, marginBottom: 22 }}
  >
    <Text
      style={{
        fontSize: 28,
        fontWeight: "700",
        color: tone === "danger" ? "#ff7a7a" : "#66a8ff",
      }}
    >
      {title}
    </Text>
  </TouchableOpacity>
);

const Card: React.FC<{ children: React.ReactNode; pad?: boolean }> = ({
  children,
  pad = true,
}) => (
  <View
    style={{
      backgroundColor: "rgba(255,255,255,0.06)",
      borderRadius: 18,
      padding: pad ? 16 : 0,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.06)",
    }}
  >
    {children}
  </View>
);

/* ---------------- notifications ---------------- */

// Make notifications visible while app is foregrounded (for testing)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    // new fields on recent SDKs
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/* ---------------- tiny stats helpers ---------------- */

const toMinutes = (d: Date) => Math.floor(d.getTime() / 60000);
const fromISO = (s: string) => new Date(s);
const fmtHM = (m: number | null) => {
  if (m == null) return "n/a";
  const h24 = Math.floor((m / 60) % 24);
  const mm = Math.abs(Math.floor(m % 60));
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = ((h24 + 11) % 12) + 1;
  return `${h}:${mm.toString().padStart(2, "0")} ${ampm}`;
};

function derive(n: Night): DerivedNight {
  const start = fromISO(n.sleep_start);
  const end = fromISO(n.sleep_end);
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  const duration_min = Math.max(0, endMin - startMin);
  const midsleep_min_epoch = startMin + Math.floor(duration_min / 2);
  return { ...n, duration_min, midsleep_min_epoch };
}

function summarize(derived: DerivedNight[]) {
  const last7 = derived.slice(0, 7);
  const coverage = last7.length;
  const baselineMid =
    coverage > 0
      ? Math.floor(last7.reduce((s, d) => s + d.midsleep_min_epoch, 0) / coverage)
      : null;

  const last = last7[0];
  const recentLateness =
    baselineMid != null && last ? last.midsleep_min_epoch - baselineMid : 0;

  const regularityLoss =
    coverage > 1
      ? last7
          .map((d) =>
            Math.abs(d.midsleep_min_epoch - (baselineMid ?? d.midsleep_min_epoch))
          )
          .reduce((a, b) => a + b, 0)
      : 0;

  const drift = Math.abs(recentLateness) >= 90; // 90+ min away from baseline

  return {
    coverage,
    baselineMid,
    recentLateness,
    regularityLoss,
    drift,
  };
}

/* ---------------- CSV import helpers ---------------- */

// Expected header: date,sleep_start,sleep_end
function parseCsvToNights(csv: string): Night[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length <= 1) {
    throw new Error("CSV file has no data rows.");
  }

  const header = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase());

  const idxDate = header.indexOf("date");
  const idxStart = header.indexOf("sleep_start");
  const idxEnd = header.indexOf("sleep_end");

  if (idxDate === -1 || idxStart === -1 || idxEnd === -1) {
    throw new Error(
      "CSV must have header: date,sleep_start,sleep_end (in any order)."
    );
  }

  const nights: Night[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row) continue;
    const parts = row.split(",");
    if (parts.length < header.length) continue;

    const date = parts[idxDate]?.trim();
    const sleep_start = parts[idxStart]?.trim();
    const sleep_end = parts[idxEnd]?.trim();

    if (!date || !sleep_start || !sleep_end) {
      // skip incomplete rows
      continue;
    }

    nights.push({ date, sleep_start, sleep_end });
  }

  if (nights.length === 0) {
    throw new Error("No valid rows found in CSV.");
  }

  return nights;
}

/* ---------------- fake data ---------------- */

function makeFake(
  dayOffset: number,
  baseHM = { h: 0, m: 30 },
  driftMin = 0
): Night {
  const today = new Date();
  today.setDate(today.getDate() - dayOffset);
  const date = today.toISOString().slice(0, 10);

  const start = new Date(
    `${date}T${String(baseHM.h).padStart(2, "0")}:${String(
      baseHM.m
    ).padStart(2, "0")}:00.000Z`
  );
  const end = new Date(start.getTime() + (8 * 60 + driftMin) * 60000);
  return {
    date,
    sleep_start: start.toISOString(),
    sleep_end: end.toISOString(),
  };
}

/* ---------------- App ---------------- */

export default function App() {
  const [perm, setPerm] = React.useState<
    "granted" | "denied" | "undetermined"
  >("undetermined");
  const [nights, setNights] = React.useState<Night[]>([]);

  // nice background (no extra deps)
  const Bg = () => (
    <>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -120,
          right: -80,
          width: 320,
          height: 320,
          borderRadius: 160,
          backgroundColor: "#15324d",
          opacity: 0.6,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: -160,
          left: -120,
          width: 420,
          height: 420,
          borderRadius: 210,
          backgroundColor: "#1f2b5b",
          opacity: 0.55,
        }}
      />
    </>
  );

  React.useEffect(() => {
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      setPerm(status as any);
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      refresh();
    })();
  }, []);

  const derived = nights
    .map(derive)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const stats = summarize(derived);

  /* ----- actions ----- */

  const refresh = async () => {
    const raw = await readNightsRaw();
    setNights(raw);
  };

  const seed7 = async () => {
    const fake: Night[] = [
      makeFake(0, { h: 4, m: 30 }, 210),
      makeFake(1, { h: 4, m: 30 }, 180),
      makeFake(2, { h: 4, m: 30 }, 120),
      makeFake(3, { h: 4, m: 30 }, 90),
      makeFake(4, { h: 4, m: 30 }, 60),
      makeFake(5, { h: 4, m: 30 }, 30),
      makeFake(6, { h: 4, m: 30 }, 0),
    ];
    await writeNightsRaw(fake);
    await refresh();
  };

  const clear = async () => {
    await clearAll();
    await refresh();
  };

  const importCsv = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "text/csv" as any,
        copyToCacheDirectory: true,
      });

      if (res.canceled) {
        return;
      }

      const asset = res.assets && res.assets[0];
      if (!asset || !asset.uri) {
        Alert.alert("Import failed", "No file selected.");
        return;
      }

      const csv = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: "utf8",
      });

      const nightsFromCsv = parseCsvToNights(csv);
      await writeNightsRaw(nightsFromCsv);
      await refresh();

      Alert.alert(
        "Import complete",
        `Loaded ${nightsFromCsv.length} nights from CSV.`
      );
    } catch (err) {
      console.error(err);
      Alert.alert(
        "Import failed",
        err instanceof Error ? err.message : "Unknown error."
      );
    }
  };

  const fireNudgeNow = React.useCallback(async () => {
    const why = stats.drift ? "Bedtime drift detected" : "No drift tonight";
    await Notifications.scheduleNotificationAsync({
      content: {
        title: stats.drift ? "Heads up" : "No drift tonight",
        body: `${why}. Baseline ${fmtHM(stats.baselineMid)}`,
      },
      trigger: null, // immediate
    });
  }, [stats]);

  const scheduleTonight = React.useCallback(async () => {
    // schedule 60s from now, or customize here
    const target = new Date(Date.now() + 60 * 1000);
    const trigger: Notifications.DateTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: target,
    };
    await Notifications.scheduleNotificationAsync({
      content: {
        title: stats.drift ? "Bedtime nudge" : "No drift tonight",
        body: stats.drift
          ? "You are trending late tonight. Consider starting wind down."
          : "Looking steady. Nice work keeping a regular schedule.",
      },
      trigger,
    });
    Alert.alert(
      "Scheduled",
      `Nudge set for ${target.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}.`
    );
  }, [stats]);

  /* ----- render ----- */

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1220" }}>
      <Bg />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        style={{ flex: 1 }}
      >
        <H>
          Sleep Regularity{"\n"}Nudge
        </H>

        <Text style={{ color: "#cbd5e1", marginBottom: 16 }}>
          Notification permission:{" "}
          <Text style={{ fontWeight: "700", color: "#e5e7eb" }}>{perm}</Text>{" "}
          • Storage:{" "}
          <Text style={{ fontWeight: "700", color: "#e5e7eb" }}>
            {storageKind()}
          </Text>
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8 }}>
          <LinkButton title="Import CSV" onPress={importCsv} />
          <LinkButton title="Seed 7 fake nights" onPress={seed7} />
          <LinkButton title="Refresh" onPress={refresh} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 10 }}>
          <LinkButton title="Clear data" onPress={clear} tone="danger" />
        </View>

        <Card>
          <Text
            style={{
              color: "white",
              fontSize: 22,
              fontWeight: "800",
              marginBottom: 8,
            }}
          >
            Coverage last 7 days: {stats.coverage}/7
          </Text>
          <Text style={{ color: "white", fontSize: 18, marginBottom: 4 }}>
            Baseline midsleep:{" "}
            <Text style={{ fontWeight: "700" }}>{fmtHM(stats.baselineMid)}</Text>
          </Text>
          <Text style={{ color: "white", fontSize: 18, marginBottom: 4 }}>
            Recent lateness: ~{Math.abs(stats.recentLateness)} min
          </Text>
          <Text style={{ color: "white", fontSize: 18, marginBottom: 14 }}>
            Regularity loss: ~{Math.abs(stats.regularityLoss)} min
          </Text>

          <Text
            style={{
              color: "white",
              fontSize: 20,
              fontWeight: "800",
              marginBottom: 12,
            }}
          >
            Tonight risk: {stats.drift ? "HIGH (nudge would fire)" : "LOW"}
          </Text>

          <View style={{ marginBottom: 8 }}>
            <LinkButton title="Show nudge now (with why)" onPress={fireNudgeNow} />
          </View>
          <View style={{ marginBottom: 4 }}>
            <LinkButton title="Schedule tonight (+60s)" onPress={scheduleTonight} />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
