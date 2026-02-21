import * as React from "react";
import { View, Image, ActivityIndicator, Dimensions, Text as RNText } from "react-native";
import PagerView from "react-native-pager-view";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";

type PhotoItem = { uri: string };

export default function GallerySwipeScreen() {
  const [items, setItems] = React.useState<PhotoItem[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await CameraRoll.getPhotos({
          first: 50,
          assetType: "Photos",
        });

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

  return (
    <View style={{ flex: 1 }}>
      <PagerView style={{ flex: 1 }} initialPage={0}>
        {items.map((p, idx) => (
          <View key={p.uri + idx} collapsable={false} style={{ flex: 1 }}>
            <Image
              source={{ uri: p.uri }}
              style={{ width, height, resizeMode: "contain" }}
            />
          </View>
        ))}
      </PagerView>
    </View>
  );
}