import { z } from 'zod';

/**
 * Mutually exclusive skill packs (ADR-0005, ADR-0008): one option each, chosen in Settings. The video pack is also a
 * per-goal choice, the goal's engine (ADR-0077), so its enum lives here where both the settings and the goal schema can read it.
 */
export const DesignPack = z.enum(['ui-ux-pro-max', 'frontend-design', 'impeccable', 'bencium', 'garden', 'taste', 'none']);
export const ImagePack = z.enum(['gpt-image-2', 'claude-image-gen', 'taste-imagegen', 'none']);
export const VideoPack = z.enum(['web-video-presentation', 'mmx-cli', 'hyperframes', 'motion-studio', 'none']);
export type DesignPack = z.infer<typeof DesignPack>;
export type ImagePack = z.infer<typeof ImagePack>;
export type VideoPack = z.infer<typeof VideoPack>;
/** the Diagram pack (ADR-0083): the skill that draws diagram tasks' editorial diagrams, one self-contained HTML page with an inline SVG each; `none` = no diagram skill is mandated */
export const DiagramPack = z.enum(['diagram-design', 'none']);
export type DiagramPack = z.infer<typeof DiagramPack>;
/** the Deck pack (ADR-0084): the skill that makes deck tasks' slide decks, a native PPTX each; `none` = no deck skill is mandated */
export const DeckPack = z.enum(['ppt-master', 'none']);
export type DeckPack = z.infer<typeof DeckPack>;
