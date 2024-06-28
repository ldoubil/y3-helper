import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { env } from '../env';
import { addNewEditorTableItemInProject } from './editorTableUtility';
import { Table } from '../constants';
import { isPathValid, isJson, getFileNameByVscodeUri, hash, toUnicodeIgnoreASCII } from '../utility';
import * as y3 from 'y3-helper';


export class EditorTableDataProvider implements vscode.TreeDataProvider<FileNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<FileNode | undefined> = new vscode.EventEmitter<FileNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<FileNode | undefined> = this._onDidChangeTreeData.event;
  private editorTablePath: string = "";
  
  constructor() {
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showErrorMessage("当前未打开工作目录");
      return;
    }

    this.editorTablePath = env.editorTablePath;
  }
  

  /**
   * 为选择的节点添加新的物编数据(节点只能为九类物编数据文件夹)
   * @returns true or false 成功或失败
   */
  public createNewTableItemByFileNode(fileNode: FileNode,name:string) :boolean{
    let editorTableType = Table.name.fromCN[fileNode.label as Table.NameCN];
    if (!editorTableType) {
      return false;
    }
    if (addNewEditorTableItemInProject(editorTableType as Table.NameEN, name)) {
      this.refresh();
      return true;
    }
    return false;
  }
  /**
   * 重命名Y3项目中的物编项目
   * @returns true or false 成功或失败
   */
  public async renameEditorTableItemByFileNode(fileNode: FileNode, newName: string):Promise<boolean> {
    if (!fileNode.name) {
      vscode.window.showErrorMessage("该节点没有名称");
      return false;
    }
    let success = false;
    try {
      let newNameHashcode = hash(newName);
      let editorTableJsonStr = await fs.promises.readFile(fileNode.resourceUri.fsPath, 'utf8');
      let editorTableJson = JSON.parse(editorTableJsonStr);
      let k = y3.language.fetch(newName);
      if (!k) {
        return false;
      }
      editorTableJson['name'] = k;
      await fs.promises.writeFile(fileNode.resourceUri.fsPath, toUnicodeIgnoreASCII(JSON.stringify(editorTableJson, null, 2)), 'utf8');
      this.refresh();
      success = true;
    }
    catch (error) {
      vscode.window.showErrorMessage("重命名物编项目时出错，错误为：" + error);
    }
    return success;
  }
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
  getParent(element: FileNode): vscode.ProviderResult<FileNode> {
    return Promise.resolve(element.parent);
  }
  
  getTreeItem(element: FileNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FileNode): Promise<FileNode[]> {
    if (!this.editorTablePath || this.editorTablePath === "") {
      vscode.window.showInformationMessage("未找到物编数据,请检查是否初始化开发环境");
      return [];
    }

    const files = await fs.promises.readdir(element ? element.resourceUri.fsPath : this.editorTablePath);
    const fileNodes: FileNode[] = [];

    for (const file of files) {
      const filePath = path.join(element ? element.resourceUri.fsPath : this.editorTablePath, file);
      const stat = await fs.promises.stat(filePath);

      // 如果这个是物编数据的Json文件 那么它的label就需要加上其名称
      let label: string = file;
      if (isJson(filePath)) {
        let editorTableJsonData: any;
        try {
          editorTableJsonData = await fs.promises.readFile(filePath, 'utf8');
        }
        catch (error) {
          vscode.window.showErrorMessage("读取" + filePath + "时出错");
        }

        let editorTableJson: any = undefined;
        try {
          editorTableJson = JSON.parse(editorTableJsonData);

        }
        catch (error) {
          vscode.window.showErrorMessage("读取" + filePath + "时失败，错误为：" + error);
        }
        let name;
        if (editorTableJson.hasOwnProperty('name')) {
          let nameKey: any = editorTableJson['name'];
          name = y3.language.get(nameKey);
        }
        if (name !== undefined && typeof name === "string") {
          label = name + "(" + label.substring(0, label.length - 5) + ")";//显示为"这是一个单位(134219828)"的格式
        }
        let uid = editorTableJson['uid'];
        if (isNaN(uid)) {
          continue;
        }
      
        const fileNode = new FileNode(
          element,
          label,
          stat.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          stat.isDirectory() ? vscode.Uri.file(filePath) : vscode.Uri.file(filePath),
          stat.isDirectory(),
          uid,
          name
        );
        fileNodes.push(fileNode);
      }
      else if (stat.isDirectory()) {
        if (label in Table.path.toCN) {
          label = Table.path.toCN[label as Table.Path];
          const files = await fs.promises.readdir(filePath);// 检查此目录下有多少个物编文件
          label += '(' + files.length + ')';//显示为 单位(10) 括号内的数字为有多少个物编项目
          const fileNode = new FileNode(
            element,
            label,
            stat.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            stat.isDirectory() ? vscode.Uri.file(filePath) : vscode.Uri.file(filePath),
            stat.isDirectory()
          );
          fileNodes.push(fileNode);
        }
        else {
          continue;
        }
      }
      
    };

    return Promise.resolve(fileNodes);
  }
}

