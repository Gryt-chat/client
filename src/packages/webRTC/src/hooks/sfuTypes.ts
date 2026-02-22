import { SFUConnectionState } from "../types/SFU";

export interface SFUConnectionStateInternal {
  state: SFUConnectionState;
  roomId: string | null;
  serverId: string | null;
  error: string | null;
}

export interface RoomAccessData {
  room_id: string;
  join_token: unknown;
  sfu_url: string;
  sfu_urls?: string[];
  timestamp: number;
}
