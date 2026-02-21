// trashStore.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "gallery_trash_uris_v1";

export async function getTrashSet(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

export async function setTrashSet(next: Set<string>) {
  await AsyncStorage.setItem(KEY, JSON.stringify([...next]));
}

export async function addToTrash(uri: string) {
  const s = await getTrashSet();
  s.add(uri);
  await setTrashSet(s);
}

export async function removeFromTrash(uri: string) {
  const s = await getTrashSet();
  s.delete(uri);
  await setTrashSet(s);
}

export async function clearTrash() {
  await AsyncStorage.removeItem(KEY);
}