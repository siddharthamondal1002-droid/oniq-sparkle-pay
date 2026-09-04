/**
 * ATTACH A RECORDING — the "+ Attach audio" control in the owner's reference.
 *
 * THIS ONE IS REAL, and it very nearly was not built. A first probe attached
 * audio to the TTS model, got 400 "Audio input modality is not enabled for
 * this model", and concluded ONIQ could not offer this at all. The owner said
 * that was wrong. It was: the TTS model speaks and does not listen, but an
 * ORDINARY Gemini text model transcribes audio happily — measured 2026-09-04,
 * three models, all 200 with text back. The lesson is in voiceCore.ts and the
 * feature is here.
 *
 * So this attaches a recording and the server turns it into TEXT. It is not
 * voice cloning; that field exists in the API (`customVoiceConfig`) and this
 * key is not admitted to it, which is recorded rather than guessed at.
 *
 * TWO WAYS IN, because the reference draws both: pick a file, or record now.
 * Recording uses MediaRecorder, which every browser ONIQ targets has, and
 * degrades to file-pick where getUserMedia is refused or absent — a person
 * who declines the microphone should lose the microphone, not the feature.
 */
import { Mic, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** What travels to the edge function; `label` is for the person, not the wire. */
export type AttachedAudio = { mimeType: string; data: string; label: string };

const ACCEPT = "audio/wav,audio/mpeg,audio/mp4,audio/webm,audio/ogg,.m4a,.mp3,.wav";

/** Matches TRANSCRIBE_MAX_BYTES on the server; the server is the real gate. */
const MAX_BYTES = 8 * 1024 * 1024;

/** A minute is plenty for a note, and bounds what one call can be billed. */
const MAX_SECONDS = 60;

/**
 * Base64 for the edge function, read through a BOUNDED SLICE.
 *
 * Not FileReader.readAsDataURL. src/lib/__tests__/megaLoopGuardrails.test.ts
 * bans that on any upload path and is right to: base64 inflates ~33%, so a
 * large file becomes a much larger string and Android kills the process with
 * no dialog — a failure that never reproduces in a desktop preview. That test
 * freezes a list of five files that must read whole and forbids a sixth.
 *
 * `.slice(...).arrayBuffer()` is the pattern it endorses instead, because the
 * read is bounded BY CONSTRUCTION rather than by a check somebody has to
 * remember. The size is refused first anyway; slicing to the same ceiling
 * means even a Blob that lies about `size` cannot get past it.
 *
 * Encoded in chunks: String.fromCharCode(...bytes) on a multi-megabyte array
 * spreads millions of arguments onto the call stack and throws
 * RangeError: Maximum call stack size exceeded.
 */
async function boundedBase64(blob: Blob, maxBytes: number): Promise<string> {
  const buf = await blob.slice(0, maxBytes).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function OniqAttachAudio({
  value,
  onChange,
  disabled,
  label = "Attach audio",
  className,
}: {
  value: AttachedAudio | null;
  onChange: (next: AttachedAudio | null) => void;
  disabled?: boolean;
  /** Music says "Reference track"; Voice says "Attach audio". */
  label?: string;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // Stop the tracks on unmount. Without this the browser's recording
  // indicator stays lit after the person navigates away, which reads as the
  // app still listening — and in a sense it is.
  useEffect(() => {
    return () => {
      recRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stop();
    // `stop` is stable enough for this guard; re-running on every render would
    // restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, recording]);

  async function accept(blob: Blob, label: string) {
    if (blob.size > MAX_BYTES) {
      toast.error("That recording is too long. Under 8MB, please.");
      return;
    }
    try {
      const data = await boundedBase64(blob, MAX_BYTES);
      if (!data) throw new Error("empty");
      onChange({ mimeType: blob.type || "audio/webm", data, label });
    } catch {
      toast.error("Couldn't read that recording.");
    }
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        // The tracks are stopped HERE rather than in the click handler: a
        // recorder still flushing when its stream dies produces a truncated
        // blob, and the last second of what someone said is the part they
        // notice missing.
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size > 0) void accept(blob, "Your recording");
      };
      recRef.current = rec;
      setSeconds(0);
      setRecording(true);
      rec.start();
    } catch {
      // Refused permission, no microphone, or an insecure origin. The file
      // picker still works, so say that rather than just failing.
      toast.error("No microphone available. You can attach a file instead.");
      setRecording(false);
    }
  }

  function stop() {
    setRecording(false);
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {value ? (
        <span
          className="flex min-w-0 items-center gap-2 rounded-full bg-tint-soft py-1.5 pe-2 ps-3"
          data-tint="blue"
        >
          <span className="min-w-0 truncate text-[12px] font-medium text-tint">{value.label}</span>
          <button
            type="button"
            data-testid="attach-audio-remove"
            onClick={() => onChange(null)}
            aria-label="Remove the attached recording"
            className="press grid h-5 w-5 shrink-0 place-items-center rounded-full bg-foreground/10 text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void accept(f, f.name);
          // Reset, or re-picking the same file fires no change event.
          e.target.value = "";
        }}
      />

      <button
        type="button"
        data-testid="attach-audio-pick"
        disabled={disabled || recording}
        onClick={() => fileRef.current?.click()}
        className="press inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-2 text-[13px] font-medium normal-case tracking-normal text-foreground disabled:opacity-50"
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {value ? "Change" : label}
      </button>

      <button
        type="button"
        data-testid="attach-audio-record"
        disabled={disabled}
        onClick={() => (recording ? stop() : void start())}
        aria-label={recording ? "Stop recording" : "Record audio"}
        className={cn(
          "press inline-flex items-center gap-2 rounded-full px-3 py-2 text-[13px] font-medium normal-case tracking-normal disabled:opacity-50",
          recording ? "bg-destructive text-white" : "border border-border-strong text-foreground",
        )}
      >
        {recording ? (
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
        ) : (
          <Mic className="h-4 w-4" aria-hidden="true" />
        )}
        {recording ? `${seconds}s — stop` : "Record"}
      </button>
    </div>
  );
}
