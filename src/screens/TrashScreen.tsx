import * as React from "react";
import {
  View,
  Text as RNText,
  FlatList,
  Image,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import { clearTrash, getTrashSet, removeFromTrash, setTrashSet } from "../trashStore";

type PhotoItem = { uri: string };

export default function TrashScreen() {
  const [items, setItems] = React.useState<PhotoItem[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const loadTrash = React.useCallback(async () => {
    const s = await getTrashSet();
    setItems([...s].map((uri) => ({ uri })));
  }, []);

  React.useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  const recover = React.useCallback(async (uri: string) => {
    setBusy(true);
    try {
      await removeFromTrash(uri);
      await loadTrash();
    } finally {
      setBusy(false);
    }
  }, [loadTrash]);

  const deleteAll = React.useCallback(async () => {
    const s = await getTrashSet();
    const uris = [...s];
    if (uris.length === 0) return;

    Alert.alert(
      "Delete all trashed photos?",
      "This will delete them from your device. Android may ask for confirmation.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              // One call; may still trigger system confirmation UI.
              await CameraRoll.deletePhotos(uris);
              await clearTrash();
              await loadTrash();
            } catch (e: any) {
              Alert.alert("Delete failed", e?.message ?? "Could not delete all.");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [loadTrash]);

  const deleteOneNow = React.useCallback(async (uri: string) => {
    Alert.alert("Delete this photo now?", "Android may ask for confirmation.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await CameraRoll.deletePhotos([uri]);
            // remove from trash list if deletion succeeded
            const s = await getTrashSet();
            s.delete(uri);
            await setTrashSet(s);
            await loadTrash();
          } catch (e: any) {
            Alert.alert("Delete failed", e?.message ?? "Could not delete this photo.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [loadTrash]);

  if (!items) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: "black" }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <RNText style={{ color: "white", fontSize: 18 }}>
          Trash ({items.length}) {busy ? "• working…" : ""}
        </RNText>

        <Pressable
          onPress={deleteAll}
          disabled={busy || items.length === 0}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: items.length === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,0,0,0.25)",
            borderWidth: 1,
            borderColor: "rgba(255,0,0,0.35)",
          }}
        >
          <RNText style={{ color: "white" }}>Delete all</RNText>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <RNText style={{ color: "rgba(255,255,255,0.7)" }}>Trash is empty.</RNText>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.uri}
          numColumns={3}
          columnWrapperStyle={{ gap: 8 }}
          contentContainerStyle={{ gap: 8, paddingBottom: 20 }}
          renderItem={({ item }) => (
            <View style={{ flex: 1, aspectRatio: 1, gap: 6 }}>
              <Pressable onPress={() => recover(item.uri)} disabled={busy}>
                <Image source={{ uri: item.uri }} style={{ width: "100%", height: "100%", borderRadius: 10 }} />
              </Pressable>

              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Pressable onPress={() => recover(item.uri)} disabled={busy}>
                  <RNText style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}>Recover</RNText>
                </Pressable>

                <Pressable onPress={() => deleteOneNow(item.uri)} disabled={busy}>
                  <RNText style={{ color: "rgba(255,120,120,0.95)", fontSize: 12 }}>Delete</RNText>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <RNText style={{ color: "rgba(255,255,255,0.5)", marginTop: 8, fontSize: 12 }}>
        Tip: Tap a photo to recover it.
      </RNText>
    </View>
  );
}