export class FileNode extends vscode.TreeItem {
  constructor(
    public readonly parent:FileNode|undefined,
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly resourceUri: vscode.Uri,
    public readonly isDirectory: boolean,
    public readonly uid?: number,// 物编项目的uid
    public readonly name?:string // 物编项目的名称
  ) {
    super(label, collapsibleState);
    this.resourceUri = resourceUri;
    this.isDirectory = isDirectory;
    this.command = isDirectory ? undefined : {
      command: 'vscode.open',
      title: '打开文件',
      arguments: [resourceUri]
    };
    if (this.isDirectory) {
      this.contextValue = 'directory';
    }
    else if (isJson(resourceUri.fsPath)) {
      this.contextValue = 'json';
    }
    else {
      this.contextValue = 'otherTypes';
    }
  }
}

/**
 * 提供物编数据对应的Json文件的SymbolProvider
 */
export class GoEditorTableSymbolProvider implements vscode.WorkspaceSymbolProvider {

  private async searchEditorTableItemsInFolder(pathStr: string,query:string): Promise<vscode.SymbolInformation[]> {
    let res: vscode.SymbolInformation[] = [];
    const files = await fs.promises.readdir(pathStr);
    for (const file of files) {
      const filePath: string = path.join(pathStr, file);
      
      if (isJson(filePath)) {
        let editorTableJsonData: any;
        let label = file;
        try {
          editorTableJsonData = await fs.promises.readFile(filePath, 'utf8');
        }
        catch (error) {
          vscode.window.showErrorMessage("读取" + filePath + "时出错");
        }

        let editorTableJson: any = undefined;
        try {
          editorTableJson = JSON.parse(editorTableJsonData);

        }
        catch (error) {
          vscode.window.showErrorMessage("读取" + filePath + "时失败，错误为：" + error);
        }
        let name;
        if (editorTableJson.hasOwnProperty('name')) {
          let nameKey: any = editorTableJson['name'];
          name = y3.language.get(nameKey);
        }
        if (name !== undefined && typeof name === "string") {
          label = name + "(" + label.substring(0, label.length - 5) + ")";//显示为"这是一个单位(134219828)"的格式
        }

        
        if (label.includes(query)) {
          let editorTableJsonName = label;
          let editorTableJsonKind = vscode.SymbolKind.File;

          let editorTableJsonUri: vscode.Uri = vscode.Uri.file(filePath);
          let editorTableJsonLocation: vscode.Location = new vscode.Location(editorTableJsonUri, new vscode.Position(0, 0));
          let containerName = '';
          let symbolInformation: vscode.SymbolInformation = new vscode.SymbolInformation(
            editorTableJsonName,
            editorTableJsonKind,
            containerName,
            editorTableJsonLocation
          );
          res.push(symbolInformation);
        }
      }
    };
      

    return res;
    
  }
  public async provideWorkspaceSymbols(
    query: string, token: vscode.CancellationToken):
    Promise<vscode.SymbolInformation[]> {
    let res: vscode.SymbolInformation[] = [];
    if (token.isCancellationRequested||query.length===0) {
      return Promise.resolve(res);
    }

    //只搜索九个文件夹下对应的九类类物编数据，不递归搜索子文件夹
    for (let key in Table.path.toCN) {
      res=res.concat(await this.searchEditorTableItemsInFolder(path.join(env.editorTablePath, key), query));
    }
    
    

    return Promise.resolve(res);
  }
}



