import * as React from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Button, Text, useTheme, Surface } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { ensureGalleryPermissions, goToAppSettings } from "../permissions/galleryPermissions";

type Props = NativeStackScreenProps<RootStackParamList, "Landing">;

export default function LandingScreen({ navigation }: Props) {
  const [loading, setLoading] = React.useState(false);
  const theme = useTheme();

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
        return;
      }

      navigation.navigate("GallerySwipe");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>
        <Surface
          elevation={1}
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.outline,
            },
          ]}
        >
          <Text
            variant="headlineMedium"
            style={[styles.title, { color: theme.colors.onSurface }]}
          >
            Gallery Swipe
          </Text>

          <Text
            variant="bodyMedium"
            style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
          >
            Tap start to grant gallery permissions, then swipe through your recent photos.
          </Text>

          <Button
            mode="contained"
            onPress={onStart}
            loading={loading}
            disabled={loading}
            contentStyle={styles.buttonContent}
            style={styles.button}
          >
            Start
          </Button>

          <Text
            variant="labelSmall"
            style={[styles.footer, { color: theme.colors.onSurfaceVariant }]}
          >
            If permission is blocked, we’ll send you to Settings.
          </Text>
        </Surface>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
  },
  card: {
    padding: 20,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  title: {
    marginBottom: 4,
    fontWeight: "700",
  },
  subtitle: {
    lineHeight: 20,
  },
  button: {
    marginTop: 8,
    borderRadius: 12,
  },
  buttonContent: {
    paddingVertical: 8,
  },
  footer: {
    marginTop: 6,
  },
});