// Selectable CV layout styles.
//
// A template only changes *decoration* — heading colour, rule weight, letter
// spacing, bullet glyph. Every vertical advance (line gaps, section padding,
// margins) is deliberately identical across templates so pagination behaves
// exactly the same whichever style is chosen.

export type CvTemplateId = "classic" | "modern";

export type CvTemplate = {
  id: CvTemplateId;
  label: string;
  description: string;
  /** RGB used for headings/rules. */
  accent: readonly [number, number, number];
  /** Heading text colour. */
  headingColor: readonly [number, number, number];
  /** Rule thickness in mm under each section heading. */
  ruleWidth: number;
  /** Rule colour. */
  ruleColor: readonly [number, number, number];
  /** Extra letter spacing on headings, in mm. */
  headingCharSpace: number;
  /** Bullet glyph for experience lines. */
  bullet: string;
  /** Name colour in the header block. */
  nameColor: readonly [number, number, number];
};

const BLACK = [0, 0, 0] as const;

export const CV_TEMPLATES: readonly CvTemplate[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Black serif-free ATS layout with hairline rules.",
    accent: BLACK,
    headingColor: BLACK,
    ruleWidth: 0.3,
    ruleColor: BLACK,
    headingCharSpace: 0,
    bullet: "•",
    nameColor: BLACK,
  },
  {
    id: "modern",
    label: "Modern",
    description: "Teal headings, bolder rules and wide-tracked section titles.",
    accent: [0, 132, 116],
    headingColor: [0, 132, 116],
    ruleWidth: 0.8,
    ruleColor: [0, 132, 116],
    headingCharSpace: 0.4,
    bullet: "–",
    nameColor: [17, 24, 28],
  },
];

export const CV_TEMPLATE_DEFAULT: CvTemplateId = "classic";

export function getCvTemplate(id?: CvTemplateId | null): CvTemplate {
  return CV_TEMPLATES.find((t) => t.id === id) ?? CV_TEMPLATES[0];
}

/** CSS colour string for the on-screen paper preview. */
export function rgbCss(c: readonly [number, number, number]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
