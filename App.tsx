import * as React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Provider as PaperProvider } from "react-native-paper";

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
  return (
    <PaperProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Landing" component={LandingScreen} options={{ title: "Home" }} />
          <Stack.Screen name="GallerySwipe" component={GallerySwipeScreen} options={{ title: "Gallery" }} />
          <Stack.Screen name="Trash" component={TrashScreen}  options={{ title: "Trash" }} />
        </Stack.Navigator>
      </NavigationContainer>
    </PaperProvider>
  );
}