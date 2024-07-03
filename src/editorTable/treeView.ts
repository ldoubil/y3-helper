import * as vscode from 'vscode';
import { GoEditorTableDocumentSymbolProvider, GoEditorTableSymbolProvider } from './fileView';
import { env } from '../env';
import { Table } from '../constants';
import * as editorTable from './editorTable';
import { throttle } from '../utility/decorators';

class FileNode extends vscode.TreeItem {
    readonly contextValue = 'json';
    constructor(
        public parent: DirNode,
        public tableName: Table.NameCN,
        public key: number,
    ) {
        super(`加载中...(${key})`);

        this.id = `${tableName}/${key}`;
    }

    public update(): void | Promise<void> {
        let table = editorTable.open(this.tableName);
        let object = table.fetch(this.key);
        if (object) {
            this.label = `${object.name}(${this.key})`;
            this.resourceUri = object.uri;
            this.command = {
                command: 'vscode.open',
                title: '打开文件',
                arguments: [object.uri],
            };
            return;
        } else if (object === undefined) {
            return new Promise<void>(async resolve => {
                await table.get(this.key);
                resolve();
            });
        }
    }
}

class DirNode extends vscode.TreeItem {
    readonly contextValue = 'directory';
    readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    readonly table: editorTable.EditorTable<any>;
    constructor(
        public tableName: Table.NameCN,
    ) {
        super(`${tableName}(加载中...)`);

        this.table = editorTable.open(tableName);
        this.resourceUri = this.table.uri;
        this.id = tableName;
    }

    public update(): void | Promise<void> {
        let list = this.table.fetchList();
        if (list) {
            this.label = `${this.tableName}(${list.length})`;
            return;
        } else {
            return new Promise<void>(async resolve => {
                await this.table.getList();
                resolve();
            });
        }
    }

    public async getChildren(): Promise<FileNode[]> {
        let nodes: FileNode[] = [];
        let table = editorTable.open(this.tableName);
        let keys = await table.getList();
        for (const key of keys) {
            nodes.push(new FileNode(this, this.tableName, key));
        }
        return nodes;
    }
}

type TreeNode = FileNode | DirNode;

class TreeViewProvider extends vscode.Disposable implements vscode.TreeDataProvider<TreeNode>  {
    constructor() {
        super(() => {
            this.disposables.forEach(d => d.dispose());
        });
    }

    private dirNodes?: DirNode[];
    private disposables: vscode.Disposable[] = [];

    private getRoot(): DirNode[] {
        if (this.dirNodes) {
            return this.dirNodes;
        }
        this.dirNodes = [];
        for (const nameCN in Table.name.fromCN) {
            let dirNode = new DirNode(nameCN as Table.NameCN);
            this.dirNodes.push(dirNode);

            this.disposables.push(dirNode.table.onDidChange(() => {
                this.refresh(dirNode);
            }));
        }
        return this.dirNodes;
    }

    public async getChildren(node?: TreeNode | undefined) {
        if (!env.editorTableUri) {
            return;
        }
        if (node === undefined) {
            return this.getRoot();
        } else if(node instanceof DirNode) {
            return await node.getChildren();
        } else {
            return undefined;
        }
    }

    public getTreeItem(node: TreeNode) {
        let promise = node.update();
        if (promise) {
            promise.then(() => this.refreshAll());
        }
        return node;
    }

    private _onDidChange = new vscode.EventEmitter<TreeNode|undefined>();
    readonly onDidChangeTreeData = this._onDidChange.event;
    public refresh(node?: TreeNode) {
        this._onDidChange.fire(node);
    }

    @throttle(200)
    public refreshAll() {
        this.refresh(undefined);
    }
}

