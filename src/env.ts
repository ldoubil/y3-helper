import * as vscode from 'vscode';
import * as os from 'os';
import winreg from 'winreg';
import path from 'path';
import util from 'util';
import * as tools from './tools';
import { isFileValid, isPathValid, randomInt } from './utility';
import * as fs from 'fs';
import { defaultTableTypeToCSVfolderPath } from './constants';
type EditorVersion = '1.0' | '2.0' | 'unknown';



function rePrepare(method: Function, context: ClassMethodDecoratorContext) {
    let running = false;
    return async function (this: any, ...args: any[]) {
        if (running) {
            while (running) {
                await util.promisify(setTimeout)(100);
            }
        }
        running = true;
        try {
            await method.apply(this, args);
        } finally {
            running = false;
        }
    };
}

class EnvPath {
    private envChangeEmitter = new vscode.EventEmitter<void>();
    public onDidChange = this.envChangeEmitter.event;

    private async searchEditorUriByReg(): Promise<vscode.Uri | undefined> {
        let platform = os.platform();
        if (platform !== 'win32') {
            return undefined;
        };
        let regKey = new winreg({
            hive: winreg.HKLM,
            key: "\\SOFTWARE\\Classes\\y3editor",
        });
        let editorPath = await new Promise<string|undefined>((resolve, reject) => {
            regKey.get(winreg.DEFAULT_VALUE, (err, item) => {
                if (err) {
                    resolve(undefined);
                }
                resolve(item.value);
            });
        });
        if (!editorPath) {
            return undefined;
        }
        return vscode.Uri.file(editorPath);
    }

    private async isValidEditorPath(editorPath: string): Promise<boolean> {
        if (path.basename(editorPath) !== 'Editor.exe') {
            return false;
        }
        try {
            let state = await vscode.workspace.fs.stat(vscode.Uri.file(editorPath));
            if (state.type === vscode.FileType.File) {
                return true;
            }
        } catch (error) {
        }
        return false;
    }

