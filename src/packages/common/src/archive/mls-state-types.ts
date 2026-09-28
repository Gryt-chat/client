/*
 * Copied from `src/mls/interfaces.ts` in @gryt/core (GRYT-1512), which isn't released yet.
 * Delete this file and import from @gryt/core once the pin moves; the shapes must not drift.
 */

export interface MlsDeviceRecord {
  deviceId: string;
  signKey: Uint8Array;
  publicKey: Uint8Array;
  certificate: Uint8Array;
}

export interface MlsKeyPackageRecord {
  ref: string;
  keyPackage: Uint8Array;
  privatePackage: Uint8Array;
  lastResort: boolean;
  createdAt: number;
}

export interface MlsGroupRecord {
  conversationId: string;
  groupId: string;
  state: Uint8Array;
  cursor: number;
  joinedEpoch: number;
  pending?: { commit: Uint8Array; state: Uint8Array };
}

export interface MlsStateStore {
  loadDevice(): Promise<MlsDeviceRecord | null>;
  saveDevice(device: MlsDeviceRecord): Promise<void>;

  putKeyPackages(records: MlsKeyPackageRecord[]): Promise<void>;
  getKeyPackage(ref: string): Promise<MlsKeyPackageRecord | null>;
  deleteKeyPackage(ref: string): Promise<void>;

  loadGroup(conversationId: string): Promise<MlsGroupRecord | null>;
  listGroups(): Promise<MlsGroupRecord[]>;
  saveGroup(record: MlsGroupRecord): Promise<void>;
  deleteGroup(conversationId: string): Promise<void>;
}
