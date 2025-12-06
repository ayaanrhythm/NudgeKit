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

/* ---------------- constants ---------------- */

const BASELINE_WINDOW_DAYS = 7;
const DRIFT_THRESHOLD_MIN = 90; // 90+ min away from baseline = high risk

/* ---------------- UI helpers ---------------- */

const H = (props: { children: React.ReactNode }) => (
  <Text
    style={{
      color: "white",
      fontSize: 32,
      fontWeight: "800",
      marginBottom: 8,
    }}
  >
    {props.children}
  </Text>
);

const LinkButton: React.FC<{
  title: string;
  onPress: () => void | Promise<void>;
  tone?: "primary" | "danger";
}> = ({ title, onPress, tone = "primary" }) => (
  <TouchableOpacity
    onPress={() => void onPress()}
    activeOpacity={0.8}
    style={{ marginRight: 18, marginBottom: 16 }}
  >
    <Text
      style={{
        fontSize: 18,
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
      marginBottom: 16,
    }}
  >
    {children}
  </View>
);

/* ---------------- notifications ---------------- */

// Show notifications while app is foregrounded (for testing)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
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

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

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
  const lastN = derived.slice(0, BASELINE_WINDOW_DAYS);
  const coverage = lastN.length;

  const baselineMid =
    coverage > 0
      ? Math.floor(
          lastN.reduce((s, d) => s + d.midsleep_min_epoch, 0) / coverage
        )
      : null;

  const last = lastN[0];
  const recentLateness =
    baselineMid != null && last ? last.midsleep_min_epoch - baselineMid : 0;

  const regularityLoss =
    coverage > 1
      ? lastN
          .map((d) =>
            Math.abs(
              d.midsleep_min_epoch - (baselineMid ?? d.midsleep_min_epoch)
            )
          )
          .reduce((a, b) => a + b, 0)
      : 0;

  const drift =
    baselineMid != null && Math.abs(recentLateness) >= DRIFT_THRESHOLD_MIN;

  return {
    coverage,
    baselineMid,
    recentLateness,
    regularityLoss,
    drift,
  };
}

/* ---------------- CSV import helpers ---------------- */
/* CSV expected header (any order):
   date,sleep_start,sleep_end
   where sleep_start and sleep_end are ISO timestamps.
*/

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
      "CSV must have columns: date,sleep_start,sleep_end (any order)."
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

    if (!date || !sleep_start || !sleep_end) continue;

    nights.push({ date, sleep_start, sleep_end });
  }

  if (nights.length === 0) {
    throw new Error("No valid rows found in CSV.");
  }
  return nights;
}

/* ---------------- fake data helpers ---------------- */