    private async searchEditorUri(askUser = false): Promise<vscode.Uri | undefined> {
        // 先看看设置里有没有
        let editorPath: string|undefined = vscode.workspace.getConfiguration('Y3-Helper').get('EditorPath');
        if (editorPath && await this.isValidEditorPath(editorPath)) {
            return vscode.Uri.file(editorPath);
        }

        // 再看看注册表里有没有
        let editorUri = await this.searchEditorUriByReg();
        if (editorUri) {
            return editorUri;
        }

        // 如果没有，则询问用户
        while (askUser) {
            let selectedFiles = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                openLabel: '选择Y3编辑器路径',
                filters: {
                    '编辑器': ['exe']
                }
            });
            let selectedExe = selectedFiles?.[0];
            if (!selectedExe) {
                return undefined;
            }
            if (await this.isValidEditorPath(selectedExe.fsPath)) {
                await vscode.workspace.getConfiguration('Y3-Helper').update('EditorPath', selectedExe.fsPath);
                return selectedExe;
            }
        }
    }

    private async getEditorVersion(): Promise<EditorVersion> {
        if (!this.editorUri) {
            return 'unknown';
        }
        let folder = path.join(this.editorUri.fsPath, '../..');
        let folderName = path.basename(folder);
        if (folderName === '1.0') {
            return '1.0';
        };
        return '2.0';
    }

    private async searchMapPathInProject(folder: vscode.Uri, depth: number): Promise<vscode.Uri | undefined> {
        // 递归搜索目录下的 `header.map` 文件所在目录
        try {
            let state = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, 'header.map'));
            if (state.type === vscode.FileType.File) {
                return folder;
            }
        } catch (error) {
            // ignore
        }
        if (depth <= 0) {
            return undefined;
        }

        let files = await vscode.workspace.fs.readDirectory(folder);
        for (const file of files) {
            if (file[1] === vscode.FileType.Directory) {
                let mapFolder = await this.searchMapPathInProject(vscode.Uri.joinPath(folder, file[0]), depth - 1);
                if (mapFolder) {
                    return mapFolder;
                }
            }
        }

        return undefined;
    }

    private async searchMapFolderBySelectedUri(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
        // 检查一下上一层目录
        let parentUri = vscode.Uri.joinPath(uri, '..');
        let mapFolder = await this.searchMapPathInProject(parentUri, 0)
                    ||  await this.searchMapPathInProject(uri, 3);
        return mapFolder;
    }

    private async searchProjectPath(askUser = false): Promise<vscode.Uri | undefined> {
        // 先直接搜索打开的工作目录
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                let mapFolder = await this.searchMapFolderBySelectedUri(folder.uri);
                if (mapFolder) {
                    return mapFolder;
                }
            }
        }

        if (!askUser) {
            return undefined;
        }

        // 如果没有，则询问用户
        let selectedFolders = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false, // 竟然不能同时选择文件和文件夹
            canSelectMany: false,
            openLabel: '选择Y3地图路径',
            filters: {
                '地图': ['map', 'project']
            }
        });

        let selectedFolder = selectedFolders?.[0];
        if (!selectedFolder) {
            return undefined;
        }

        if ((await vscode.workspace.fs.stat(selectedFolder)).type === vscode.FileType.File) {
            selectedFolder = vscode.Uri.joinPath(selectedFolder, '..');
        };
        let mapFolder = await this.searchMapFolderBySelectedUri(selectedFolder);
        if (mapFolder) {
            return mapFolder;
        }

        return undefined;
    }

    private getEditorExeUri(): vscode.Uri | undefined {
        if (!this.editorUri) {
            return undefined;
        }
        let editorExeUri = vscode.Uri.joinPath(this.editorUri, '../Engine/Binaries/Win64/Game_x64h.exe');
        return editorExeUri;
    }

    public editorVersion: EditorVersion = 'unknown';
    public editorUri?: vscode.Uri;
    public editorExeUri?: vscode.Uri;
    public mapUri?: vscode.Uri;
    public scriptUri?: vscode.Uri;
    public y3Uri?: vscode.Uri;
    public projectUri?: vscode.Uri;
    public editorTableUri?: vscode.Uri;// 物编数据
    public csvTableUri?: vscode.Uri;// CSV表格路径
    public readonly extensionImportRulesUri: vscode.Uri=vscode.Uri.file(__dirname+'../../importRules');


    public get excelTablePath() {
        let relativePath: string | undefined = vscode.workspace.getConfiguration('Y3-Helper').get<string>('editorTablceDataExcelFolder');
        if (relativePath && this.scriptUri) {
            let res: vscode.Uri = vscode.Uri.joinPath(this.scriptUri, relativePath);
            return res;
        }
        vscode.window.showErrorMessage("指定的editorTablceDataExcelFolder不存在，请检查插件设置");
        return undefined;
    }


    // 实际情况下各类型物编数据CSV文件的相对路径 （相对于工程项目的script文件）
    private _tableTypeToCSVfolderPath: { [key: string]: string } = {};
    public get tableTypeToCSVfolderPath(): { [key: string]: string }{
        return this._tableTypeToCSVfolderPath;
    }

    private _editorTablePath: string = "";
    
    public get editorTablePath(): string{
        if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders[0]) {
            return "";
        }
        this._editorTablePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, "../editor_table");


        if (!isPathValid(this._editorTablePath)) {
            this._editorTablePath = "";
        }
        return this._editorTablePath;
    }

    /**
     * 从插件配置中更新物编数据类型对应的CSV文件保存地址
     */
    private initTableTypeToCSVfolderPath(): void {
        let csvPathConfig: any = vscode.workspace.getConfiguration('Y3-Helper.CSVPath');
        //console.log(vscode.workspace.getConfiguration('Y3-Helper.CSVPath').unit);
        for (const key in defaultTableTypeToCSVfolderPath) {
            this._tableTypeToCSVfolderPath[key] = defaultTableTypeToCSVfolderPath[key];
            // console.log(key + " " + this._tableTypeToCSVfolderPath[key]);
        }
        
        for (const key in csvPathConfig) {
            if (key in defaultTableTypeToCSVfolderPath) {
                this._tableTypeToCSVfolderPath[key] = csvPathConfig[key];
                // console.log("update:"+key + " " + csvPathConfig[key]);
            }
        }
    }

    private _timer?: NodeJS.Timeout;
    private fireOnDidReload() {
        if (this._timer) {
            return;
        }
        this._timer = setTimeout(() => {
            this._timer = undefined;
            this.envChangeEmitter.fire();
        }, 100);
    }

    @rePrepare
    public async updateEditor(askUser = false) {
        let editorUri = await this.searchEditorUri(askUser);
        if (!editorUri) {
            return;
        }
        this.editorUri = editorUri;
        this.editorVersion = await this.getEditorVersion();
        this.editorExeUri = this.getEditorExeUri();
        tools.log.info(`editorUri: ${this.editorUri?.fsPath}`);
        tools.log.info(`editorExeUri: ${this.editorExeUri?.fsPath}`);
        tools.log.info(`editorVersion: ${this.editorVersion}`);
        this.fireOnDidReload();
    }

    public async editorReady(askUser = false) {
        if (this.editorUri) {
            return;
        }
        await this.updateEditor(askUser);
    }

    @rePrepare
    public async updateMap(askUser = false) {
        let mapUri = await this.searchProjectPath(askUser);
        if (!mapUri) {
            return;
        }
        this.mapUri = mapUri;
        if (this.mapUri) {
            this.projectUri = vscode.Uri.joinPath(this.mapUri, '../..');
            this.scriptUri = vscode.Uri.joinPath(this.mapUri, 'script');
            this.y3Uri = vscode.Uri.joinPath(this.scriptUri, 'y3');
            this.editorTableUri = vscode.Uri.joinPath(this.mapUri, "editor_table");
            this.csvTableUri = vscode.Uri.joinPath(this.scriptUri, "./y3helper/editor_table/csv/");
            this.initTableTypeToCSVfolderPath();
        }
        tools.log.info(`mapUri: ${this.mapUri}`);
        tools.log.info(`projectUri: ${this.projectUri}`);
        tools.log.info(`scriptUri: ${this.scriptUri?.fsPath}`);
        tools.log.info(`y3Uri: ${this.y3Uri?.fsPath}`);
        tools.log.info(`editorTableUri: ${this.editorTableUri?.fsPath}`);
        this.fireOnDidReload();
    }

    public async mapReady(askUser = false) {
        if (this.mapUri) {
            return;
        }
        await this.updateMap(askUser);
    }

    public reload() {
        this.mapUri = undefined;
        this.editorUri = undefined;
        this.fireOnDidReload();
        this.initTableTypeToCSVfolderPath();//重新载入要导入的CSV表格的相对路径
    }
}

