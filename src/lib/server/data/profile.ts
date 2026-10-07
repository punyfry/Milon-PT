import { assertValid, validateProfile, type Profile } from '../../model';
import type { StoredJson, UserStorage } from '../storage/types';

const PATH = 'profile.json';

/** Returns an empty profile (without version) if none exists yet. */
export async function getProfile(storage: UserStorage): Promise<{ data: Profile; version?: string }> {
	const file = await storage.readJson<unknown>(PATH);
	if (!file) return { data: {} };
	return { data: assertValid('profil', file.data, validateProfile), version: file.version };
}

/** `version` from the read; if omitted the profile is created (and fails if it already exists). */
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