function makeFake(
  dayOffset: number,
  baseHM = { h: 4, m: 30 },
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

// Create a synthetic night centered on a given midsleep with offset
function nightFromMidsleep(
  midsleepMinEpoch: number,
  offsetMinutes: number
): Night {
  const midsleep = new Date((midsleepMinEpoch + offsetMinutes) * 60000);
  const start = new Date(midsleep.getTime() - 4 * 60 * 60000);
  const end = new Date(midsleep.getTime() + 4 * 60 * 60000);
  const date = start.toISOString().slice(0, 10);
  return {
    date,
    sleep_start: start.toISOString(),
    sleep_end: end.toISOString(),
  };
}

/* ---------------- App ---------------- */

export default function App() {
  const [perm, setPerm] =
    React.useState<"granted" | "denied" | "undetermined">(
      "undetermined"
    );
  const [nights, setNights] = React.useState<Night[]>([]);

  // simple gradient-ish background
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
      await refresh();
    })();
  }, []);

  const derived: DerivedNight[] = nights
    .map(derive)
    .sort((a, b) => (a.sleep_start < b.sleep_start ? 1 : -1)); // most recent first

  const stats = summarize(derived);

  const riskLabel =
    stats.coverage < 3
      ? "Insufficient data (need ≥ 3 nights)"
      : stats.drift
      ? "HIGH (nudge would fire)"
      : "LOW";

  const riskColor =
    stats.coverage < 3
      ? "#e5e7eb"
      : stats.drift
      ? "#ff7a7a"
      : "#4ade80";

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
        type: "text/csv",
        copyToCacheDirectory: true,
      });

      if (res.canceled) return;

      const asset = res.assets && res.assets[0];
      if (!asset || !asset.uri) {
        Alert.alert("Import failed", "No file selected.");
        return;
      }

      const csv = await FileSystem.readAsStringAsync(asset.uri);
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

  const appendNight = async (night: Night) => {
    const updated = [...nights, night];
    await writeNightsRaw(updated);
    await refresh();
  };

  const logOnTrackNight = async () => {
    const mid =
      stats.baselineMid ??
      toMinutes(new Date()) + 4 * 60;
    const night = nightFromMidsleep(mid, 0);
    await appendNight(night);
  };

  const logLateNight = async () => {
    const mid =
      stats.baselineMid ??
      toMinutes(new Date()) + 4 * 60;
    const night = nightFromMidsleep(mid, 120); // 2 hours later
    await appendNight(night);
  };

  const fireNudgeNow = React.useCallback(async () => {
    if (stats.coverage < 3) {
      Alert.alert(
        "Not enough data",
        "We need at least 3 recent nights to decide whether to fire a nudge."
      );
      return;
    }
    if (Platform.OS === "web") {
      Alert.alert(
        "Notifications not available on web",
        "On phones this would appear as a push notification. Here we just show the content in the UI."
      );
      return;
    }
    const why = stats.drift ? "Bedtime drift detected" : "No drift tonight";
    await Notifications.scheduleNotificationAsync({
      content: {
        title: stats.drift ? "Heads up" : "No drift tonight",
        body: `${why}. Baseline ${fmtHM(stats.baselineMid)}.`,
      },
      trigger: null, // immediate
    });
  }, [stats]);

  const scheduleTonight = React.useCallback(async () => {
    if (stats.coverage < 3) {
      Alert.alert(
        "Not enough data",
        "We need at least 3 recent nights before scheduling a bedtime nudge."
      );
      return;
    }
    if (Platform.OS === "web") {
      Alert.alert(
        "Notifications not available on web",
        "For the real study this nudge would be scheduled on a phone."
      );
      return;
    }

    // fire ~60 seconds from now for demo
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
        <H>Sleep Regularity{"\n"}Nudge Kit</H>

        <Text style={{ color: "#cbd5e1", marginBottom: 6 }}>
          We use your last {BASELINE_WINDOW_DAYS} nights to compute a personal
          baseline midsleep. If tonight drifts more than{" "}
          {DRIFT_THRESHOLD_MIN} minutes from that baseline, we flag risk as HIGH
          and trigger a bedtime nudge.
        </Text>

        <Text style={{ color: "#cbd5e1", marginBottom: 16 }}>
          Notification permission:{" "}
          <Text style={{ fontWeight: "700", color: "#e5e7eb" }}>
            {perm}
          </Text>{" "}
          • Storage:{" "}
          <Text style={{ fontWeight: "700", color: "#e5e7eb" }}>
            {storageKind()}
          </Text>
        </Text>

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            marginBottom: 4,
          }}
        >
          <LinkButton title="Import CSV" onPress={importCsv} />
          <LinkButton title="Seed 7 fake nights" onPress={seed7} />
          <LinkButton title="Log on track night" onPress={logOnTrackNight} />
          <LinkButton title="Log late night" onPress={logLateNight} />
          <LinkButton title="Refresh" onPress={refresh} />
        </View>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          <LinkButton
            title="Clear data"
            onPress={clear}
            tone="danger"
          />
        </View>

        <Card>
          <Text
            style={{
              color: "white",
              fontSize: 20,
              fontWeight: "800",
              marginBottom: 8,
            }}
          >
            Coverage last {BASELINE_WINDOW_DAYS} days:{" "}
            {stats.coverage}/{BASELINE_WINDOW_DAYS}
          </Text>
          <Text
            style={{ color: "white", fontSize: 16, marginBottom: 4 }}
          >
            Baseline midsleep:{" "}
            <Text style={{ fontWeight: "700" }}>
              {fmtHM(stats.baselineMid)}
            </Text>
          </Text>
          <Text
            style={{ color: "white", fontSize: 16, marginBottom: 4 }}
          >
            Recent lateness (last night vs baseline): ~
            {Math.abs(stats.recentLateness)} min
          </Text>
          <Text
            style={{ color: "white", fontSize: 16, marginBottom: 14 }}
          >
            Regularity loss (sum deviation over window): ~
            {Math.abs(stats.regularityLoss)} min
          </Text>

          <Text
            style={{
              color: riskColor,
              fontSize: 18,
              fontWeight: "800",
              marginBottom: 12,
            }}
          >
            Tonight risk: {riskLabel}
          </Text>

          <View style={{ marginBottom: 8 }}>
            <LinkButton
              title="Show nudge now (with why)"
              onPress={fireNudgeNow}
            />
          </View>
          <View style={{ marginBottom: 4 }}>
            <LinkButton
              title="Schedule tonight (+60s)"
              onPress={scheduleTonight}
            />
          </View>
        </Card>

        {/* ---- history card ---- */}
        <Card pad={false}>
          <View style={{ padding: 16 }}>
            <Text
              style={{
                color: "white",
                fontSize: 18,
                fontWeight: "800",
                marginBottom: 8,
              }}
            >
              Recent nights
            </Text>
            <Text
              style={{ color: "#cbd5e1", marginBottom: 8, fontSize: 14 }}
            >
              Most recent at the top. Nights in the last{" "}
              {BASELINE_WINDOW_DAYS} days form the baseline window.
            </Text>
          </View>

          {derived.length === 0 ? (
            <View
              style={{ paddingHorizontal: 16, paddingBottom: 16 }}
            >
              <Text style={{ color: "#cbd5e1" }}>
                No nights yet. Import a CSV, seed fake data, or log a
                night to see history.
              </Text>
            </View>
          ) : (
            derived.slice(0, 21).map((n, idx) => {
              const isInBaseline = idx < BASELINE_WINDOW_DAYS;
              const lateVsBaseline =
                stats.baselineMid == null
                  ? false
                  : Math.abs(
                      n.midsleep_min_epoch - stats.baselineMid
                    ) >= DRIFT_THRESHOLD_MIN;

              const label =
                stats.baselineMid == null
                  ? "n/a"
                  : lateVsBaseline
                  ? "Late vs baseline"
                  : "On track";

              const color =
                stats.baselineMid == null
                  ? "#e5e7eb"
                  : lateVsBaseline
                  ? "#ff7a7a"
                  : "#4ade80";

              return (
                <View
                  key={n.date + n.sleep_start}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderTopWidth: 1,
                    borderTopColor: "rgba(255,255,255,0.06)",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <View>
                    <Text
                      style={{
                        color: "white",
                        fontWeight: "700",
                      }}
                    >
                      {fmtDate(n.sleep_start)}
                    </Text>
                    <Text
                      style={{
                        color: "#cbd5e1",
                        fontSize: 13,
                      }}
                    >
                      Bed {fmtClock(n.sleep_start)} · Wake{" "}
                      {fmtClock(n.sleep_end)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      style={{
                        color,
                        fontWeight: "700",
                        fontSize: 14,
                      }}
                    >
                      {label}
                    </Text>
                    {isInBaseline && (
                      <Text
                        style={{
                          color: "#94a3b8",
                          fontSize: 11,
                        }}
                      >
                        In baseline window
                      </Text>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
