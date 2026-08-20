const AAC_SAMPLES_PER_PACKET = 1024;
const VIDEO_PACKET_TOLERANCE = 1;
const AUDIO_SECONDS_TOLERANCE = 0.25;

export function packetCoverageFailures({ video, audio, expectedSeconds, fps }) {
  const failures = [];

  if (video) {
    const packets = Number(video.nb_read_packets);
    if (!Number.isInteger(packets) || packets <= 0) {
      failures.push("video packet count is unavailable; output may be partial");
    } else if (Number.isFinite(expectedSeconds)) {
      const expected = Math.round(expectedSeconds * fps);
      if (Math.abs(packets - expected) > VIDEO_PACKET_TOLERANCE) {
        failures.push(
          `video output is partial: found ${packets} packets, expected ${expected} frames`,
        );
      }
    }
  }

  if (audio) {
    const packets = Number(audio.nb_read_packets);
    const sampleRate = Number(audio.sample_rate);
    if (
      !Number.isInteger(packets) ||
      packets <= 0 ||
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0
    ) {
      failures.push("audio packet coverage is unavailable; output may be partial");
    } else if (Number.isFinite(expectedSeconds)) {
      const decodedSeconds = (packets * AAC_SAMPLES_PER_PACKET) / sampleRate;
      if (expectedSeconds - decodedSeconds > AUDIO_SECONDS_TOLERANCE) {
        failures.push(
          `audio output is partial: packets cover ${decodedSeconds.toFixed(2)}s of ` +
            `${expectedSeconds.toFixed(2)}s`,
        );
      }
    }
  }

  return failures;
}
