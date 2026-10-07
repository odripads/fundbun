import type { PersonaScript } from '../script-types'
import { ARIF } from './arif'
import { MEI } from './mei'

export const SCRIPTS: readonly PersonaScript[] = [MEI, ARIF]

export function getScript(personaId: string | undefined): PersonaScript | undefined {
  return personaId ? SCRIPTS.find((s) => s.def.id === personaId) : undefined
}