class Env extends EnvPath {

    private _languageJson: any = undefined;
    private languageJsonRelativePath: string = "../zhlanguage.json";//默认为中文
    public get languageJson(): any {

        if (this._languageJson) {
            return this._languageJson;
        }
        if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders[0]) {
            return undefined;
        }
        // 载入中文名称 (目前只支持中文)
        let languageJsonPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, this.languageJsonRelativePath);
        if (isPathValid(languageJsonPath)) {
            try {
                this._languageJson = JSON.parse(fs.readFileSync(languageJsonPath, 'utf8'));
            }
            catch (error) {
                vscode.window.showErrorMessage("读取和解析" + languageJsonPath + "时失败，错误为：" + error);
            }
        }
        else {
            return undefined;
        }
        return this._languageJson;
    }

    /**
     * 写入项目中的language.json的值，用于保存中文名等
     * @param key 
     * @param val 
     * @returns 
     */
    public writeDataInLanguageJson(key: number, val: any) {
        this.refreshlanguageJson();
        if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders[0]) {
            return undefined;
        }
        this._languageJson[key] = val;
        let languageJsonPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, this.languageJsonRelativePath);
        try {
            fs.writeFileSync(languageJsonPath, JSON.stringify(this.languageJson, null, 2), 'utf8');
        }
        catch (error) {
            vscode.window.showErrorMessage("保存zhlanguage.json失败");
            return false;
        }
    }
    public refreshlanguageJson():void {
        
        if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders[0]) {
            this._languageJson = undefined;
            return;
        }
        // 载入中文名称
        let zhlanguagePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, "../zhlanguage.json");
        if (isPathValid(zhlanguagePath)) {
            try {
                this._languageJson = JSON.parse(fs.readFileSync(zhlanguagePath, 'utf8'));
            }
            catch (error) {
                this._languageJson = undefined;
                vscode.window.showErrorMessage("读取和解析" + zhlanguagePath + "时失败，错误为：" + error);
            }
        }
        else {
            this._languageJson = undefined;
        }
    }
}

export let env = new Env();
