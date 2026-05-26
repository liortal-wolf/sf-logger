import type { LearnedMapping } from '../types';

const STORAGE_KEY = 'learned_mappings';

type MappingsMap = Record<string, LearnedMapping>;

export function listMappings(): MappingsMap {
  return GM_getValue<MappingsMap>(STORAGE_KEY, {});
}

export function getMappingFor(discordUsername: string): LearnedMapping | null {
  const all = listMappings();
  return all[discordUsername] ?? null;
}

export function recordMapping(
  discordUsername: string,
  oppId: string,
  oppName: string
): void {
  const all = listMappings();
  all[discordUsername] = {
    oppId,
    oppName,
    lastUsed: new Date().toISOString()
  };
  GM_setValue(STORAGE_KEY, all);
}
