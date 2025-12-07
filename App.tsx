import * as React from "react";
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
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

/* ---------------- mood types / constants ---------------- */

type MoodKey =
  | "bright"
  | "grateful"
  | "proud"
  | "excited"
  | "focused"
  | "calm"
  | "relaxed"
  | "okay"
  | "tired"
  | "drained"
  | "sad"
  | "anxious"
  | "stressed"
  | "lonely"
  | "angry"
  | "overwhelmed";

type MoodEntry = {
  id: string;
  mood: MoodKey;
  at: string; // ISO timestamp
};

type MoodMeta = {
  key: MoodKey;
  title: string;
  subtitle: string;
  color: string;
  glow: string;
};

const MOODS: MoodMeta[] = [
  {
    key: "bright",
    title: "Bright",
    subtitle: "Energized · Uplifted",
    color: "#facc15",
    glow: "rgba(234,179,8,0.35)",
  },
  {
    key: "grateful",
    title: "Grateful",
    subtitle: "Warm · Appreciative",
    color: "#f97316",
    glow: "rgba(249,115,22,0.35)",
  },
  {
    key: "proud",
    title: "Proud",
    subtitle: "Accomplished · Strong",
    color: "#fb7185",
    glow: "rgba(248,113,113,0.35)",
  },
  {
    key: "excited",
    title: "Excited",
    subtitle: "Buzzing · Anticipating",
    color: "#a855f7",
    glow: "rgba(168,85,247,0.35)",
  },
  {
    key: "focused",
    title: "Focused",
    subtitle: "Clear · Engaged",
    color: "#38bdf8",
    glow: "rgba(56,189,248,0.35)",
  },
  {
    key: "calm",
    title: "Calm",
    subtitle: "Steady · At ease",
    color: "#4ade80",
    glow: "rgba(74,222,128,0.35)",
  },
  {
    key: "relaxed",
    title: "Relaxed",
    subtitle: "Unwinding · Soft",
    color: "#22c55e",
    glow: "rgba(34,197,94,0.35)",
  },
  {
    key: "okay",
    title: "Okay",
    subtitle: "Neutral · Fine",
    color: "#93c5fd",
    glow: "rgba(147,197,253,0.35)",
  },
  {
    key: "tired",
    title: "Tired",
    subtitle: "Sleepy · Worn out",
    color: "#fbbf24",
    glow: "rgba(251,191,36,0.3)",
  },
  {
    key: "drained",
    title: "Drained",
    subtitle: "Low energy · Heavy",
    color: "#60a5fa",
    glow: "rgba(96,165,250,0.35)",
  },
  {
    key: "sad",
    title: "Sad",
    subtitle: "Low · Blue",
    color: "#6366f1",
    glow: "rgba(99,102,241,0.35)",
  },
  {
    key: "anxious",
    title: "Anxious",
    subtitle: "Jittery · Worried",
    color: "#f97373",
    glow: "rgba(248,113,113,0.4)",
  },
  {
    key: "stressed",
    title: "Stressed",
    subtitle: "Under pressure",
    color: "#f97316",
    glow: "rgba(249,115,22,0.4)",
  },
  {
    key: "lonely",
    title: "Lonely",
    subtitle: "Disconnected",
    color: "#a5b4fc",
    glow: "rgba(165,180,252,0.4)",
  },
  {
    key: "angry",
    title: "Angry",
    subtitle: "Irritated · Upset",
    color: "#ef4444",
    glow: "rgba(239,68,68,0.4)",
  },
  {
    key: "overwhelmed",
    title: "Overwhelmed",
    subtitle: "Too much at once",
    color: "#f97316",
    glow: "rgba(249,115,22,0.45)",
  },
];

/* ---------------- sleep constants ---------------- */

const SOOTHING_TRACK = require("./assets/nudgekitbackgroundmusic.mp3");
const BASELINE_WINDOW_DAYS = 7;
const DRIFT_THRESHOLD_MIN = 90; // 90+ min away from baseline = high risk
const DRIFT_THRESHOLD_HOURS = DRIFT_THRESHOLD_MIN / 60;

/* ---------------- UI helpers ---------------- */

const H = (props: { children: React.ReactNode }) => (
  <Text
    style={{
      color: "#e5e7eb",
      fontSize: 30,
      fontWeight: "800",
      marginBottom: 12,
      letterSpacing: 0.5,
      textAlign: "center",
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
  handleNotification: async () =>
    ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    } as any),
});

