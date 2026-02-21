import * as React from "react";
import {
  View,
  Image,
  ActivityIndicator,
  Dimensions,
  Text as RNText,
  Animated,
  PanResponder,
  Pressable,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RootStackParamList } from "../../App";
import { addToTrash, getTrashSet, removeFromTrash } from "../trashStore";

type Props = NativeStackScreenProps<RootStackParamList, "GallerySwipe">;

const HISTORY_LIMIT = 5;

// Queue/paging knobs
const PAGE_SIZE = 80; // how many we fetch per API call
const MIN_QUEUE_BEFORE_REFILL = 20; // when queue gets low, fetch more
const MAX_QUEUE_PERSIST = 120; // how many upcoming URIs we persist (keep small)

// Storage keys
const KEY_POS = "gallery_progress_global_pos_v1"; // number processed so far (0-based)
const KEY_QUEUE = "gallery_progress_queue_v1"; // upcoming URIs
const KEY_AFTER = "gallery_progress_after_cursor_v1"; // end_cursor to fetch next
const KEY_TOTAL = "gallery_total_photos_cached_v1"; // cached total
const KEY_TOTAL_TS = "gallery_total_photos_cached_ts_v1"; // ms timestamp

type Action =
  | { kind: "skip"; uri: string }
  | { kind: "trash"; uri: string };

