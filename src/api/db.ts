import { API } from './types';

interface D1DBSave {
	user: string;
	songs: string;
}

export async function getSave(env: Env, user: string): Promise<API.Save> {
	const cmd = (await env.DB.prepare(`select * from data where user=?1`).bind(user).first()) as D1DBSave;

	return cmd
		? {
				user: cmd.user,
				songs: JSON.parse(cmd.songs),
		  }
		: {
				user,
				songs: [null, null, null, null, null],
		  };
}

export async function setSave(env: Env, user: string, save: API.Save): Promise<boolean> {
	if (!save.songs.filter((x) => !!x).length) return await deleteSave(env, user);
	return (await env.DB.prepare(`insert or replace into data (user, songs) values (?1, ?2)`).bind(user, JSON.stringify(save.songs)).run())
		.success;
}

export async function deleteSave(env: Env, user: string): Promise<boolean> {
	return (await env.DB.prepare(`delete from data where user=?1`).bind(user).run()).success;
}
