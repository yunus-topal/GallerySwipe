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
import { addToTrash, getTrashSet } from "../trashStore";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "GallerySwipe">;
type PhotoItem = { uri: string };

export default function GallerySwipeScreen({ navigation }: Props) {
  const [items, setItems] = React.useState<PhotoItem[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [index, setIndex] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [trashCount, setTrashCount] = React.useState(0);

  const { width, height } = Dimensions.get("window");
  const pan = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const resetPan = React.useCallback(() => {
    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
  }, [pan]);

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

  // Refresh when coming back from Trash screen
  React.useEffect(() => {
    const unsub = navigation.addListener("focus", async () => {
      await reloadTrashCount();
      // Optionally refresh list so recovered items re-appear:
      // await loadPhotos();
    });
    return unsub;
  }, [navigation, reloadTrashCount]);

  const goNext = React.useCallback(() => {
    setIndex((i) => i + 1);
    pan.setValue({ x: 0, y: 0 });
  }, [pan]);

  const markCurrentAsTrash = React.useCallback(async () => {
    if (!items) return;
    const current = items[index];
    if (!current) return;

    setBusy(true);
    try {
      await addToTrash(current.uri);

      setItems((prev) => {
        if (!prev) return prev;
        const next = prev.slice();
        next.splice(index, 1);
        return next;
      });

      // keep index as-is; next item slides into this index
      const s = await getTrashSet();
      setTrashCount(s.size);

      pan.setValue({ x: 0, y: 0 });
    } finally {
      setBusy(false);
    }
  }, [items, index, pan]);

  // bounds fix after deletion from list
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
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, g) => {
          if (busy) return;

          const dx = g.dx;

          // ✅ RIGHT = trash (mark)
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

          // ✅ LEFT = skip
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

  if (items.length === 0 || index >= items.length) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <RNText style={{ fontSize: 18, textAlign: "center" }}>
          {items.length === 0 ? "No photos to review." : "Done 🎉"}
        </RNText>

        <Pressable
          onPress={() => navigation.navigate("Trash")}
          style={{ marginTop: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#222" }}
        >
          <RNText style={{ color: "white" }}>Open Trash ({trashCount})</RNText>
        </Pressable>

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

      <View style={{ position: "absolute", top: 14, left: 12, right: 12, flexDirection: "row", justifyContent: "space-between" }}>
        <RNText style={{ color: "rgba(255,255,255,0.75)" }}>
          {index + 1} / {items.length} {busy ? " • saving…" : ""}
        </RNText>

        <Pressable onPress={() => navigation.navigate("Trash")} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)" }}>
          <RNText style={{ color: "white" }}>Trash ({trashCount})</RNText>
        </Pressable>
      </View>

      <View style={{ position: "absolute", bottom: 18, left: 0, right: 0, alignItems: "center" }}>
        <RNText style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
          Swipe right = trash • Swipe left = skip
        </RNText>
      </View>
    </View>
  );
}