async function getNumber(key: string, fallback = 0): Promise<number> {
  const v = await AsyncStorage.getItem(key);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function setNumber(key: string, n: number) {
  await AsyncStorage.setItem(key, String(n));
}

async function getString(key: string): Promise<string | null> {
  const v = await AsyncStorage.getItem(key);
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function setString(key: string, v: string | null) {
  if (!v) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, v);
}

async function getStringArray(key: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

async function setStringArray(key: string, arr: string[]) {
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

/**
 * Expensive total-count pass (cursor pagination).
 * We run it optionally and cache the result.
 */
async function countAllPhotos(): Promise<number> {
  let total = 0;
  let after: string | undefined = undefined;

  // Big page size reduces calls; adjust if you hit memory/time issues.
  const COUNT_PAGE_SIZE = 1000;

  while (true) {
    const res = await CameraRoll.getPhotos({
      first: COUNT_PAGE_SIZE,
      assetType: "Photos",
      after,
    });

    total += res.edges.length;

    if (!res.page_info?.has_next_page) break;
    after = res.page_info?.end_cursor;
    if (!after) break;
  }

  return total;
}

export default function GallerySwipeScreen({ navigation }: Props) {
  const { width, height } = Dimensions.get("window");

  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Global position among ALL photos (processed count so far, 0-based)
  const [pos, setPos] = React.useState(0);

  // Upcoming photos (URIs). Current photo is queue[0].
  const [queue, setQueue] = React.useState<string[] | null>(null);

  // Cursor to fetch the next batch after the already fetched ones.
  const [afterCursor, setAfterCursorState] = React.useState<string | null>(null);

  // Trash count for UI
  const [trashCount, setTrashCount] = React.useState(0);

  // Undo history (last 5 actions)
  const [history, setHistory] = React.useState<Action[]>([]);

  // Total count (cached or computed)
  const [totalCount, setTotalCount] = React.useState<number | null>(null);

  // Jump UI
  const [jumpOpen, setJumpOpen] = React.useState(false);
  const [jumpText, setJumpText] = React.useState("");

  const pan = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const resetPan = React.useCallback(() => {
    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
  }, [pan]);

  const pushHistory = React.useCallback((a: Action) => {
    setHistory((prev) => [a, ...prev].slice(0, HISTORY_LIMIT));
  }, []);

  const persistProgress = React.useCallback(
    async (nextPos: number, nextQueue: string[], nextAfter: string | null) => {
      // Persist small queue only
      const q = nextQueue.slice(0, MAX_QUEUE_PERSIST);
      await Promise.all([
        setNumber(KEY_POS, nextPos),
        setStringArray(KEY_QUEUE, q),
        setString(KEY_AFTER, nextAfter),
      ]);
    },
    []
  );

  const refillQueueIfNeeded = React.useCallback(
    async (currentQueue: string[], currentAfter: string | null) => {
      if (currentQueue.length >= MIN_QUEUE_BEFORE_REFILL) return { q: currentQueue, after: currentAfter };

      const trash = await getTrashSet();

      const res = await CameraRoll.getPhotos({
        first: PAGE_SIZE,
        assetType: "Photos",
        after: currentAfter ?? undefined,
      });

      const newUris = res.edges
        .map((e) => e.node.image?.uri)
        .filter((u): u is string => typeof u === "string" && u.length > 0)
        .filter((u) => !trash.has(u)); // hide already trashed in our app

      const nextAfter = res.page_info?.has_next_page ? res.page_info?.end_cursor ?? null : null;

      // append and dedupe lightly (avoid repeats)
      const merged = [...currentQueue, ...newUris];
      const deduped: string[] = [];
      const seen = new Set<string>();
      for (const u of merged) {
        if (seen.has(u)) continue;
        seen.add(u);
        deduped.push(u);
      }

      return { q: deduped, after: nextAfter };
    },
    []
  );

  const loadInitial = React.useCallback(async () => {
    try {
      const [trash, savedPos, savedQueue, savedAfter] = await Promise.all([
        getTrashSet(),
        getNumber(KEY_POS, 0),
        getStringArray(KEY_QUEUE),
        getString(KEY_AFTER),
      ]);

      setTrashCount(trash.size);

      // Use saved queue if available; otherwise fetch first page
      let q = savedQueue.filter((u) => !trash.has(u));
      let after = savedAfter;

      if (q.length === 0) {
        const res = await CameraRoll.getPhotos({ first: PAGE_SIZE, assetType: "Photos" });
        q = res.edges
          .map((e) => e.node.image?.uri)
          .filter((u): u is string => typeof u === "string" && u.length > 0)
          .filter((u) => !trash.has(u));

        after = res.page_info?.has_next_page ? res.page_info?.end_cursor ?? null : null;
      }

      // Ensure we have enough buffer
      const refilled = await refillQueueIfNeeded(q, after);

      setPos(savedPos);
      setQueue(refilled.q);
      setAfterCursorState(refilled.after);

      // persist in case we filtered things out
      await persistProgress(savedPos, refilled.q, refilled.after);

      setErr(null);
      setHistory([]);
      pan.setValue({ x: 0, y: 0 });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load photos");
    }
  }, [pan, persistProgress, refillQueueIfNeeded]);

  const loadTotalCountFromCacheOrCompute = React.useCallback(async () => {
    // Load cached total first (instant)
    const cached = await getNumber(KEY_TOTAL, 0);
    const ts = await getNumber(KEY_TOTAL_TS, 0);
    if (cached > 0) setTotalCount(cached);

    // Recompute if cache is old (e.g. older than 24h) OR missing
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const isStale = !ts || Date.now() - ts > ONE_DAY;
    if (cached > 0 && !isStale) return;

    // This is expensive; we do it without blocking UI.
    try {
      const total = await countAllPhotos();
      setTotalCount(total);
      await Promise.all([setNumber(KEY_TOTAL, total), setNumber(KEY_TOTAL_TS, Date.now())]);
    } catch {
      // ignore (we can keep "?" total)
    }
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await loadInitial();
      void loadTotalCountFromCacheOrCompute();
    })();
    return () => {
      alive = false;
    };
  }, [loadInitial, loadTotalCountFromCacheOrCompute]);

  // Refresh trash count when returning from Trash screen
  React.useEffect(() => {
    const unsub = navigation.addListener("focus", async () => {
      const s = await getTrashSet();
      setTrashCount(s.size);
    });
    return unsub;
  }, [navigation]);

  const clearProgress = React.useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(KEY_POS),
      AsyncStorage.removeItem(KEY_QUEUE),
      AsyncStorage.removeItem(KEY_AFTER),
    ]);
  }, []);

  /**
   * Rebuild queue + cursor such that pos points to `targetPos` (0-based in the full CameraRoll order).
   * Note: We still filter out items already in our trash set, so the first shown image might be the
   * next non-trashed photo at/after targetPos.
   */
  const rebuildStateAtPos = React.useCallback(
    async (targetPos: number) => {
      const trash = await getTrashSet();

      let after: string | undefined = undefined;
      let consumed = 0; // how many CameraRoll items we've skipped so far

      // Find the page containing targetPos
      while (true) {
        const res = await CameraRoll.getPhotos({
          first: PAGE_SIZE,
          assetType: "Photos",
          after,
        });

        const edges = res.edges ?? [];
        const pageLen = edges.length;

        // No more photos
        if (pageLen === 0) {
          return { pos: Math.max(0, consumed), q: [] as string[], after: null as string | null };
        }

        // If the target is beyond this page, skip it.
        if (consumed + pageLen <= targetPos && res.page_info?.has_next_page && res.page_info?.end_cursor) {
          consumed += pageLen;
          after = res.page_info.end_cursor;
          continue;
        }

        // Target is inside this page (or we're at the end).
        const startIdx = Math.max(0, targetPos - consumed);
        const urisInPage = edges
          .slice(startIdx)
          .map((e) => e.node.image?.uri)
          .filter((u): u is string => typeof u === "string" && u.length > 0);

        // Filter out already-trashed in our app
        let q = urisInPage.filter((u) => !trash.has(u));

        let nextAfter: string | null = res.page_info?.has_next_page ? res.page_info?.end_cursor ?? null : null;

        // Top up queue if needed so the user can immediately keep swiping
        const refilled = await refillQueueIfNeeded(q, nextAfter);
        q = refilled.q;
        nextAfter = refilled.after;

        return { pos: Math.max(0, targetPos), q, after: nextAfter };
      }
    },
    [refillQueueIfNeeded]
  );



  const currentUri = queue && queue.length > 0 ? queue[0] : null;

  const commitState = React.useCallback(
    async (nextPos: number, nextQueue: string[], nextAfter: string | null) => {
      setPos(nextPos);
      setQueue(nextQueue);
      setAfterCursorState(nextAfter);
      await persistProgress(nextPos, nextQueue, nextAfter);
    },
    [persistProgress]
  );

  const restartFromBeginning = React.useCallback(() => {
    Alert.alert(
      "Restart?",
      "Go back to the beginning and reset the counter?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restart",
          style: "destructive",
          onPress: async () => {
            if (busy) return;
            setBusy(true);
            try {
              setJumpOpen(false);
              setJumpText("");
              setHistory([]);
              pan.setValue({ x: 0, y: 0 });
              await clearProgress();
              await loadInitial();
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [busy, clearProgress, loadInitial, pan]);

  const jumpToNth = React.useCallback(() => {
    const raw = jumpText.trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      Alert.alert("Invalid number", "Enter a whole number (e.g. 1, 25, 300).", [{ text: "OK" }]);
      return;
    }
    if (n < 1 || (totalCount !== null && n > totalCount)) {
      Alert.alert("Out of range", `Enter a number between 1 and ${totalCount ?? "the total photo count"}.`, [{ text: "OK" }]);
      return;
    }

    Alert.alert(
      "Jump?",
      `Jump to image #${n} and continue from there?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Jump",
          onPress: async () => {
            if (busy) return;
            setBusy(true);
            try {
              setJumpOpen(false);
              setHistory([]);
              pan.setValue({ x: 0, y: 0 });

              const targetPos = n - 1;
              const rebuilt = await rebuildStateAtPos(targetPos);
              await commitState(rebuilt.pos, rebuilt.q, rebuilt.after);
            } catch (e: any) {
              Alert.alert("Jump failed", e?.message ?? "Could not jump to that position.");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [busy, commitState, jumpText, pan, rebuildStateAtPos]);

  const refillingRef = React.useRef(false);

  React.useEffect(() => {
    if (busy) return;
    if (refillingRef.current) return;
    if (!queue) return;
    if (queue.length !== 0) return;
    if (!afterCursor) return;

    refillingRef.current = true;
    (async () => {
      try {
        setBusy(true);
        const refilled = await refillQueueIfNeeded(queue, afterCursor);
        await commitState(pos, refilled.q, refilled.after);
      } finally {
        setBusy(false);
        refillingRef.current = false;
      }
    })();
  }, [afterCursor, busy, commitState, pos, queue, refillQueueIfNeeded]);

  // Swipe LEFT = skip (advance)
  const skipCurrent = React.useCallback(async () => {
    if (busy) return;
    if (!queue || queue.length === 0) return;

    const uri = queue[0];
    setBusy(true);
    try {
      pushHistory({ kind: "skip", uri });

      const nextPos = pos + 1;
      const nextQueue = queue.slice(1);
      let nextAfter = afterCursor;

      const refilled = await refillQueueIfNeeded(nextQueue, nextAfter);
      nextAfter = refilled.after;

      await commitState(nextPos, refilled.q, nextAfter);
      pan.setValue({ x: 0, y: 0 });
    } finally {
      setBusy(false);
    }
  }, [afterCursor, busy, commitState, pan, pos, pushHistory, queue, refillQueueIfNeeded]);

  // Swipe RIGHT = trash (mark locally & hide)
  const trashCurrent = React.useCallback(async () => {
    if (busy) return;
    if (!queue || queue.length === 0) return;

    const uri = queue[0];
    setBusy(true);
    try {
      pushHistory({ kind: "trash", uri });

      await addToTrash(uri);

      const s = await getTrashSet();
      setTrashCount(s.size);

      const nextPos = pos + 1;
      const nextQueue = queue.slice(1);
      let nextAfter = afterCursor;

      const refilled = await refillQueueIfNeeded(nextQueue, nextAfter);
      nextAfter = refilled.after;

      await commitState(nextPos, refilled.q, nextAfter);
      pan.setValue({ x: 0, y: 0 });
    } finally {
      setBusy(false);
    }
  }, [afterCursor, busy, commitState, pan, pos, pushHistory, queue, refillQueueIfNeeded]);

  // Undo last 5 actions (skip/trash)
  const undoLast = React.useCallback(async () => {
    if (busy) return;
    const last = history[0];
    if (!last) return;

    setBusy(true);
    try {
      const uri = last.uri;

      // If it was trashed, untrash it
      if (last.kind === "trash") {
        await removeFromTrash(uri);
        const s = await getTrashSet();
        setTrashCount(s.size);
      }

      // Put the uri back to the FRONT of the queue and rewind position.
      const nextPos = Math.max(0, pos - 1);
      const nextQueue = queue ? [uri, ...queue] : [uri];
      const nextAfter = afterCursor;

      setHistory((prev) => prev.slice(1));
      await commitState(nextPos, nextQueue, nextAfter);
      pan.setValue({ x: 0, y: 0 });
    } finally {
      setBusy(false);
    }
  }, [afterCursor, busy, commitState, history, pan, pos, queue]);

  const SWIPE_THRESHOLD = Math.max(60, width * 0.18);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => {
          if (busy) return false;
          return Math.abs(g.dx) > 8 && Math.abs(g.dy) < 30;
        },
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, g) => {
          if (busy) return;

          const dx = g.dx;

          // RIGHT = trash
          if (dx > SWIPE_THRESHOLD) {
            Animated.timing(pan, {
              toValue: { x: width, y: 0 },
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              void trashCurrent();
            });
            return;
          }

          // LEFT = skip
          if (dx < -SWIPE_THRESHOLD) {
            Animated.timing(pan, {
              toValue: { x: -width, y: 0 },
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              void skipCurrent();
            });
            return;
          }

          resetPan();
        },
        onPanResponderTerminate: resetPan,
      }),
    [SWIPE_THRESHOLD, busy, pan, resetPan, skipCurrent, trashCurrent, width]
  );

  if (err) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <RNText style={{ fontSize: 16, textAlign: "center" }}>{err}</RNText>
        <Pressable
          onPress={loadInitial}
          style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#222" }}
        >
          <RNText style={{ color: "white" }}>Retry</RNText>
        </Pressable>
      </View>
    );
  }

  if (!queue) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // Done state (no more loaded + no more pages)
  const done = !currentUri && !afterCursor;

  if (done) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <RNText style={{ fontSize: 18, textAlign: "center" }}>Done 🎉</RNText>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          <Pressable
            onPress={undoLast}
            disabled={busy || history.length === 0}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: busy || history.length === 0 ? "rgba(0,0,0,0.2)" : "#222",
            }}
          >
            <RNText style={{ color: "white" }}>Undo ({history.length})</RNText>
          </Pressable>

          <Pressable
            onPress={() => navigation.navigate("Trash")}
            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#222" }}
          >
            <RNText style={{ color: "white" }}>Open Trash ({trashCount})</RNText>
          </Pressable>
        </View>

        <Pressable
          onPress={loadInitial}
          style={{ marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#222" }}
        >
          <RNText style={{ color: "white" }}>Reload</RNText>
        </Pressable>
      </View>
    );
  }


  const shownPos1Based = pos + 1; // global index starting from 1
  const totalText = totalCount ? String(totalCount) : "?";

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      {currentUri ? (
        <Animated.View
          {...panResponder.panHandlers}
          style={{ flex: 1, transform: [{ translateX: pan.x }, { translateY: pan.y }] }}
        >
          <Image source={{ uri: currentUri }} style={{ width, height, resizeMode: "contain" }} />
        </Animated.View>
      ) : (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator />
        </View>
      )}

      {/* Top bar */}
      <View
        style={{
          position: "absolute",
          top: 14,
          left: 12,
          right: 12,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            onPress={restartFromBeginning}
            disabled={busy}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor: busy ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.15)",
            }}
          >
            <RNText style={{ color: "white" }}>Restart</RNText>
          </Pressable>

          <Pressable
            onPress={() => setJumpOpen(true)}
            disabled={busy}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor: busy ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.15)",
            }}
          >
            <RNText style={{ color: "white" }}>Jump</RNText>
          </Pressable>

          <RNText style={{ color: "rgba(255,255,255,0.75)" }}>
            {shownPos1Based} / {totalText}
            {busy ? " • working…" : ""}
          </RNText>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={undoLast}
            disabled={busy || history.length === 0}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor:
                busy || history.length === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.15)",
            }}
          >
            <RNText style={{ color: "white" }}>Undo ({history.length})</RNText>
          </Pressable>

          <Pressable
            onPress={() => navigation.navigate("Trash")}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor: "rgba(255,255,255,0.15)",
            }}
          >
            <RNText style={{ color: "white" }}>Trash ({trashCount})</RNText>
          </Pressable>
        </View>
      </View>

      {/* Jump modal */}
      <Modal visible={jumpOpen} transparent animationType="fade" onRequestClose={() => setJumpOpen(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View style={{ backgroundColor: "#111", borderRadius: 16, padding: 16 }}>
            <RNText style={{ color: "white", fontSize: 16, fontWeight: "700" }}>Jump to image</RNText>
            <RNText style={{ color: "rgba(255,255,255,0.75)", marginTop: 6 }}>
              Enter an image number (1 = first)
            </RNText>

            <TextInput
              value={jumpText}
              onChangeText={setJumpText}
              placeholder="e.g. 25"
              placeholderTextColor="rgba(255,255,255,0.35)"
              keyboardType="number-pad"
              style={{
                marginTop: 12,
                backgroundColor: "rgba(255,255,255,0.08)",
                color: "white",
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 12,
              }}
            />

            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <Pressable
                onPress={() => setJumpOpen(false)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: "rgba(255,255,255,0.08)",
                }}
              >
                <RNText style={{ color: "white", fontWeight: "700" }}>Cancel</RNText>
              </Pressable>

              <Pressable
                onPress={jumpToNth}
                style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: "#2f6fed" }}
              >
                <RNText style={{ color: "white", fontWeight: "700" }}>Continue</RNText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Bottom hint */}
      <View style={{ position: "absolute", bottom: 18, left: 0, right: 0, alignItems: "center" }}>
        <RNText style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
          Swipe right = trash • Swipe left = skip
        </RNText>
      </View>
    </View>
  );
}