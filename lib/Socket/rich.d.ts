type SocketRich = {
    user?: {
        id?: string;
    };
    relayMessage: (jid: string, message: any, opts: any) => Promise<any>;
    sendMessage: (jid: string, content: any, opts?: any) => Promise<any>;
};
type Opsi = {
    atas?: string;
    bawah?: string;
    quoted?: any;
    rich?: boolean;
};
export declare const bikinRich: (sock: SocketRich) => {
    sendTable: (jid: string, title: string, header: string[], baris: string[][], opsi?: Opsi) => Promise<any>;
    sendList: (jid: string, title: string, item: [string, string][], opsi?: Opsi) => Promise<any>;
    sendCodeBlock: (jid: string, isi: string, opsi?: Opsi & {
        language?: string;
    }) => Promise<any>;
};
export {};
//# sourceMappingURL=rich.d.ts.map