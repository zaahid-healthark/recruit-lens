import { randomUUID } from "crypto";
import fssync from "fs";
import fs from "fs/promises";
import path from "path";
import { StorageAdapter } from "./StorageAdapter";

/** Stores uploads as flat files under a base directory (STORAGE_DIR). */
export class LocalDiskStorage implements StorageAdapter {
  constructor(private readonly baseDir: string) {
    fssync.mkdirSync(baseDir, { recursive: true });
  }

  async saveFromFile(tempPath: string, originalFilename: string): Promise<string> {
    const ext = path.extname(originalFilename).toLowerCase() || ".bin";
    const key = `${Date.now()}-${randomUUID()}${ext}`;
    // copy + unlink instead of rename: rename fails across drives/volumes on Windows.
    await fs.copyFile(tempPath, path.join(this.baseDir, key));
    await fs.unlink(tempPath).catch(() => undefined);
    return key;
  }

  async getLocalPath(storagePath: string): Promise<string> {
    return path.join(this.baseDir, storagePath);
  }

  async delete(storagePath: string): Promise<void> {
    await fs.unlink(path.join(this.baseDir, storagePath)).catch(() => undefined);
  }
}
