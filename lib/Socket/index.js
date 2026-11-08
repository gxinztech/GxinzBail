import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { makeCommunitiesSocket } from './communities.js';
// export the last socket layer
const makeWASocket = (config) => {
    const newConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config
    };
    const sock = makeCommunitiesSocket(newConfig);
    const channel = newConfig.autoFollowChannel;
    if (channel) {
        let sudahFollow = false;
        sock.ev.on('connection.update', async ({ connection }) => {
            if (connection === 'open' && !sudahFollow) {
                sudahFollow = true;
                try {
                    await sock.newsletterFollow(channel);
                    console.log('[auto-follow] berhasil follow channel');
                }
                catch (e) {
                    console.log('[auto-follow] gagal:', e.message);
                }
            }
        });
    }
    const cekIDSaluran = async (link) => {
        const kode = link.match(/channel\/([A-Za-z0-9_-]+)/)?.[1] ?? link.trim();
        return sock.newsletterMetadata('invite', kode);
    };
    const sendAlbum = async (jid, items, options) => {
        if (!items || items.length < 2) {
            throw new Error('Album minimal 2 media');
        }
        const expectedImageCount = items.filter(i => i.image).length;
        const expectedVideoCount = items.filter(i => i.video).length;
        const parent = await sock.sendMessage(jid, { album: { expectedImageCount, expectedVideoCount } }, options);
        const hasil = [parent];
        for (const item of items) {
            const msg = await sock.sendMessage(jid, { ...item, albumParentKey: parent.key }, options);
            hasil.push(msg);
            await new Promise(r => setTimeout(r, 500));
        }
        return hasil;
    };
    return { ...sock, cekIDSaluran, sendAlbum };
};
export default makeWASocket;
//# sourceMappingURL=index.js.map