import { env } from '../env';
import { randomInt } from '../utility';
import * as tools from '../tools';
import { ConsoleServer } from './server';
import { registerMethod } from './client';
import * as debug from '../debug';

function setPort(port: number) {
    if (!env.scriptUri) {
        return;
    }
    tools.writeFile(env.scriptUri, 'log/helper_port.lua', `return ${port}`);
}

let server: ConsoleServer | undefined;

function registerAllMethods() {
    interface PrintParams {
        message: string;
    }

    registerMethod('print', async (client, params: PrintParams) => {
        client.print(params.message);
    });

    interface CreateTreeViewParams {
        id: number;
        name: string;
        root: number;
    }

    registerMethod('createTreeView', async (client, params: CreateTreeViewParams) => {
        await client.treeViewManager.createTreeView(params.id, params.name, params.root);
    });

    interface RemoveTreeViewParams {
        id: number;
    }

    registerMethod('removeTreeView', async (client, params: RemoveTreeViewParams) => {
        client.treeViewManager.removeTreeView(params.id);
    });

    interface refreshTreeNodeParams {
        id: number;
    }

    registerMethod('refreshTreeNode', async (client, params: refreshTreeNodeParams) => {
        client.treeViewManager.refreshTreeNode(params.id);
    });

    registerMethod('startDebuggerAttach', async (client) => {
        try {
            let suc = await debug.attach();
            if (suc) {
                return {
                    suc: true,
                };
            } else {
                return {
                    suc: false,
                    err: '启动调试器失败',
                };
            }
        } catch(e) {
            return {
                suc: false,
                err: (e instanceof Error) ? e.message : e!.toString(),
            };
        }
    });

    registerMethod('stopDebugger', async (client) => {
        try {
            await debug.stop();
            return {
                suc: true,
            };
        } catch(e) {
            return {
                suc: false,
                err: (e instanceof Error) ? e.message : e!.toString(),
            };
        }
    });
}

export function init() {
    registerAllMethods();

    let port = randomInt(10000, 65535);

    server = new ConsoleServer(port);

    env.onDidChange(() => {
        setPort(port);
    });
    setPort(port);
}

export function getServer(): ConsoleServer {
    if (!server) {
        init();
    }
    return server!;
}
