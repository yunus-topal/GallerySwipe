import * as React from "react";
import { View, Alert } from "react-native";
import { Button, Text } from "react-native-paper";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { ensureGalleryPermissions, goToAppSettings } from "../permissions/galleryPermissions";

type Props = NativeStackScreenProps<RootStackParamList, "Landing">;

export default function LandingScreen({ navigation }: Props) {
  const [loading, setLoading] = React.useState(false);

  const onStart = async () => {
    setLoading(true);
    try {
      const res = await ensureGalleryPermissions();

      if (!res.granted) {
        Alert.alert(
          "Permission needed",
          res.canAskAgain
            ? "We need photo access to continue."
            : "Photo access is blocked. Enable it in Settings to continue.",
          res.canAskAgain
            ? [{ text: "OK" }]
            : [
                { text: "Cancel", style: "cancel" },
                { text: "Open Settings", onPress: goToAppSettings },
              ]
        );
        return; // IMPORTANT: do not navigate
      }

      navigation.navigate("GallerySwipe");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 12 }}>
      <Text variant="headlineMedium">Gallery Swipe</Text>
      <Text variant="bodyMedium">
        Tap start to grant gallery permissions, then swipe through your recent photos.
      </Text>

      <Button mode="contained" onPress={onStart} loading={loading} disabled={loading}>
        Start
      </Button>
    </View>
  );
}