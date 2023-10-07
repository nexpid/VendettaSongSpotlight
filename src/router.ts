import { DiscordSnowflake } from '@sapphire/snowflake';
import { IRequest, Router } from 'itty-router';
import Responses from './responses';
import constants from './constants';
import { getUserId, grantCode, refreshToken } from './api/discord';
import { deleteSave, getSave, setSave } from './api/db';
import { API } from './api/types';
import { validateSong } from './songs';

const makeResponse = (status: number, message: string, error?: any) =>
	new Response(JSON.stringify({ message, status, error: error?.toString() }), { status });
const jsonResponse = (json: any) => new Response(JSON.stringify(json), { status: 200 });

const isAuthorizedMw = async (req: IRequest, env: Env) => {
	const auth = req.headers.get('authorization') as string;
	if (typeof auth !== 'string') return makeResponse(401, Responses.Unauthorized);

	const userId = await getUserId(auth);
	if (!userId) return makeResponse(401, Responses.FailedToAuthorize);

	req.userId = userId;
	req.save = await getSave(env, userId);
};

const router = Router();

// oauth2 stuff
router.get('/api/get-oauth2-url', () => {
	const query = new URLSearchParams();
	query.append('client_id', constants.oauth2.clientId);
	query.append('redirect_uri', constants.oauth2.redirectURL);
	query.append('response_type', 'code');
	query.append('scope', ['identify'].join(' '));

	return Response.redirect(`https://discord.com/api/oauth2/authorize?${query.toString()}`);
});

router.get('/api/get-access-token', async (req, env) => {
	const { code } = req.query;
	if (typeof code !== 'string') return makeResponse(400, Responses.InvalidQuery);

	let auth;
	try {
		auth = await grantCode(env, code);
	} catch (e) {
		console.log(e);
		return makeResponse(401, Responses.FailedToAuthorize, e);
	}
	if (!auth || 'error' in auth || !auth.access_token || !auth.refresh_token)
		return makeResponse(401, Responses.FailedToAuthorize, 'error' in auth && auth.error);

	return jsonResponse({
		accessToken: auth.access_token,
		refreshToken: auth.refresh_token,
		expiresAt: Date.now() + auth.expires_in * 1000 - 5_000,
	});
});
router.get('/api/refresh-access-token', async (req, env) => {
	const { refresh_token: token } = req.query;
	if (typeof token !== 'string') return makeResponse(400, Responses.InvalidQuery);

	let auth;
	try {
		auth = await refreshToken(env, token);
	} catch (e) {
		console.log(e);
		return makeResponse(401, Responses.FailedToAuthorize, e);
	}
	if (!auth || 'error' in auth || !auth.access_token || !auth.refresh_token)
		return makeResponse(401, Responses.FailedToAuthorize, 'error' in auth && auth.error);

	return jsonResponse({
		accessToken: auth.access_token,
		refreshToken: auth.refresh_token,
		expiresAt: Date.now() + auth.expires_in * 1000 - 5_000,
	});
});

// db
router.get('/api/get-profile-data', async (req, env: Env) => {
	const id = req.query.id?.toString();
	if (!id || !/^\d{17,20}$/.test(id)) return makeResponse(400, Responses.InvalidQuery);

	return jsonResponse(await getSave(env, id));
});

router.get('/api/get-data', isAuthorizedMw, (req) => {
	return jsonResponse(req.save);
});
router.post(
	'/api/sync-data',
	async (req) => {
		try {
			let parsed: API.Save['songs'];
			try {
				parsed = await req.json();
			} catch {
				return makeResponse(400, Responses.InvalidBody);
			}

			let isValid = true;
			const nw = new Array<API.Song | null>();

			if (!Array.isArray(parsed)) isValid = false;
			else {
				if (isValid) isValid = parsed.length === 5;
				for (const s of parsed) {
					if (!isValid) break;
					if ((s !== null && typeof s !== 'object') || Array.isArray(s)) {
						isValid = false;
						break;
					}
					if (s !== null) {
						if (s.service !== 'spotify' || !['track', 'album', 'playlist'].includes(s.type) || typeof s.id !== 'string') {
							isValid = false;
							break;
						}

						const valid = await validateSong(s.service, s.type, s.id);
						if (!valid) {
							nw.push(null);
							continue;
						}
					}

					nw.push(s ? { service: s.service, type: s.type, id: s.id } : null);
				}
			}

			if (!isValid) return makeResponse(400, Responses.InvalidBody);

			req.parsed = nw;
		} catch (e: any) {
			return makeResponse(500, Responses.UnknownError, `c1: ${e?.message ?? String(e)}`);
		}
	},
	isAuthorizedMw,
	async (req, env) => {
		const save = req.save as API.Save;
		save.songs = req.parsed;

		return (await setSave(env, save.user, save)) ? jsonResponse(save) : makeResponse(500, Responses.FailedToSave);
	}
);
router.delete('/api/delete-data', isAuthorizedMw, async (req, env) => {
	const save = req.save as API.Save;

	return (await deleteSave(env, save.user)) ? jsonResponse(true) : makeResponse(500, Responses.FailedToDelete);
});

router.all('*', () => makeResponse(404, Responses.NotFound));

export default router;
