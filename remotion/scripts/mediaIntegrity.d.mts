export type PacketStream = {
  nb_read_packets?: string | number;
  sample_rate?: string | number;
};

export function packetCoverageFailures(input: {
  video?: PacketStream;
  audio?: PacketStream;
  expectedSeconds: number | null;
  fps: number;
}): string[];
