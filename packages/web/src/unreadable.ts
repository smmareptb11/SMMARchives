import { ApiError } from './problems.ts'

export type Unreadable = {
  title: string
  /** What happened, and what the reader can do about it. */
  said: string
  /** Whether to offer the sign-in: to anyone not signed in, whatever kept the replay out of sight. */
  signIn: boolean
  /** Whether asking again could show it: the API did not answer, or failed on its own side. */
  retry: boolean
}

/**
 * Why a replay cannot be shown, in the interface's language, or undefined while
 * that rests on a session not yet settled. The API answers a replay a stranger
 * may not see as one that does not exist, so a stranger's 404 is both. The API's
 * own words, written for whoever repairs, are never shown.
 */
export function unreadableReplay(
  error: unknown,
  signedIn: boolean | undefined,
): Unreadable | undefined {
  if (signedIn === undefined) return undefined
  const signIn = !signedIn
  const said = saidOf(error, signedIn)
  return { ...said, signIn: signIn || said.signIn === true, retry: said.retry === true }
}

type Said = { title: string; said: string; signIn?: boolean; retry?: boolean }

function saidOf(error: unknown, signedIn: boolean): Said {
  const status = error instanceof ApiError ? error.problem.status : undefined
  // No replay can have it: the identifier in the address is not one the database mints.
  if (status === 400) {
    return {
      title: 'Cette adresse ne mène à aucun rejeu',
      said: 'L’identifiant du rejeu y est incomplet ou mal recopié. Vérifiez le lien suivi, ou retrouvez le rejeu dans la liste.',
    }
  }
  if (status === 404 && signedIn) {
    return {
      title: 'Ce rejeu n’existe pas',
      said: 'Il a peut-être été supprimé, ou l’adresse suivie est incomplète. Les rejeux qui existent sont tous dans la liste.',
    }
  }
  if (status === 404) {
    return {
      title: 'Ce rejeu n’est pas accessible',
      said: 'Il n’existe pas, ou il n’est pas encore public : un rejeu en préparation ne se consulte qu’une fois connecté en administrateur.',
    }
  }
  if (status === 401) {
    return {
      title: 'Votre session a expiré',
      said: 'Reconnectez-vous pour consulter ce rejeu.',
      signIn: true,
    }
  }
  if (status !== undefined) {
    return {
      title: 'Ce rejeu ne peut pas être affiché',
      said: 'Le serveur n’a pas pu le lire. Réessayez dans un instant ; si cela persiste, signalez-le à l’administrateur en lui indiquant le rejeu demandé.',
      retry: true,
    }
  }
  return {
    title: 'Le serveur ne répond pas',
    said: 'L’application n’a pas pu joindre son serveur. Vérifiez votre connexion, puis réessayez.',
    retry: true,
  }
}

/**
 * Whether the session must be asked again before saying anything: expired, it
 * gets the administrator answered as a stranger, and « does not exist » said of a
 * replay that is only unpublished.
 */
export function confirmsSession(error: unknown, signedIn: boolean | undefined): boolean {
  return error instanceof ApiError && error.problem.status === 404 && signedIn === true
}
