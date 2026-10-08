import { join } from 'node:path';

/** What a Transfer brought for one goal (its branch bundle, its progress folder's git-excluded files), under the data dir */
export const transferGoalDir = (dataDir: string, goalId: string) => join(dataDir, 'transfer', 'goals', goalId);