/**
 * 提供物编数据的Json文件内的中英文字段搜索的DocumentSymbolProvider
 */
export class GoEditorTableDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  private englishKeyToChineseKey: any;
  constructor(private zhlanguageJson: any = undefined ) {
    let englishKeyToChineseKeyJsonPath = path.join(__dirname, "../../config/englishKeyToChineseKey.json");
    if (isPathValid(englishKeyToChineseKeyJsonPath)) {
      try {
        this.englishKeyToChineseKey = JSON.parse(fs.readFileSync(englishKeyToChineseKeyJsonPath, 'utf8'));
      }
      catch (error) {
        vscode.window.showErrorMessage("读取和解析" + englishKeyToChineseKeyJsonPath + "时失败，错误为：" + error);
      }
    }
    else {
      vscode.window.showErrorMessage("在以下路径找不到englishKeyToChineseKey.json:\n"+englishKeyToChineseKeyJsonPath);
    }
  }
  public provideDocumentSymbols(
    document: vscode.TextDocument, token: vscode.CancellationToken):
    Thenable<vscode.SymbolInformation[]> {
    let res: vscode.SymbolInformation[] = [];
    if (token.isCancellationRequested) {
      return Promise.resolve(res);
    }
    res=this.getEditorTableJsonDocumentSymbols(document);

    return Promise.resolve(res);
  }
  private getEditorTableJsonDocumentSymbols(document: vscode.TextDocument): vscode.SymbolInformation[] {
    let res: vscode.SymbolInformation[] = [];
    const keyToLine: { [key: string]: number } = {};
    let editorTableJsonData:any = JSON.parse(document.getText());
    for (let i = 0; i < document.lineCount; i++){
      let line = document.lineAt(i).text;
      const matches = line.match(/"\s*([^"]+)"\s*(?=:)/g);// 正则表达式匹配双引号内，且后缀为':'的字符串，视为Json的键
      if (matches) {
        matches.forEach(match => {
          match = match.substring(1, match.length - 1);
          keyToLine[match] = i;
        });
      };
    }
    let fileName: string = getFileNameByVscodeUri(vscode.Uri.file(document.fileName));
    let chineseName = this.zhlanguageJson[editorTableJsonData['name']];
    let finalFileName = fileName;
    if (chineseName !== undefined && typeof chineseName === 'string') {
      finalFileName = chineseName + "(" + fileName.substring(0, fileName.length - 5) + ")";//这是一个单位(134219828)"的格式
    }
    for (let key in keyToLine) {
      let name = key;
      let kind: vscode.SymbolKind;
      
      if (typeof editorTableJsonData[key] === typeof []) {
        kind = vscode.SymbolKind.Array;
      }
      else if (typeof editorTableJsonData[key]===typeof {} ) {
        kind = vscode.SymbolKind.Module;
      }
      else if (typeof editorTableJsonData[key] === typeof true) {
        kind = vscode.SymbolKind.Boolean;
      }
      else if (!isNaN(editorTableJsonData[key])) {
        kind = vscode.SymbolKind.Number;
      }
      else if (typeof editorTableJsonData[key] === typeof "") {
        kind = vscode.SymbolKind.String;
      }
      else {
        kind = vscode.SymbolKind.Module;
      }

      let uri: vscode.Uri = document.uri;
      let location: vscode.Location = new vscode.Location(document.uri, new vscode.Position(keyToLine[key], 0));
      let containerName = finalFileName;
      if (key in this.englishKeyToChineseKey) {
        // todo:获得字段对应的中文名
        name = this.englishKeyToChineseKey[key] + '(' + key + ')';
        let symbolInformation: vscode.SymbolInformation = new vscode.SymbolInformation(
          name,
          kind,
          containerName,
          location
        );
        res.push(symbolInformation);
      }
      
    }
    
    return res;
  }
}
