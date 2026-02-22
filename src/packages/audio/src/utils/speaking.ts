// Get streams current volume
export function getCurrentVolume(analyser: AnalyserNode) {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += (dataArray[i] - 128) * (dataArray[i] - 128);
  }

  const rms = Math.sqrt(sum / bufferLength);
  return rms;
}

// Return if user is speaking
export const isSpeaking = (analyser: AnalyserNode, threshold: number) => {
  const currentVolume = getCurrentVolume(analyser);
  return currentVolume > threshold;
};
