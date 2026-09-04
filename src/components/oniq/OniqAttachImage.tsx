/**
 * ATTACH A PICTURE — the "+ Add image" control in the owner's reference,
 * drawn as a thumbnail with a remove badge beside two buttons.
 *
 * THIS ONE IS REAL, and that is why it exists at all. Measured 2026-09-04 on
 * the direct Google route: an inlineData jpeg part placed before the text part
 * ("make the wall green") returned 200 with an edited picture, 2,405,500
 * bytes. The Lovable gateway's OpenAI-shaped endpoint had no field for a
 * reference image at all, so this control could not honestly have been built
 * before the 2026-09-04b move. A button that does nothing is worse than no
 * button.
 *
 * WHY IT DOWNSCALES BEFORE IT SENDS. A modern phone photo is 4-12 MB and
 * arrives as HEIC or a 4000px JPEG. Sending that raw would push a ~16 MB
 * base64 body through an edge function for no gain — the model is not reading
 * fine detail out of a reference — and would trip the server's 4 MB decoded
 * ceiling on a perfectly ordinary holiday snap. compressToJpeg is the same
 * helper Ting, Scout and Learn already use, so there is one downscaler in the
 * app rather than four.
 *
 * The server validates all of this again (mime, base64 shape, decoded size).
 * Nothing here is a security control; the client is a suggestion.
 */
import { Camera, ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { compressToJpeg } from "@/lib/imageCompress";
import { cn } from "@/lib/utils";

/** What travels to the edge function, matching ReferenceImage there. */
export type AttachedImage = { mimeType: "image/jpeg"; data: string; previewUrl: string };

/** What a phone or a desktop file picker can hand over and we can decode. */
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

/**
 * The ceiling on the file BEFORE downscaling.
 *
 * Generous on purpose — 20 MB covers any phone photo — because the point of
 * the limit is to refuse something absurd, and the downscale below is what
 * actually decides what gets sent. Refusing a 12 MB photo the app is about to
 * turn into 200 KB would be a limit that serves the code rather than the
 * person holding the phone.
 */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export function OniqAttachImage({
  value,
  onChange,
  disabled,
  label = "Add image",
  className,
}: {
  value: AttachedImage | null;
  onChange: (next: AttachedImage | null) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(false);

  async function accept(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error("That picture is very large. Try one under 20MB.");
      return;
    }
    setReading(true);
    try {
      // Down to 1024px and quality 0.7 — enough for the model to read the
      // subject, small enough that the request is a couple of hundred KB.
      const { base64, dataUrl } = await compressToJpeg(file, 1024, 0.7);
      if (!base64) throw new Error("empty");
      // Always JPEG after this, whatever went in — including HEIC, which the
      // canvas decode normalises for free and which no upstream here accepts.
      onChange({ mimeType: "image/jpeg", data: base64, previewUrl: dataUrl });
    } catch {
      // The commonest real cause is a format the browser will not decode
      // (some HEIC variants on some Androids), so the sentence names a way out
      // rather than blaming the person.
      toast.error("Couldn't read that picture. Try a JPG or PNG.");
    } finally {
      setReading(false);
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {value ? (
        <span className="relative shrink-0">
          <img
            src={value.previewUrl}
            alt="The picture you attached"
            className="h-14 w-14 rounded-xl object-cover"
          />
          <button
            type="button"
            data-testid="attach-image-remove"
            onClick={() => onChange(null)}
            aria-label="Remove the attached picture"
            // -end-1.5/-top-1.5 puts the target half outside the thumbnail so
            // it never covers the picture it is about to remove.
            className="press absolute -end-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-foreground text-background"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      ) : null}

      <input
        ref={galleryRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          void accept(e.target.files?.[0]);
          // Reset, or picking the SAME file twice fires no change event and
          // the control looks broken after a remove-then-reattach.
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept={ACCEPT}
        // `capture` opens the camera directly on a phone and is ignored on a
        // desktop, where this button degrades to a second file picker.
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        data-testid="attach-image-pick"
        disabled={disabled || reading}
        onClick={() => galleryRef.current?.click()}
        // normal-case against the app-wide `button { text-transform: uppercase }`
        // rule: the reference draws "Add image", not "ADD IMAGE", and a shouted
        // secondary control competes with the primary one beside it.
        className="press inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-2 text-[13px] font-medium normal-case tracking-normal text-foreground disabled:opacity-50"
      >
        <ImagePlus className="h-4 w-4" aria-hidden="true" />
        {reading ? "Reading…" : value ? "Change" : label}
      </button>
      <button
        type="button"
        data-testid="attach-image-camera"
        disabled={disabled || reading}
        onClick={() => cameraRef.current?.click()}
        aria-label="Take a photo"
        className="press grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border-strong text-foreground disabled:opacity-50"
      >
        <Camera className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
