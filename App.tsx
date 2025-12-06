import * as React from "react";
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  Animated,
} from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { Audio } from "expo-av";

import {
  Night,
  DerivedNight,
  readRaw as readNightsRaw,
  writeRaw as writeNightsRaw,
  clearAll,
  storageKind,
} from "./storage";

/* ---------------- constants ---------------- */

const SOOTHING_TRACK = require("./assets/nudgekitbackgroundmusic.mp3");
const BASELINE_WINDOW_DAYS = 7;
const DRIFT_THRESHOLD_MIN = 90; // 90+ min away from baseline = high risk

/* ---------------- UI helpers ---------------- */

const H = (props: { children: React.ReactNode }) => (
  <Text
    style={{
      color: "#e5e7eb",
      fontSize: 30,
      fontWeight: "800",
      marginBottom: 12,
      letterSpacing: 0.5,
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
    activeOpacity={0.85}
    style={{
      marginRight: 12,
      marginBottom: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor:
        tone === "danger" ? "rgba(248,113,113,0.18)" : "rgba(59,130,246,0.22)",
      borderWidth: 1,
      borderColor:
        tone === "danger" ? "rgba(248,113,113,0.9)" : "rgba(59,130,246,0.9)",
      shadowColor: "#000",
      shadowOpacity: 0.45,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <Text
      style={{
        fontSize: 15,
        fontWeight: "700",
        color: "#e5e7eb",
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
      backgroundColor: "rgba(15,23,42,0.9)",
      borderRadius: 20,
      padding: pad ? 18 : 0,
      borderWidth: 1,
      borderColor: "rgba(148,163,184,0.3)",
      marginBottom: 18,
      shadowColor: "#000",
      shadowOpacity: 0.55,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 12 },
    }}
  >
    {children}
  </View>
);

/* ---------------- notifications ---------------- */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true as any,
    shouldShowList: true as any,
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
    React.useState<"granted" | "denied" | "undetermined">("undetermined");
  const [nights, setNights] = React.useState<Night[]>([]);

  // settings + background music state
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isMusicOn, setIsMusicOn] = React.useState(true); // default ON
  const [musicVolume, setMusicVolume] = React.useState(0.5);
  const musicSoundRef = React.useRef<Audio.Sound | null>(null);

  // load background music once, auto-play by default
  React.useEffect(() => {
    let isMounted = true;

    const loadSound = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });

        const { sound } = await Audio.Sound.createAsync(SOOTHING_TRACK, {
          volume: musicVolume,
          isLooping: true,
        });

        if (!isMounted) {
          await sound.unloadAsync();
          return;
        }

        musicSoundRef.current = sound;

        // always try to play on mount
        try {
          await sound.playAsync();
        } catch (err) {
          // On web, this can fail due to autoplay policy.
          console.warn("Autoplay failed (likely browser policy):", err);
        }
      } catch (e) {
        console.warn("Error loading background sound", e);
      }
    };

    loadSound();

    return () => {
      isMounted = false;
      if (musicSoundRef.current) {
        musicSoundRef.current.unloadAsync();
        musicSoundRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // react to mute / volume changes
  React.useEffect(() => {
    const sound = musicSoundRef.current;
    if (!sound) return;

    (async () => {
      try {
        await sound.setVolumeAsync(musicVolume);
        const status = await sound.getStatusAsync();
        if (!status.isLoaded) return;

        if (isMusicOn && !status.isPlaying) {
          await sound.playAsync();
        } else if (!isMusicOn && status.isPlaying) {
          await sound.pauseAsync();
        }
      } catch (e) {
        console.warn("Error updating background sound", e);
      }
    })();
  }, [isMusicOn, musicVolume]);

  // animated, subtle moving background
  const Bg: React.FC = () => {
    const animation = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
      animation.setValue(0);
      Animated.loop(
        Animated.timing(animation, {
          toValue: 1,
          duration: 18000,
          useNativeDriver: true,
        })
      ).start();
    }, [animation]);

    const translateFast = animation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -200],
    });

    const translateSlow = animation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -120],
    });

    const baseLineStyle = {
      position: "absolute" as const,
      width: "220%",
      height: 1,
      backgroundColor: "rgba(248,250,252,0.12)",
    } as const;

    return (
      <>
        {/* soft colorful blobs */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -140,
            right: -120,
            width: 320,
            height: 320,
            borderRadius: 160,
            backgroundColor: "#1d4ed8",
            opacity: 0.45,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: -160,
            left: -120,
            width: 360,
            height: 360,
            borderRadius: 180,
            backgroundColor: "#22c55e",
            opacity: 0.35,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 80,
            right: -60,
            width: 260,
            height: 260,
            borderRadius: 130,
            backgroundColor: "#6366f1",
            opacity: 0.35,
          }}
        />

        {/* animated white lines */}
        <Animated.View
          pointerEvents="none"
          style={[
            baseLineStyle,
            {
              top: 100,
              left: -80,
              opacity: 0.35,
              transform: [{ translateX: translateFast }, { rotate: "-16deg" }],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            baseLineStyle,
            {
              top: 180,
              left: -40,
              opacity: 0.25,
              transform: [{ translateX: translateSlow }, { rotate: "-12deg" }],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            baseLineStyle,
            {
              top: 260,
              left: -100,
              opacity: 0.18,
              transform: [{ translateX: translateFast }, { rotate: "-20deg" }],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            baseLineStyle,
            {
              top: 340,
              left: -60,
              opacity: 0.22,
              transform: [{ translateX: translateSlow }, { rotate: "-10deg" }],
            },
          ]}
        />
      </>
    );
  };

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
    const mid = stats.baselineMid ?? toMinutes(new Date()) + 4 * 60;
    const night = nightFromMidsleep(mid, 0);
    await appendNight(night);
  };

  const logLateNight = async () => {
    const mid = stats.baselineMid ?? toMinutes(new Date()) + 4 * 60;
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
      trigger: null,
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
        {/* Header with title + top-right settings icon */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 10,
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <H>
              Sleep Regularity{"\n"}
              <Text style={{ color: "#38bdf8" }}>Nudge Kit</Text>
            </H>
          </View>

          <View style={{ position: "relative", alignItems: "flex-end" }}>
            <TouchableOpacity
              onPress={() => setIsSettingsOpen((prev) => !prev)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: "rgba(15,23,42,0.95)",
                borderWidth: 1,
                borderColor: "rgba(148,163,184,0.6)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="settings-outline" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={{ color: "#cbd5e1", marginBottom: 6 }}>
          We use your last {BASELINE_WINDOW_DAYS} nights to compute a personal
          baseline midsleep. If tonight drifts more than {DRIFT_THRESHOLD_MIN}{" "}
          minutes from that baseline, we flag risk as HIGH and trigger a
          bedtime nudge.
        </Text>

        <Text style={{ color: "#cbd5e1", marginBottom: 16 }}>
          Notification permission:{" "}
          <Text style={{ fontWeight: "700", color: "#e5e7eb" }}>{perm}</Text> •
          Storage:{" "}
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
          <LinkButton title="Clear data" onPress={clear} tone="danger" />
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
          <Text style={{ color: "white", fontSize: 16, marginBottom: 4 }}>
            Baseline midsleep:{" "}
            <Text style={{ fontWeight: "700" }}>{fmtHM(stats.baselineMid)}</Text>
          </Text>
          <Text style={{ color: "white", fontSize: 16, marginBottom: 4 }}>
            Recent lateness (last night vs baseline): ~
            {Math.abs(stats.recentLateness)} min
          </Text>
          <Text style={{ color: "white", fontSize: 16, marginBottom: 14 }}>
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
            <LinkButton title="Show nudge now (with why)" onPress={fireNudgeNow} />
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
            <Text style={{ color: "#cbd5e1", marginBottom: 8, fontSize: 14 }}>
              Most recent at the top. Nights in the last {BASELINE_WINDOW_DAYS}{" "}
              days form the baseline window.
            </Text>
          </View>

          {derived.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              <Text style={{ color: "#cbd5e1" }}>
                No nights yet. Import a CSV, seed fake data, or log a night to
                see history.
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

      {isSettingsOpen && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 50,
          }}
        >
          {/* dim background that also closes on tap */}
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setIsSettingsOpen(false)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15,23,42,0.85)",
            }}
          />

          {/* small window under the gear */}
          <View
            style={{
              position: "absolute",
              top: 70,
              right: 20,
              width: 280,
              backgroundColor: "#020617",
              borderRadius: 18,
              padding: 14,
              borderWidth: 1,
              borderColor: "rgba(148,163,184,0.9)",
              shadowColor: "#000",
              shadowOpacity: 0.8,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 10 },
            }}
          >
            {/* header row */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <Text
                style={{
                  color: "#e5e7eb",
                  fontSize: 16,
                  fontWeight: "700",
                }}
              >
                Settings
              </Text>
              <TouchableOpacity
                onPress={() => setIsSettingsOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={18} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <Text
              style={{
                color: "#e5e7eb",
                fontSize: 14,
                fontWeight: "600",
                marginBottom: 4,
              }}
            >
              Background music
            </Text>
            <Text
              style={{
                color: "#94a3b8",
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              Soothing audio plays by default. Adjust the volume or pause it
              here.
            </Text>

            {/* Play / pause */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <TouchableOpacity
                onPress={() => setIsMusicOn((prev) => !prev)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: isMusicOn
                    ? "rgba(34,197,94,0.28)"
                    : "rgba(148,163,184,0.35)",
                  marginRight: 10,
                }}
              >
                <Text
                  style={{
                    color: "#e5e7eb",
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  {isMusicOn ? "Pause" : "Play"}
                </Text>
              </TouchableOpacity>
              <Text style={{ color: "#cbd5e1", fontSize: 12 }}>
                {isMusicOn ? "Playing" : "Muted"}
              </Text>
            </View>

            {/* Volume label + slider */}
            <Text
              style={{
                color: "#e5e7eb",
                fontSize: 13,
                marginBottom: 6,
                fontWeight: "600",
              }}
            >
              Volume
            </Text>

            <Slider
              style={{ width: "100%", height: 32 }}
              minimumValue={0}
              maximumValue={1}
              value={musicVolume}
              onValueChange={(value: number) => {
                setMusicVolume(value);
                setIsMusicOn(value > 0);
              }}
              minimumTrackTintColor="#38bdf8"
              maximumTrackTintColor="#4b5563"
              thumbTintColor="#e5e7eb"
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
