// App.tsx (memory-only, stable demo build)
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { Svg, Polyline, Line, Circle } from "react-native-svg";

// ---------- Types ----------
type Night = {
  date: string;           // YYYY-MM-DD
  sleep_start: string;    // ISO
  sleep_end: string;      // ISO (usually next day)
};

type DerivedNight = Night & {
  duration_min: number;
  midsleep_min_epoch: number; // minutes since epoch
};

// ---------- Notifications visible while app is open ----------
Notifications.setNotificationHandler({
  handleNotification: async (): Promise<Notifications.NotificationBehavior> => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const DEBUG_FAST_SCHEDULE = true; // +60s for demo

export default function App() {
  const [perm, setPerm] = useState<"granted" | "denied" | "undetermined">(
    "undetermined",
  );

  // MEMORY ONLY for demo reliability
  const [nights, setNights] = useState<Night[]>([]);

  useEffect(() => {
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      setPerm(status as any);
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
    })();
  }, []);

  // ---------- Helpers ----------
  const derive = (n: Night): DerivedNight => {
    const start = new Date(n.sleep_start);
    const end = new Date(n.sleep_end);
    const durMin = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    const midMs = start.getTime() + (durMin * 60000) / 2;
    return {
      ...n,
      duration_min: durMin,
      midsleep_min_epoch: Math.round(midMs / 60000),
    };
  };

  const last7Derived = useMemo(() => {
    const sorted = nights.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7).reverse();
    return sorted.map(derive);
  }, [nights]);

  const stats = useMemo(() => computeStats(last7Derived), [last7Derived]);

  function minsToClock(mins: number) {
    const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    const d = new Date(0);
    d.setHours(hh, mm, 0, 0);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function computeStats(ds: DerivedNight[]) {
    const coverage = ds.length;
    if (!coverage) {
      return {
        coverage: 0,
        baselineMin: null as number | null,
        latenessMin: 0,
        regLossMin: 0,
        drift: false,
        why: ["No data"],
        deviations: [] as number[],
      };
    }
    const mids = ds.map((d) => d.midsleep_min_epoch);
    const baselineMin = Math.round(mids.reduce((a, b) => a + b, 0) / mids.length);
    const deviations = mids.map((m) => m - baselineMin);
    const latenessMin = deviations[deviations.length - 1] ?? 0;

    let regLossMin = 0;
    for (let i = 1; i < mids.length; i++) regLossMin += Math.abs(mids[i] - mids[i - 1]);

    const drift = latenessMin >= 60;
    const why = [
      `Baseline midsleep: ${minsToClock(baselineMin % (24 * 60))}`,
      `Latest midsleep: ${minsToClock(mids[mids.length - 1] % (24 * 60))}`,
      `Lateness: ~${Math.round(latenessMin)} min`,
    ];

    return { coverage, baselineMin, latenessMin, regLossMin, drift, why, deviations };
  }

  function fmtClock(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // ---------- Actions ----------
  const seed7 = async () => {
    const today = new Date();
    const out: Night[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setHours(0, 50, 0, 0);
      d.setDate(d.getDate() - i);
      d.setMinutes(d.getMinutes() + (6 - i) * 20); // steadily later
      const start = new Date(d);
      const end = new Date(start);
      end.setHours(end.getHours() + 7);
      end.setMinutes(end.getMinutes() + 30);
      out.push({
        date: start.toISOString().slice(0, 10),
        sleep_start: start.toISOString(),
        sleep_end: end.toISOString(),
      });
    }
    setNights(out);
    Alert.alert("Seed", "Fake 7 nights added.");
  };

  const clearAll = async () => {
    setNights([]);
  };

  const addManual = async () => {
    const d = new Date();
    d.setHours(0, 45, 0, 0);
    const start = d;
    const end = new Date(start);
    end.setHours(end.getHours() + 7);
    end.setMinutes(end.getMinutes() + 30);
    setNights((prev) => {
      const filtered = prev.filter((x) => x.date !== start.toISOString().slice(0, 10));
      return [
        ...filtered,
        {
          date: start.toISOString().slice(0, 10),
          sleep_start: start.toISOString(),
          sleep_end: end.toISOString(),
        },
      ].sort((a, b) => (a.date < b.date ? 1 : -1));
    });
    Alert.alert("Manual", "1 night added.");
  };

  const onImportCSV = async () => {
    const pick = await DocumentPicker.getDocumentAsync({
      type: ["text/csv", "text/plain", "application/vnd.ms-excel"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (pick.canceled || !pick.assets?.[0]?.uri) return;
    try {
      const txt = await FileSystem.readAsStringAsync(pick.assets[0].uri); // UTF-8 default
      const imported = parseCSV(txt);
      if (!imported.length) {
        return Alert.alert("Import", "Couldn’t find usable columns. Expect date, start, end.");
      }
      // merge by date
      setNights((prev) => {
        const map = new Map<string, Night>();
        for (const n of prev) map.set(n.date, n);
        for (const n of imported) map.set(n.date, n);
        return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
      });
      Alert.alert("Import", `Added ${imported.length} night(s).`);
    } catch (e) {
      Alert.alert("Import failed", String(e));
    }
  };

  const fireNudgeNow = async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: stats.drift ? "Bedtime drift detected" : "No drift tonight",
        body: stats.why.join(" • "),
      },
      trigger: null, // immediate
    });
  };

  const scheduleForTonight = async () => {
    if (!stats.drift) return Alert.alert("No drift", "Risk is LOW tonight, nothing scheduled.");
    const now = new Date();
    const target = new Date(now);
    if (DEBUG_FAST_SCHEDULE) {
      target.setSeconds(target.getSeconds() + 60);
    } else {
      target.setHours(21, 45, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Sleep Regularity Nudge",
        body: `Possible drift: ~${Math.round(stats.latenessMin)} min later than baseline.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: target },
    });
    Alert.alert(
      "Scheduled",
      `Nudge set for ${target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
    );
  };

  // ---------- UI ----------
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Sleep Regularity Nudge</Text>
      <Text style={styles.subtle}>Notification permission: {perm ?? "unknown"} • Storage: memory</Text>

      <View style={styles.row}><Button title="Seed 7 fake nights" onPress={seed7} /></View>
      <View style={styles.row}><Button title="Refresh" onPress={() => { /* memory: no-op */ }} /></View>
      <View style={styles.row}><Button color="#b23939" title="Clear data" onPress={clearAll} /></View>
      <View style={styles.row}><Button title="Add night (manual)" onPress={addManual} /></View>
      <View style={styles.row}><Button title="Import CSV (wearable)" onPress={onImportCSV} /></View>

      <View style={styles.card}>
        <Text style={styles.metric}>Coverage last 7 days: <Text style={styles.bold}>{stats.coverage}/7</Text></Text>
        <Text style={styles.metric}>
          Baseline midsleep: <Text style={styles.bold}>
            {stats.baselineMin == null ? "n/a" : minsToClock(stats.baselineMin % (24 * 60))}
          </Text>
        </Text>
        <Text style={styles.metric}>Recent lateness: <Text style={styles.bold}>~{Math.round(stats.latenessMin)} min</Text></Text>
        <Text style={styles.metric}>Regularity loss: <Text style={styles.bold}>~{Math.round(stats.regLossMin)} min</Text></Text>

        <Sparkline deviations={stats.deviations} />

        <Text style={[styles.metric, styles.topPad]}>
          Tonight risk: <Text style={styles.bold}>{stats.drift ? "HIGH (nudge would fire)" : "LOW"}</Text>
        </Text>

        <View style={styles.rowTight}><Button title="Show nudge now (with why)" onPress={fireNudgeNow} /></View>
        <View style={styles.rowTight}>
          <Button title={`Schedule tonight (${DEBUG_FAST_SCHEDULE ? "+60s" : "9:45"})`} onPress={scheduleForTonight} />
        </View>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Recent nights</Text>
      {last7Derived.slice().reverse().map((n) => (
        <View key={n.date} style={styles.nightRow}>
          <Text style={styles.nightDate}>{n.date}</Text>
          <Text style={styles.nightLine}>Start {fmtClock(n.sleep_start)}, End {fmtClock(n.sleep_end)}</Text>
          <Text style={styles.nightLine}>Duration {n.duration_min} min • Midsleep {minsToClock(n.midsleep_min_epoch % (24 * 60))}</Text>
          <View style={styles.rule} />
        </View>
      ))}
    </ScrollView>
  );
}

// ---------- CSV helpers ----------
function parseCSV(txt: string): Night[] {
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const split = (s: string) => s.split(/,|;|\t/).map((x) => x.trim());
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const iDate = header.findIndex((h) => /date/.test(h));
  const iStart = header.findIndex((h) => /(start|bed|sleep.*start)/.test(h));
  const iEnd = header.findIndex((h) => /(end|wake|sleep.*end)/.test(h));
  if (iDate < 0 || iStart < 0 || iEnd < 0) return [];

  const out: Night[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const date = cells[iDate];
    const st = cells[iStart];
    const en = cells[iEnd];
    if (!date || !st || !en) continue;

    const startIso = toIso(date, st);
    let endIso = toIso(date, en);
    if (new Date(endIso) <= new Date(startIso)) {
      const d = new Date(endIso);
      d.setDate(d.getDate() + 1);
      endIso = d.toISOString();
    }
    out.push({ date, sleep_start: startIso, sleep_end: endIso });
  }
  return out;
}

function toIso(dateYYYYMMDD: string, timeStr: string): string {
  const t = timeStr.trim();
  const m = t.match(/^(\d{1,2}):?(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  let hh = 0, mm = 0, ss = 0;
  if (m) {
    hh = parseInt(m[1], 10);
    mm = parseInt(m[2], 10);
    ss = m[3] ? parseInt(m[3], 10) : 0;
    const ap = m[4]?.toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
  }
  const d = new Date(`${dateYYYYMMDD}T00:00:00`);
  d.setHours(hh, mm, ss, 0);
  return d.toISOString();
}

// ---------- Sparkline ----------
function Sparkline({ deviations }: { deviations: number[] }) {
  const w = 340, h = 90;
  if (!deviations.length) {
    return <Text style={{ marginTop: 12, color: "#777" }}>No trend yet, import or add nights.</Text>;
  }
  const minV = Math.min(0, ...deviations);
  const maxV = Math.max(0, ...deviations);
  const span = Math.max(1, maxV - minV);
  const xStep = deviations.length > 1 ? (w - 20) / (deviations.length - 1) : w - 20;
  const yOf = (v: number) => h / 2 - ((v - (minV + span / 2)) / span) * (h - 20);
  const points = deviations.map((v, i) => `${10 + i * xStep},${yOf(v).toFixed(1)}`).join(" ");
  return (
    <View style={{ marginTop: 12, alignItems: "center" }}>
      <Svg width={w} height={h}>
        <Line x1={10} x2={w - 10} y1={yOf(0)} y2={yOf(0)} stroke="#9aa0a6" strokeDasharray="4 6" strokeWidth={1} />
        <Polyline points={points} stroke="#1b73e8" strokeWidth={3} fill="none" />
        <Circle cx={10 + (deviations.length - 1) * xStep} cy={yOf(deviations[deviations.length - 1])} r={4} fill="#1b73e8" />
      </Svg>
      <Text style={{ color: "#666", marginTop: 4, fontSize: 12 }}>Deviation from baseline midsleep (minutes)</Text>
    </View>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0b0b" },
  container: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: "800", color: "white", marginBottom: 4 },
  subtle: { color: "#c8c8c8", marginBottom: 16 },
  row: { marginVertical: 6 },
  rowTight: { marginTop: 8 },
  card: { backgroundColor: "white", borderRadius: 12, padding: 14, marginTop: 12 },
  metric: { fontSize: 16, marginBottom: 6, color: "#0b0b0b" },
  bold: { fontWeight: "800" },
  topPad: { marginTop: 6 },
  sectionTitle: { color: "white", fontSize: 20, fontWeight: "700" },
  nightRow: { paddingVertical: 10 },
  nightDate: { color: "white", fontWeight: "700", fontSize: 16 },
  nightLine: { color: "white", opacity: 0.9, marginTop: 2 },
  rule: { borderBottomColor: "rgba(255,255,255,0.15)", borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 8 },
});
