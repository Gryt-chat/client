export type UserStatus = 'online' | 'in_voice' | 'afk' | 'offline';

export type Client = {
  serverUserId?: string;
  nickname: string;
  /** What they say they are doing. Absent when they have not said. */
  activity?: string;
  isMuted: boolean;
  isDeafened: boolean;
  isServerMuted?: boolean;
  isServerDeafened?: boolean;
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

/**
 * What one server holds for you: your profile as other members there see it.
 * Per-server on purpose — the nickname, the picture and the look are all things
 * somebody can set differently in one place than in another.
 *
 * This was written out inline in four files, which is how the first three of
 * them ended up disagreeing about whether `avatarWorn` existed.
 */
export type ServerProfile = {
  nickname: string;
  avatarFileId: string | null;
  avatarUrl: string | null;
  /** The designed look, or null for an uploaded picture or the seeded owl. */
  avatarWorn: string | null;
};
