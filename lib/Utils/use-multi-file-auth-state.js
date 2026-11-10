import { Mutex } from 'async-mutex';
import { randomBytes } from 'crypto';
import { chmod, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { proto } from '../../WAProto/index.js';
import { initAuthCreds } from './auth-utils.js';
import { BufferJSON } from './generics.js';
// We need to lock files due to the fact that we are using async functions to read and write files
// https://github.com/WhiskeySockets/Baileys/issues/794
// https://github.com/nodejs/node/issues/26338
// Use a Map to store mutexes for each file path
const fileLocks = new Map();
// Get or create a mutex for a specific file path
const getFileLock = (path) => {
    let mutex = fileLocks.get(path);
    if (!mutex) {
        mutex = new Mutex();
        fileLocks.set(path, mutex);
    }
    return mutex;
};
// Run `fn` under the file's lock, and drop the lock from the map once nobody uses it
// (otherwise the map grows by one entry for every key file ever touched)
const withFileLock = async (path, fn) => {
    const mutex = getFileLock(path);
    const release = await mutex.acquire();
    try {
        return await fn();
    }
    finally {
        release();
        if (!mutex.isLocked() && fileLocks.get(path) === mutex) {
            fileLocks.delete(path);
        }
    }
};
// Write to a temp file and rename it over the target. rename() is atomic, so a crash or a full disk in the
// middle of a write leaves the old file intact instead of a truncated one (which used to reset the session).
const writeFileAtomic = async (filePath, content) => {
    const tmpPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
        await writeFile(tmpPath, content, { mode: 0o600 });
        await rename(tmpPath, filePath);
    }
    catch (error) {
        await unlink(tmpPath).catch(() => { });
        throw error;
    }
};
/**
 * stores the full authentication state in a single folder.
 * Far more efficient than singlefileauthstate
 *
 * Again, I wouldn't endorse this for any production level use other than perhaps a bot.
 * Would recommend writing an auth state for use with a proper SQL or No-SQL DB
 *
 * Hardened against: partial writes (atomic rename), a corrupted creds.json (creds.json.bak fallback),
 * path tricks in remote-controlled key ids, and world-readable session files (0600/0700).
 * */
export const useMultiFileAuthState = async (folder) => {
    const root = resolve(folder);
    // keeps the old mapping (so existing sessions still load) and then strips everything else that is not safe in a file name
    const fixFileName = (file) => file
        ?.replace(/\//g, '__')
        ?.replace(/:/g, '-')
        ?.replace(/[^A-Za-z0-9._@+=\-]/g, '_'); // + and = stay: base64 key ids already use them on disk
    const safePath = (file) => {
        const filePath = resolve(root, fixFileName(file));
        if (!filePath.startsWith(root + sep)) {
            throw new Error(`refusing to access a path outside the auth folder: ${file}`);
        }
        return filePath;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writeData = async (data, file) => {
        const filePath = safePath(file);
        const json = JSON.stringify(data, BufferJSON.replacer);
        await withFileLock(filePath, async () => {
            await writeFileAtomic(filePath, json);
            // creds are the one file that cannot be re-created, so keep a second copy
            if (file === 'creds.json') {
                await writeFileAtomic(`${filePath}.bak`, json).catch(() => { });
            }
        });
    };
    const readFileParsed = async (filePath) => {
        const data = await readFile(filePath, { encoding: 'utf-8' });
        return JSON.parse(data, BufferJSON.reviver);
    };
    const readData = async (file) => {
        try {
            const filePath = safePath(file);
            return await withFileLock(filePath, async () => {
                try {
                    return await readFileParsed(filePath);
                }
                catch (error) {
                    if (file !== 'creds.json') {
                        throw error;
                    }
                    // creds.json is missing or unreadable: restore it from the backup instead of starting a brand new session.
                    // (throws when there is no usable backup, and the caller then falls back to fresh creds as before)
                    const restored = await readFileParsed(`${filePath}.bak`);
                    await writeFileAtomic(filePath, JSON.stringify(restored, BufferJSON.replacer)).catch(() => { });
                    return restored;
                }
            });
        }
        catch (error) {
            return null;
        }
    };
    const removeData = async (file) => {
        try {
            const filePath = safePath(file);
            await withFileLock(filePath, async () => {
                try {
                    await unlink(filePath);
                }
                catch {
                }
            });
        }
        catch { }
    };
    const folderInfo = await stat(folder).catch(() => { });
    if (folderInfo) {
        if (!folderInfo.isDirectory()) {
            throw new Error(`found something that is not a directory at ${folder}, either delete it or specify a different location`);
        }
    }
    else {
        await mkdir(folder, { recursive: true, mode: 0o700 });
    }
    // best effort: lock down an existing folder too, and clear temp files left behind by a crash
    await chmod(folder, 0o700).catch(() => { });
    for (const name of await readdir(folder).catch(() => [])) {
        if (name.endsWith('.tmp')) {
            await unlink(join(folder, name)).catch(() => { });
        }
    }
    const creds = (await readData('creds.json')) || initAuthCreds();
    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}.json`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const file = `${category}-${id}.json`;
                            tasks.push(value ? writeData(value, file) : removeData(file));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            return writeData(creds, 'creds.json');
        }
    };
};
//# sourceMappingURL=use-multi-file-auth-state.js.map
