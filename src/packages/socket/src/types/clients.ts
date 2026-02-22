export type UserStatus = 'online' | 'in_voice' | 'afk' | 'offline';

export type Client = {
  serverUserId?: string;
  nickname: string;
  isMuted: boolean;
  isDeafened: boolean;
  color: string;
  streamID: string;
  hasJoinedChannel: boolean;
  voiceChannelId?: string;
  isConnectedToVoice?: boolean;
  isAFK: boolean;
  cameraEnabled?: boolean;
  cameraStreamID?: string;
  screenShareEnabled?: boolean;
  screenShareVideoStreamID?: string;
  screenShareAudioStreamID?: string;
  status?: UserStatus;
  lastSeen?: Date;
};

export type Clients = { [id: string]: Client };
