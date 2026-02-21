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
} from "react-native";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { addToTrash, getTrashSet, removeFromTrash } from "../trashStore";

type Props = NativeStackScreenProps<RootStackParamList, "GallerySwipe">;

type PhotoItem = { uri: string };

type Action =
  | { kind: "skip" }
  | { kind: "trash"; uri: string; atIndex: number };

const HISTORY_LIMIT = 5;

export default function GallerySwipeScreen({ navigation }: Props) {
  const [items, setItems] = React.useState<PhotoItem[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [index, setIndex] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [trashCount, setTrashCount] = React.useState(0);

  // ✅ last actions (skip/trash), newest first, up to 5
  const [history, setHistory] = React.useState<Action[]>([]);

  const { width, height } = Dimensions.get("window");
  const pan = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const resetPan = React.useCallback(() => {
    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
  }, [pan]);

  const pushHistory = React.useCallback((a: Action) => {
    setHistory((prev) => {
      const next = [a, ...prev];
      return next.slice(0, HISTORY_LIMIT);
    });
  }, []);

  const reloadTrashCount = React.useCallback(async () => {
    const s = await getTrashSet();
    setTrashCount(s.size);
  }, []);

  const loadPhotos = React.useCallback(async () => {
    try {
      const trash = await getTrashSet();
      setTrashCount(trash.size);

      const res = await CameraRoll.getPhotos({ first: 80, assetType: "Photos" });

      const next: PhotoItem[] = res.edges
        .map((e) => e.node.image?.uri)
        .filter((u): u is string => typeof u === "string" && u.length > 0)
        .filter((u) => !trash.has(u))
        .map((uri) => ({ uri }));

      setItems(next);
      setIndex(0);
      setHistory([]); // optional: clear undo history on reload
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load photos");
    }
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await loadPhotos();
    })();
    return () => {
      alive = false;
    };
  }, [loadPhotos]);

  // Refresh counts when returning from Trash screen
  React.useEffect(() => {
    const unsub = navigation.addListener("focus", async () => {
      await reloadTrashCount();
      // If you want recovered items to show immediately, uncomment:
      // await loadPhotos();
    });
    return unsub;
  }, [navigation, reloadTrashCount]);

  const goNext = React.useCallback(() => {
    pushHistory({ kind: "skip" });
    setIndex((i) => i + 1);
    pan.setValue({ x: 0, y: 0 });
  }, [pan, pushHistory]);

  // ✅ swipe right = trash (mark locally)
  const markCurrentAsTrash = React.useCallback(async () => {
    if (!items) return;
    const current = items[index];
    if (!current) return;

    setBusy(true);
    try {
      // record action before mutating state
      pushHistory({ kind: "trash", uri: current.uri, atIndex: index });

      await addToTrash(current.uri);

      // remove from visible list so it disappears immediately
      setItems((prev) => {
        if (!prev) return prev;
        const next = prev.slice();
        next.splice(index, 1);
        return next;
      });

      const s = await getTrashSet();
      setTrashCount(s.size);

      pan.setValue({ x: 0, y: 0 });
    } finally {
      setBusy(false);
    }
  }, [items, index, pan, pushHistory]);

  // ✅ undo last action (skip or trash)
  const undoLast = React.useCallback(async () => {
    if (busy) return;

    const last = history[0];
    if (!last) return;

    setBusy(true);
    try {
      if (last.kind === "skip") {
        setHistory((prev) => prev.slice(1));
        setIndex((i) => Math.max(0, i - 1));
        pan.setValue({ x: 0, y: 0 });
        return;
      }

      // last.kind === "trash"
      const { uri, atIndex } = last;

      await removeFromTrash(uri);

      // Reinsert back at the original index and jump back there.
      setItems((prev) => {
        if (!prev) return prev;
        const next = prev.slice();
        const insertAt = Math.min(Math.max(atIndex, 0), next.length);
        next.splice(insertAt, 0, { uri });
        return next;
      });

      setHistory((prev) => prev.slice(1));
      setIndex(() => atIndex);
      pan.setValue({ x: 0, y: 0 });

      const s = await getTrashSet();
      setTrashCount(s.size);
    } finally {
      setBusy(false);
    }
  }, [busy, history, pan]);

  // Keep index within bounds after list changes
  React.useEffect(() => {
    if (!items) return;
    if (index < 0) setIndex(0);
    if (index > items.length) setIndex(items.length);
  }, [items, index]);

  const SWIPE_THRESHOLD = Math.max(60, width * 0.18);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => {
          if (busy) return false;
          return Math.abs(g.dx) > 8 && Math.abs(g.dy) < 30;
        },

        // Must be false for PanResponder
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),

        onPanResponderRelease: (_, g) => {
          if (busy) return;

          const dx = g.dx;

          // ✅ swipe RIGHT = trash
          if (dx > SWIPE_THRESHOLD) {
            Animated.timing(pan, {
              toValue: { x: width, y: 0 },
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              void markCurrentAsTrash();
            });
            return;
          }

          // ✅ swipe LEFT = skip
          if (dx < -SWIPE_THRESHOLD) {
            Animated.timing(pan, {
              toValue: { x: -width, y: 0 },
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              goNext();
            });
            return;
          }

          resetPan();
        },

        onPanResponderTerminate: resetPan,
      }),
    [SWIPE_THRESHOLD, busy, goNext, markCurrentAsTrash, pan, resetPan, width]
  );

  if (err) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <RNText style={{ fontSize: 16, textAlign: "center" }}>{err}</RNText>
      </View>
    );
  }

  if (!items) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // Done / empty state
  if (items.length === 0 || index >= items.length) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <RNText style={{ fontSize: 18, textAlign: "center" }}>
          {items.length === 0 ? "No photos to review." : "Done 🎉"}
        </RNText>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          <Pressable
            onPress={undoLast}
            disabled={busy || history.length === 0}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor:
                busy || history.length === 0 ? "rgba(0,0,0,0.2)" : "#222",
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
          onPress={loadPhotos}
          style={{ marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#222" }}
        >
          <RNText style={{ color: "white" }}>Reload</RNText>
        </Pressable>
      </View>
    );
  }

  const current = items[index];

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <Animated.View
        {...panResponder.panHandlers}
        style={{ flex: 1, transform: [{ translateX: pan.x }, { translateY: pan.y }] }}
      >
        <Image source={{ uri: current.uri }} style={{ width, height, resizeMode: "contain" }} />
      </Animated.View>

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
        <RNText style={{ color: "rgba(255,255,255,0.75)" }}>
          {index + 1} / {items.length}
          {busy ? " • working…" : ""}
        </RNText>

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

      {/* Bottom hint */}
      <View style={{ position: "absolute", bottom: 18, left: 0, right: 0, alignItems: "center" }}>
        <RNText style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
          Swipe right = trash • Swipe left = skip
        </RNText>
      </View>
    </View>
  );
}