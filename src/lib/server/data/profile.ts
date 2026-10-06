import { assertValid, validateProfile, type Profile } from '../../model';
import type { StoredJson, UserStorage } from '../storage/types';

const PATH = 'profile.json';

/** Returnerar en tom profil (utan version) om ingen finns än. */
export async function getProfile(storage: UserStorage): Promise<{ data: Profile; version?: string }> {
	const file = await storage.readJson<unknown>(PATH);
	if (!file) return { data: {} };
	return { data: assertValid('profil', file.data, validateProfile), version: file.version };
}

/** `version` från läsningen; utelämnas den skapas profilen (och misslyckas om den redan finns). */
export async function saveProfile(
	storage: UserStorage,
	profile: Profile,
	version?: string
): Promise<StoredJson<Profile>> {
	const valid = assertValid('profil', profile, validateProfile);
	const result = await storage.writeJson(
		PATH,
		valid,
		version === undefined ? { createOnly: true } : { ifMatch: version }
	);
	return { data: valid, version: result.version };
}