class TreeView extends vscode.Disposable {
    constructor() {
        super(() => {
            this.disposables.forEach(d => d.dispose());
        });
        this.disposables.push(this.provider = new TreeViewProvider());

        this.disposables.push(this.treeView = vscode.window.createTreeView('y3-helper.editorTableView', {
            treeDataProvider: this.provider,
            showCollapseAll: true,
        }));

        env.onDidChange(() => this.refresh());

        // 刷新按钮
        this.disposables.push(vscode.commands.registerCommand('y3-helper.refreshTableViewer', () => this.provider.refresh()));

        // 内置的刷新命令
        this.disposables.push(vscode.commands.registerCommand('y3-helper.editorTableView.refresh', () => this.provider.refresh()));

        // 打开文件
        this.disposables.push(vscode.commands.registerCommand('y3-helper.openFile', async (fileNode: FileNode) => {
            if (!fileNode.resourceUri) {
                return;
            }
            vscode.commands.executeCommand('vscode.open', fileNode.resourceUri);
        }));
        
        // 在Windows中浏览
        vscode.commands.registerCommand("y3-helper.revealInFileExplorer", (fileNode: FileNode) => {
            vscode.commands.executeCommand('revealFileInOS', fileNode.resourceUri);
        });
    }

    async refresh() {
        await env.mapReady();
        this.provider.refresh();
    }

    private provider: TreeViewProvider;
    private treeView: vscode.TreeView<TreeNode>;
    private disposables: vscode.Disposable[] = [];
}

export async function init() {
    await env.mapReady();

    let treeView = new TreeView();

    // const goEditorTableSymbolProvider = new GoEditorTableSymbolProvider();
    
    // vscode.languages.registerWorkspaceSymbolProvider(goEditorTableSymbolProvider);

    // const goEditorTableDocumentSymbolProvider = new GoEditorTableDocumentSymbolProvider();
    // let sel: vscode.DocumentSelector = { scheme: 'file', language: 'json' };
    // vscode.languages.registerDocumentSymbolProvider(sel, goEditorTableDocumentSymbolProvider);


    // 右键菜单的命令注册
    // vscode.commands.registerCommand("y3-helper.deleteEditorTableItem", (fileNode: FileNode) => {
    //     try {
    //         vscode.workspace.fs.delete(fileNode.resourceUri);
    //     }
    //     catch (error) {
    //         vscode.window.showErrorMessage("删除失败，错误为" + error);
    //     }
    //     //editorTableDataProvider.refresh();
    // });

    // vscode.commands.registerCommand("y3-helper.copyTableItemUID", (fileNode: FileNode) => {
    //     if (fileNode.uid) {
    //         vscode.env.clipboard.writeText(String(fileNode.uid));
    //     }
    // });

    // vscode.commands.registerCommand("y3-helper.copyTableItemName", (fileNode: FileNode) => {
    //     if (fileNode.name) {
    //         vscode.env.clipboard.writeText(fileNode.name);
    //     }
    // });

    // vscode.commands.registerCommand("y3-helper.addNewEditorTableItem", async (fileNode: FileNode) => {
    //     await env.mapReady(true);
    //     const inputOptions: vscode.InputBoxOptions = {
    //         prompt: '名称',
    //         value: fileNode.name,
    //         placeHolder: '名称',
    //         validateInput: (text: string) => {
    //             if (text.length === 0) {
    //                 return "输入的内容为空";
    //             }
    //             return null;
    //         }
    //     };
    //     vscode.window.showInputBox(inputOptions).then(
    //         value => {
    //             if (value) {
    //                 if (editorTableDataProvider.createNewTableItemByFileNode(fileNode,value)) {
    //                     vscode.window.showInformationMessage("成功创建"+fileNode.label+":" + value);
    //                 }
    //             }
    //         }
    //     );
    // });

    // vscode.commands.registerCommand("y3-helper.renameEditorTableItem", (fileNode: FileNode) => {
    //     const inputOptions: vscode.InputBoxOptions = {
    //         prompt: '修改后的新名称',
    //         value: fileNode.name,
    //         placeHolder: '新名称',
    //         validateInput: (text: string) => {
    //             if (text.length === 0) {
    //                 return "输入的内容为空";
    //             }
    //             return null;
    //         }
    //     };
    //     vscode.window.showInputBox(inputOptions).then(
    //         value => {
    //             if (value) {
    //                 editorTableDataProvider.renameEditorTableItemByFileNode(fileNode, value);
    //             }
    //         }
    //     );
    // });
}
