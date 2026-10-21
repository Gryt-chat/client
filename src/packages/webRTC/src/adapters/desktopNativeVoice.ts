import type { VoicePlatform } from "@gryt/voice";

import { getElectronAPI } from "../../../../lib/electron";
import { effectValues, EMPTY_REPORT, parseReport } from "./voiceHelperReport";

/** The phone's native engine on the desktop, through gryt-voice (GRYT-1837): the SDK's startNativeAudio over IPC. */
type StartNative = NonNullable<VoicePlatform["startNativeAudio"]>;

export const startDesktopNativeAudio: StartNative = async (offer, effects) => {
  const helper = getElectronAPI()?.voiceHelper;
  if (!helper || !(await helper.start({ addrs: offer.addrs, session: offer.session, key: offer.key, effects: effectValues(effects) }))) return null;
  let last = EMPTY_REPORT;
  const offReport = helper.onReport((line) => (last = parseReport(line) ?? last));
  const offExit = helper.onExit(() => (last = EMPTY_REPORT));
  return {
    setSending: (on) => helper.send(`sending ${on ? 1 : 0}`),
    setOutputGain: (gain) => helper.send(`output ${gain}`),
    setEffects: (e) => helper.send(`effects ${effectValues(e).join(" ")}`),
    speaking: () => last.speaking,
    setGains: (gains) => helper.send(`gains ${[...gains].map(([id, gain]) => `${id}=${gain}`).join(" ")}`),
    levels: () => ({ ids: [...last.levels.keys()], db: [...last.levels.values()], mic: last.mic, micSpeaking: last.micSpeaking }),
    // shortcut: gryt-voice doesn't report device delays, so these are one 64-frame buffer each way; report them when the estimate needs it.
    latency: () => ({ ids: [...last.buffered.keys()], bufferedMs: [...last.buffered.values()], inputMs: 0, outputMs: 0, ioBufferMs: 64 / 48, sampleRate: 48000 }),
    close: () => {
      offReport();
      offExit();
      helper.send("stop");
    },
  };
};
