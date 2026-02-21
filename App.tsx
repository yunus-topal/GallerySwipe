import * as React from "react";
import { useColorScheme } from "react-native";
import { Provider as PaperProvider, MD3DarkTheme, MD3LightTheme } from "react-native-paper";
import { NavigationContainer, DarkTheme as NavDarkTheme, DefaultTheme as NavLightTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import LandingScreen from "./src/screens/LandingScreen";
import GallerySwipeScreen from "./src/screens/GallerySwipeScreen";
import TrashScreen from "./src/screens/TrashScreen";

export type RootStackParamList = {
  Landing: undefined;
  GallerySwipe: undefined;
  Trash: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  // Paper theme (Material 3)
  const paperTheme = React.useMemo(() => {
    const base = isDark ? MD3DarkTheme : MD3LightTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        onSurface: isDark ? "#FFFFFF" : "#111111",
        onSurfaceVariant: isDark ? "#E6E6E6" : "#2B2B2B",
        outline: isDark ? "#3A3A3A" : "#D0D0D0",
      },
    };
  }, [isDark]);

  // Navigation theme (keeps things consistent like background)
  const navTheme = React.useMemo(() => {
    const base = isDark ? NavDarkTheme : NavLightTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: paperTheme.colors.background,
        card: paperTheme.colors.surface,      // header background in some navigators
        text: paperTheme.colors.onSurface,    // general nav text
        border: paperTheme.colors.outline,
        primary: paperTheme.colors.primary,
      },
    };
  }, [isDark, paperTheme]);

  return (
    <PaperProvider theme={paperTheme}>
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: paperTheme.colors.surface },
            headerTitleStyle: { color: paperTheme.colors.onSurface },
            headerTintColor: paperTheme.colors.onSurface, // back arrow + header buttons
            headerShadowVisible: false,
            // Optional: if you want a subtle separator line instead of shadow
            headerLargeTitle: false,
            contentStyle: { backgroundColor: paperTheme.colors.background },
          }}
        >
          <Stack.Screen name="Landing" component={LandingScreen} options={{ title: "Home" }} />
          <Stack.Screen name="GallerySwipe" component={GallerySwipeScreen} options={{ title: "Gallery" }} />
          <Stack.Screen name="Trash" component={TrashScreen} options={{ title: "Trash" }} />
        </Stack.Navigator>
      </NavigationContainer>
    </PaperProvider>
  );
}