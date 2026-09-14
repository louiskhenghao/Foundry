import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type RoleName = 'clarifier' | 'planner' | 'worker' | 'reviewer-task' | 'reviewer-goal' | 'merger' | 'documenter' | 'feedback';

export class Roles {
  constructor(private dir: string) {}
  path(name: RoleName): string {
    const p = join(this.dir, `${name}.md`);
    if (!existsSync(p)) throw new Error(`Role file missing: ${p}`);
    return p;
  }
  text(name: RoleName): string {
    return readFileSync(this.path(name), 'utf8');
  }
}