/* ---------------- tiny sleep helpers ---------------- */

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

const fmtMinutesAsHours = (m: number | null) => {
  if (m == null) return "n/a";
  const hours = m / 60;
  const absHours = Math.abs(hours);
  const rounded = Math.round(absHours * 10) / 10;
  return `${rounded.toFixed(1)} h`;
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
  const [lastNudgePreview, setLastNudgePreview] =
    React.useState<string | null>(null);
  const [activeNudge, setActiveNudge] = React.useState<{
    title: string;
    body: string;
  } | null>(null);

  // mood tracking state
  const [moodEntries, setMoodEntries] = React.useState<MoodEntry[]>([]);
  const [isMoodOverlayOpen, setIsMoodOverlayOpen] = React.useState(false);
  const [moodScreen, setMoodScreen] =
    React.useState<"picker" | "summary">("picker");

  // settings + background music state
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isMusicOn, setIsMusicOn] = React.useState(true); // default ON
  const [musicVolume, setMusicVolume] = React.useState(0.5);
  const musicSoundRef = React.useRef<Audio.Sound | null>(null);
  const hasKickstartedRef = React.useRef(false);

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

        try {
          // auto-play on mount (works on native, may be blocked on web)
          await sound.playAsync();
        } catch (err) {
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

  // react to isMusicOn / musicVolume changes
  React.useEffect(() => {
    const sound = musicSoundRef.current;
    if (!sound) return;

    (async () => {
      try {
        await sound.setVolumeAsync(musicVolume);

        const status = await sound.getStatusAsync();
        if (!status.isLoaded) {
          return;
        }

        const isPlaying = !!status.isPlaying;

        if (isMusicOn && !isPlaying) {
          await sound.playAsync();
        } else if (!isMusicOn && isPlaying) {
          await sound.pauseAsync();
        }
      } catch (e) {
        console.warn("Updating background audio failed:", e);
      }
    })();
  }, [isMusicOn, musicVolume]);

  // helper to force playback on first user interaction (for web autoplay blocks)
  const kickstartAudio = React.useCallback(async () => {
    const sound = musicSoundRef.current;
    if (!sound || hasKickstartedRef.current) return;

    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) return;
      await sound.playAsync();
      hasKickstartedRef.current = true;
    } catch (e) {
      console.warn("Kickstart audio failed:", e);
    }
  }, []);

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
      width: 1200,
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
    .sort((a, b) => b.midsleep_min_epoch - a.midsleep_min_epoch); // most recent first

  const stats = summarize(derived);

  const riskLabel =
    stats.coverage < 3
      ? "Insufficient data (need ≥ 3 nights)"
      : stats.drift
      ? "HIGH (nudge would fire)"
      : "LOW";

  const riskColor =
    stats.coverage < 3 ? "#e5e7eb" : stats.drift ? "#ff7a7a" : "#4ade80";

  /* ----- mood helpers ----- */

  const recordMood = (key: MoodKey) => {
    const entry: MoodEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      mood: key,
      at: new Date().toISOString(),
    };
    setMoodEntries((prev) => [entry, ...prev]);
    setMoodScreen("summary");
  };

  const moodCountsForWindow = (days: number): Record<MoodKey, number> => {
    const now = Date.now();
    const windowMs = days * 24 * 60 * 60 * 1000;
    const counts = {} as Record<MoodKey, number>;
    MOODS.forEach((m) => {
      counts[m.key] = 0;
    });

    moodEntries.forEach((m) => {
      const t = new Date(m.at).getTime();
      if (now - t <= windowMs) {
        counts[m.mood] = (counts[m.mood] || 0) + 1;
      }
    });

    return counts;
  };

  const weeklyCounts = moodCountsForWindow(7);
  const monthlyCounts = moodCountsForWindow(30);

  const maxWeekly =
    Math.max(
      1,
      ...MOODS.map((m) => weeklyCounts[m.key as MoodKey] || 0)
    ) || 1;
  const maxMonthly =
    Math.max(
      1,
      ...MOODS.map((m) => monthlyCounts[m.key as MoodKey] || 0)
    ) || 1;

  /* ----- sleep actions ----- */

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
    try {
      // clear the nights list in storage
      await writeNightsRaw([]);
      // and run the broader clear in case storage has other keys
      await clearAll();
    } finally {
      // reset local state so the UI empties
      setNights([]);
      setLastNudgePreview(null);
      setActiveNudge(null);
    }
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
    const night = nightFromMidsleep(mid + 3 * 60, 0); // 3 hours later
    await appendNight(night);
  };

  const fireNudgeNow = async () => {
    const enoughData = stats.coverage >= 3;
    const baselineDescription =
      stats.baselineMid != null
        ? fmtHM(stats.baselineMid)
        : "your usual sleep midpoint once we have a few nights logged";

    const title = enoughData
      ? stats.drift
        ? "Tonight looks later than usual"
        : "Nice job staying on track"
      : "Example bedtime nudge";

    const body = enoughData
      ? stats.drift
        ? `Your sleep midpoint tonight is drifting later than your usual midpoint at ${baselineDescription}. Try starting your wind down a bit earlier to protect your regular schedule.`
        : `You are staying close to your usual sleep midpoint at ${baselineDescription}. Keeping this pattern helps your body clock stay steady.`
      : "Once we have at least 3 recent nights, we will compare tonight to your usual sleep midpoint and send you this kind of nudge if you are drifting later.";

    // In-app preview (works everywhere, including web)
    setActiveNudge({ title, body });

    // Native notification only when on device, with permission, and enough data
    if (Platform.OS !== "web" && perm === "granted" && enoughData) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
        },
        trigger: null,
      });
    } else if (Platform.OS !== "web" && perm !== "granted") {
      Alert.alert(
        "Notifications disabled",
        "We cannot show a native notification because permission is not granted. The in-app nudge preview is still shown for demo."
      );
    }
  };

  // schedule a 1-minute demo notification
  const scheduleDemoNudge = async () => {
    const baselineDescription =
      stats.baselineMid != null
        ? fmtHM(stats.baselineMid)
        : "your usual sleep midpoint once we have more data";

    const now = new Date();
    const target = new Date(now.getTime() + 60 * 1000);

    const title = stats.drift
      ? "Bedtime nudge (demo)"
      : "Steady schedule (demo)";

    // Always show an immediate in-app explanation
    setActiveNudge({
      title,
      body:
        Platform.OS === "web"
          ? `We would send this bedtime nudge about a minute from now. In a real deployment it would go near your usual sleep midpoint at ${baselineDescription}.`
          : `We just scheduled a bedtime nudge for about a minute from now (around ${target.toLocaleTimeString(
              [],
              { hour: "2-digit", minute: "2-digit" }
            )}). In a real deployment it would go closer to your usual sleep midpoint at ${baselineDescription}.`,
    });

    if (Platform.OS === "web") {
      setLastNudgePreview(
        `Demo only: a bedtime nudge would be scheduled for about one minute from now, aligned with your usual midpoint at ${baselineDescription}.`
      );
      return;
    }

    if (perm !== "granted") {
      Alert.alert(
        "Notifications disabled",
        "We could not schedule a native notification because permission is not granted. The in-app preview above shows what it would look like."
      );
      return;
    }

    const trigger: Notifications.DateTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: target,
    };

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: stats.drift
          ? `You are trending later tonight compared with your usual midpoint at ${baselineDescription}. Consider starting your wind down a bit earlier.`
          : `You are staying close to your usual sleep midpoint at ${baselineDescription}. Keeping this pattern helps your body clock stay steady.`,
      },
      trigger,
    });

    Alert.alert(
      "Demo scheduled",
      `Bedtime nudge scheduled for ${target.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}.`
    );
  };

  /* ----- render ----- */

  const prettyPerm =
    perm ? perm.charAt(0).toUpperCase() + perm.slice(1) : "";

  const storageRaw = storageKind();
  const prettyStorage =
    storageRaw ? storageRaw.charAt(0).toUpperCase() + storageRaw.slice(1) : "";

  const recentLatenessMinutes =
    stats.coverage > 0 ? stats.recentLateness : null;
  const regularityLossMinutes =
    stats.coverage > 0 ? stats.regularityLoss : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1220" }}>
      <Bg />

      {/* Any tap in this area will try to kickstart audio (for web autoplay) */}
      <TouchableWithoutFeedback onPress={kickstartAudio}>
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: 80 }}
            style={{ flex: 1 }}
          >
            {/* Header with centered title + top-right settings icon */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <View style={{ flex: 1, alignItems: "center" }}>
                <H>
                  Sleep Regularity{"\n"}
                  <Text style={{ color: "#38bdf8" }}>Nudge Kit</Text>
                </H>
              </View>

              <View
                style={{
                  position: "absolute",
                  right: 0,
                  top: 6,
                  alignItems: "flex-end",
                }}
              >
                <TouchableOpacity
                  onPress={async () => {
                    await kickstartAudio();
                    setIsSettingsOpen((prev) => !prev);
                  }}
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

            {/* explanatory text */}
            <Text style={{ color: "#cbd5e1", marginBottom: 6 }}>
              We use your last {BASELINE_WINDOW_DAYS} nights to compute a
              personal baseline midsleep. If tonight drifts more than{" "}
              {DRIFT_THRESHOLD_HOURS.toFixed(1)} hours from that baseline, we
              flag risk as HIGH and trigger a bedtime nudge.
            </Text>

            <Text style={{ color: "#cbd5e1", marginBottom: 16 }}>
              Notification permission:{" "}
              <Text style={{ fontWeight: "700", color: "#e5e7eb" }}>
                {prettyPerm}
              </Text>{" "}
              • Storage:{" "}
              <Text style={{ fontWeight: "700", color: "#e5e7eb" }}>
                {prettyStorage}
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
              <LinkButton title="Seed demo nights" onPress={seed7} />
              <LinkButton title="Add on-time night" onPress={logOnTrackNight} />
              <LinkButton title="Add late night" onPress={logLateNight} />
            </View>
            <Text
              style={{
                color: "#94a3b8",
                marginBottom: 10,
                fontSize: 13,
              }}
            >
              The on-time and late buttons add synthetic nights. They are for
              demos so you can show how the nudge logic reacts without real
              tracker data.
            </Text>
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
                <Text style={{ fontWeight: "700" }}>
                  {fmtHM(stats.baselineMid)}
                </Text>
              </Text>
              <Text style={{ color: "white", fontSize: 16, marginBottom: 4 }}>
                Recent lateness (last night vs baseline): ~
                {fmtMinutesAsHours(recentLatenessMinutes)}
              </Text>
              <Text style={{ color: "white", fontSize: 16, marginBottom: 10 }}>
                Regularity loss (sum deviation over window): ~
                {fmtMinutesAsHours(regularityLossMinutes)}
              </Text>

              <View style={{ marginBottom: 10 }}>
                <Text
                  style={{
                    color: "#94a3b8",
                    fontSize: 13,
                    marginBottom: 2,
                  }}
                >
                  Baseline midsleep is the midpoint of your usual sleep over the
                  last {BASELINE_WINDOW_DAYS} nights.
                </Text>
                <Text
                  style={{
                    color: "#94a3b8",
                    fontSize: 13,
                    marginBottom: 2,
                  }}
                >
                  Recent lateness shows how many hours last night was away from
                  that midpoint.
                </Text>
                <Text
                  style={{
                    color: "#94a3b8",
                    fontSize: 13,
                  }}
                >
                  Regularity loss is the total number of hours all recent nights
                  have drifted away from your baseline.
                </Text>
              </View>

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
                  title="Preview tonight's nudge"
                  onPress={fireNudgeNow}
                />
              </View>
              <View style={{ marginBottom: 4 }}>
                <LinkButton
                  title="Schedule 1-min demo nudge"
                  onPress={scheduleDemoNudge}
                />
              </View>
              {lastNudgePreview && (
                <View
                  style={{
                    marginTop: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: "rgba(15,23,42,0.7)",
                    borderWidth: 1,
                    borderColor: "rgba(148,163,184,0.5)",
                  }}
                >
                  <Text style={{ color: "#e5e7eb", fontSize: 14 }}>
                    {lastNudgePreview}
                  </Text>
                </View>
              )}
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
                <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                  <Text style={{ color: "#cbd5e1" }}>
                    No nights yet. Import a CSV, seed demo data, or add a night
                    to see history.
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

          {/* Floating Check-in FAB */}
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              right: 24,
              bottom: 24,
            }}
          >
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                setMoodScreen("picker");
                setIsMoodOverlayOpen(true);
              }}
              style={{
                paddingHorizontal: 22,
                paddingVertical: 14,
                borderRadius: 999,
                backgroundColor: "#0ea5e9",
                flexDirection: "row",
                alignItems: "center",
                shadowColor: "#0ea5e9",
                shadowOpacity: 0.7,
                shadowRadius: 20,
                shadowOffset: { width: 0, height: 8 },
                borderWidth: 1,
                borderColor: "#38bdf8",
              }}
            >
              <Ionicons
                name="sparkles-outline"
                size={18}
                color="#e0f2fe"
                style={{ marginRight: 8 }}
              />
              <Text
                style={{
                  color: "#e0f2fe",
                  fontWeight: "800",
                  fontSize: 15,
                  letterSpacing: 0.3,
                }}
              >
                Check in
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>

      {/* Settings overlay */}
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
              style={{ alignSelf: "stretch", height: 32 }}
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

      {/* Mood check-in overlay (picker + summary) */}
      {isMoodOverlayOpen && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#020617",
            zIndex: 60,
          }}
        >
          <SafeAreaView style={{ flex: 1 }}>
            {/* top bar with summary/back + X */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingHorizontal: 18,
                paddingTop: 8,
              }}
            >
              <TouchableOpacity
                onPress={() =>
                  setMoodScreen((prev) =>
                    prev === "picker" ? "summary" : "picker"
                  )
                }
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "#38bdf8",
                  backgroundColor: "rgba(15,23,42,0.9)",
                }}
              >
                <Text
                  style={{
                    color: "#e5e7eb",
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  {moodScreen === "picker"
                    ? "Mood check-ins summary"
                    : "Back to check-in"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setIsMoodOverlayOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: "rgba(15,23,42,0.9)",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: "rgba(148,163,184,0.7)",
                }}
              >
                <Ionicons name="close" size={18} color="#e5e7eb" />
              </TouchableOpacity>
            </View>

            {moodScreen === "picker" ? (
              // ---- mood picker screen ----
              <View
                style={{
                  flex: 1,
                  paddingHorizontal: 24,
                  paddingBottom: 24,
                }}
              >
                <ScrollView
                  contentContainerStyle={{
                    alignItems: "center",
                    paddingVertical: 24,
                  }}
                >
                  <Text
                    style={{
                      color: "#e5e7eb",
                      fontSize: 18,
                      fontWeight: "700",
                      marginBottom: 6,
                      textAlign: "center",
                    }}
                  >
                    How are you feeling right now?
                  </Text>
                  <Text
                    style={{
                      color: "#94a3b8",
                      fontSize: 13,
                      marginBottom: 26,
                      textAlign: "center",
                    }}
                  >
                    Tap a bubble to log your mood. We will track your weekly and
                    monthly patterns.
                  </Text>

                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      justifyContent: "center",
                    }}
                  >
                    {MOODS.map((m) => (
                      <TouchableOpacity
                        key={m.key}
                        onPress={() => recordMood(m.key)}
                        activeOpacity={0.9}
                        style={{
                          width: 120,
                          height: 120,
                          borderRadius: 60,
                          margin: 9,
                          alignItems: "center",
                          justifyContent: "center",
                          shadowColor: m.color,
                          shadowOpacity: 0.7,
                          shadowRadius: 18,
                          shadowOffset: { width: 0, height: 8 },
                          backgroundColor: m.glow,
                        }}
                      >
                        <View
                          style={{
                            width: 108,
                            height: 108,
                            borderRadius: 54,
                            backgroundColor: "#020617",
                            borderWidth: 2,
                            borderColor: m.color,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text
                            style={{
                              color: "#e5e7eb",
                              fontSize: 14,
                              fontWeight: "700",
                              marginBottom: 4,
                              textAlign: "center",
                            }}
                          >
                            {m.title}
                          </Text>
                          <Text
                            style={{
                              color: "#cbd5e1",
                              fontSize: 10,
                              textAlign: "center",
                            }}
                          >
                            {m.subtitle}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : (
              // ---- mood summary screen ----
              <View
                style={{
                  flex: 1,
                  paddingHorizontal: 24,
                  paddingBottom: 24,
                }}
              >
                <ScrollView
                  contentContainerStyle={{
                    paddingVertical: 24,
                  }}
                >
                  <Text
                    style={{
                      color: "#e5e7eb",
                      fontSize: 18,
                      fontWeight: "700",
                      marginBottom: 6,
                      textAlign: "center",
                    }}
                  >
                    Mood summary
                  </Text>
                  <Text
                    style={{
                      color: "#94a3b8",
                      fontSize: 13,
                      marginBottom: 20,
                      textAlign: "center",
                    }}
                  >
                    Based on your recent check-ins.
                  </Text>

                  {moodEntries.length === 0 ? (
                    <Text
                      style={{
                        color: "#cbd5e1",
                        fontSize: 14,
                        textAlign: "center",
                      }}
                    >
                      No check-ins yet. Go back and log how you feel to see your
                      weekly and monthly mood patterns.
                    </Text>
                  ) : (
                    <>
                      <Text
                        style={{
                          color: "#94a3b8",
                          fontSize: 13,
                          marginBottom: 8,
                        }}
                      >
                        This week
                      </Text>
                      {MOODS.map((m) => {
                        const count = weeklyCounts[m.key];
                        const widthPct = (count / maxWeekly) * 100 || 0;
                        return (
                          <View
                            key={`week-${m.key}`}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              marginBottom: 6,
                            }}
                          >
                            <View
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 5,
                                backgroundColor: m.color,
                                marginRight: 8,
                              }}
                            />
                            <Text
                              style={{
                                color: "#e5e7eb",
                                fontSize: 13,
                                width: 120,
                              }}
                            >
                              {m.title}
                            </Text>
                            <View
                              style={{
                                flex: 1,
                                height: 9,
                                borderRadius: 999,
                                backgroundColor: "#020617",
                                overflow: "hidden",
                                marginHorizontal: 8,
                              }}
                            >
                              <View
                                style={{
                                  width: `${widthPct}%`,
                                  height: "100%",
                                  backgroundColor: m.color,
                                  opacity: 0.9,
                                }}
                              />
                            </View>
                            <Text
                              style={{
                                color: "#e5e7eb",
                                fontSize: 12,
                              }}
                            >
                              {count}
                            </Text>
                          </View>
                        );
                      })}

                      <View style={{ height: 18 }} />

                      <Text
                        style={{
                          color: "#94a3b8",
                          fontSize: 13,
                          marginBottom: 8,
                        }}
                      >
                        This month
                      </Text>
                      {MOODS.map((m) => {
                        const count = monthlyCounts[m.key];
                        const widthPct = (count / maxMonthly) * 100 || 0;
                        return (
                          <View
                            key={`month-${m.key}`}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              marginBottom: 6,
                            }}
                          >
                            <View
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 5,
                                backgroundColor: m.color,
                                marginRight: 8,
                              }}
                            />
                            <Text
                              style={{
                                color: "#e5e7eb",
                                fontSize: 13,
                                width: 120,
                              }}
                            >
                              {m.title}
                            </Text>
                            <View
                              style={{
                                flex: 1,
                                height: 9,
                                borderRadius: 999,
                                backgroundColor: "#020617",
                                overflow: "hidden",
                                marginHorizontal: 8,
                              }}
                            >
                              <View
                                style={{
                                  width: `${widthPct}%`,
                                  height: "100%",
                                  backgroundColor: m.color,
                                  opacity: 0.9,
                                }}
                              />
                            </View>
                            <Text
                              style={{
                                color: "#e5e7eb",
                                fontSize: 12,
                              }}
                            >
                              {count}
                            </Text>
                          </View>
                        );
                      })}
                    </>
                  )}
                </ScrollView>
              </View>
            )}
          </SafeAreaView>
        </View>
      )}

      {/* Nudge overlay card (for web and demo) */}
      {activeNudge && (
        <View
          style={{
            position: "absolute",
            top: 40,
            left: 20,
            right: 20,
            zIndex: 70,
          }}
        >
          <View
            style={{
              borderRadius: 18,
              padding: 16,
              backgroundColor: "#020617",
              borderWidth: 1,
              borderColor: stats.drift ? "#f97373" : "#22c55e",
              shadowColor: "#000",
              shadowOpacity: 0.8,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 10 },
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <Text
                style={{
                  color: "#e5e7eb",
                  fontSize: 16,
                  fontWeight: "700",
                  flex: 1,
                  marginRight: 8,
                }}
              >
                {activeNudge.title}
              </Text>
              <TouchableOpacity
                onPress={() => setActiveNudge(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={18} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <Text
              style={{
                color: "#cbd5e1",
                fontSize: 14,
                marginTop: 8,
              }}
            >
              {activeNudge.body}
            </Text>
            <Text
              style={{
                color: "#64748b",
                fontSize: 12,
                marginTop: 10,
              }}
            >
              This is a preview of the push notification we would send near your
              bedtime. On phones it appears as a native notification.
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
