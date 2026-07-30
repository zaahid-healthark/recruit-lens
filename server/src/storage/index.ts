import { env } from "../config/env";
import { LocalDiskStorage } from "./LocalDiskStorage";
import { StorageAdapter } from "./StorageAdapter";

/** Active storage adapter. Swap to GoogleDriveStorage here when it's implemented. */
export const storage: StorageAdapter = new LocalDiskStorage(env.storageDir);
