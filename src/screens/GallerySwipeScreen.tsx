import * as React from "react";
import {
  View,
  Image,
  ActivityIndicator,
  Dimensions,
  Text as RNText,
  Animated,
  PanResponder,
  Alert,
} from "react-native";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";

type PhotoItem = { uri: string };

export default function GallerySwipeScreen() {
  const [items, setItems] = React.useState<PhotoItem[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [index, setIndex] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await CameraRoll.getPhotos({ first: 50, assetType: "Photos" });

        const next: PhotoItem[] = res.edges
          .map((e) => e.node.image?.uri)
          .filter((u): u is string => typeof u === "string" && u.length > 0)
          .map((uri) => ({ uri }));

        if (alive) setItems(next);
      } catch (e: any) {
        if (alive) setErr(e?.message ?? "Failed to load photos");
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const { width, height } = Dimensions.get("window");

  const pan = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const resetPan = React.useCallback(() => {
    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
  }, [pan]);

  const goNext = React.useCallback(() => {
    setIndex((i) => i + 1);
    pan.setValue({ x: 0, y: 0 });
  }, [pan]);

  const deleteCurrent = React.useCallback(async () => {
    if (!items) return;
    const current = items[index];
    if (!current) return;

    setBusy(true);
    try {
      // Android will usually show a system confirmation UI.
      await CameraRoll.deletePhotos([current.uri]);

      // Only remove from the list after delete succeeded.
      setItems((prev) => {
        if (!prev) return prev;
        const next = prev.slice();
        next.splice(index, 1);
        return next;
      });

      pan.setValue({ x: 0, y: 0 });
    } catch (e: any) {
      Alert.alert("Delete failed", e?.message ?? "Could not delete this photo.");
      resetPan();
    } finally {
      setBusy(false);
    }
  }, [items, index, pan, resetPan]);

  // Keep index in bounds if items shrink
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

          // ✅ Swipe RIGHT => delete
          if (dx > SWIPE_THRESHOLD) {
            Animated.timing(pan, {
              toValue: { x: width, y: 0 },
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              void deleteCurrent();
            });
            return;
          }

          // ✅ Swipe LEFT => skip (next image)
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
    [busy, deleteCurrent, goNext, pan, resetPan, width]
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

  if (items.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <RNText style={{ fontSize: 16, textAlign: "center" }}>No photos found.</RNText>
      </View>
    );
  }

  if (index >= items.length) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <RNText style={{ fontSize: 18, textAlign: "center" }}>Done 🎉</RNText>
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

      <View style={{ position: "absolute", top: 18, left: 0, right: 0, alignItems: "center" }}>
        <RNText style={{ color: "rgba(255,255,255,0.75)" }}>
          {index + 1} / {items.length}
          {busy ? "  •  deleting…" : ""}
        </RNText>
      </View>

      <View style={{ position: "absolute", bottom: 18, left: 0, right: 0, alignItems: "center" }}>
        <RNText style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
          Swipe right = delete • Swipe left = skip
        </RNText>
      </View>
    </View>
  );
}