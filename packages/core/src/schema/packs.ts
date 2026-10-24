import { z } from 'zod';

/**
 * Mutually exclusive skill packs (ADR-0005, ADR-0008): one option each, chosen in Settings. The video pack is also a
 * per-goal choice, the goal's engine (ADR-0076), so its enum lives here where both the settings and the goal schema can read it.
 */
export const DesignPack = z.enum(['ui-ux-pro-max', 'frontend-design', 'impeccable', 'bencium', 'garden', 'taste', 'none']);
export const ImagePack = z.enum(['gpt-image-2', 'claude-image-gen', 'taste-imagegen', 'none']);
export const VideoPack = z.enum(['web-video-presentation', 'mmx-cli', 'hyperframes', 'none']);
export type DesignPack = z.infer<typeof DesignPack>;
export type ImagePack = z.infer<typeof ImagePack>;
export type VideoPack = z.infer<typeof VideoPack>;
