// Share-sheet subject/body defaults for the CV PDF.
// Kept in its own light module so UI can import it without pulling in jsPDF.

export type CvShareMessage = { title: string; text: string };

export function defaultCvShareMessage(fullName?: string): CvShareMessage {
  const name = (fullName ?? "").trim();
  return {
    title: name ? `${name} — CV` : "My CV",
    text: name ? `Hi, please find ${name}'s CV attached.` : "Hi, please find my CV attached.",
  };
}
