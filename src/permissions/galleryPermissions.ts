import { Platform } from "react-native";
import {
  check,
  request,
  openSettings,
  RESULTS,
  PERMISSIONS,
  Permission,
} from "react-native-permissions";

type PermissionResult = { granted: true } | { granted: false; canAskAgain: boolean };

async function requestOne(p: Permission): Promise<PermissionResult> {
  const current = await check(p);

  if (current === RESULTS.GRANTED || current === RESULTS.LIMITED) {
    return { granted: true };
  }

  const next = await request(p);

  if (next === RESULTS.GRANTED || next === RESULTS.LIMITED) {
    return { granted: true };
  }

  // BLOCKED means user must go to settings
  const canAskAgain = next !== RESULTS.BLOCKED;
  return { granted: false, canAskAgain };
}

export async function ensureGalleryPermissions(): Promise<PermissionResult> {
  if (Platform.OS === "ios") {
    // Read access
    const readRes = await requestOne(PERMISSIONS.IOS.PHOTO_LIBRARY);
    if (!readRes.granted) return readRes;

    // "Write" (add) access — optional unless you actually save media
    const addRes = await requestOne(PERMISSIONS.IOS.PHOTO_LIBRARY_ADD_ONLY);
    // If add is denied, we can still proceed for read-only gallery
    return { granted: true };
  }

  // Android
  const api = typeof Platform.Version === "number" ? Platform.Version : parseInt(String(Platform.Version), 10);

  if (api >= 33) {
    // Android 13+ granular media permissions
    const img = await requestOne(PERMISSIONS.ANDROID.READ_MEDIA_IMAGES);
    if (!img.granted) return img;

    // optional: videos too (safe to request if you’ll show videos)
    // const vid = await requestOne(PERMISSIONS.ANDROID.READ_MEDIA_VIDEO);
    // if (!vid.granted) return vid;

    return { granted: true };
  }

  // Android 12 and below
  const storage = await requestOne(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
  if (!storage.granted) return storage;

  return { granted: true };
}

export async function goToAppSettings() {
  await openSettings();
}