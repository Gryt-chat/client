export interface Streams {
  [id: string]: StreamData;
}

export interface StreamData {
  stream: MediaStream;
  isLocal: boolean; // Flag indicating if it's a local stream
}

export type StreamSources = {
  [id: string]: {
    gain: GainNode;
    analyser: AnalyserNode;
    stream: MediaStreamAudioSourceNode | MediaElementAudioSourceNode;
    audioElement?: HTMLAudioElement;
  };
};

// Connection states for SFU
export enum SFUConnectionState {
  DISCONNECTED = 'disconnected',
  REQUESTING_ACCESS = 'requesting_access',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  FAILED = 'failed',
}

export interface SFUInterface {
  streams: Streams;
  error: string | null;
  streamSources: StreamSources;
  connect: (channelID: string, channelEsportsMode?: boolean, channelMaxBitrate?: number | null) => Promise<void>;
  disconnect: (playSound?: boolean, onDisconnect?: () => void) => Promise<void>;
  currentServerConnected: string;
  currentChannelConnected: string;
  isConnected: boolean;
  connectionState: SFUConnectionState;
  isConnecting: boolean;
  // Debug-only accessors (optional)
  getPeerConnection?: () => RTCPeerConnection | null;
  activeSfuUrl?: string | null;
}
