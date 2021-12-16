import { workspace, Uri, TextDocument, WorkspaceEdit, Position, Range } from 'vscode';
import CommunicationMethods = require('../Methods/CommunicationMethods');
import ApplicationGlobals = require('../Application/ApplicationGlobals');
import TSFormatter = require('./TSFormatter');
import IFramework = require('./IFramework');
import ITSFile = require('./ITSFile');
import OS = require("os");
import fs = require("fs");
import path = require("path");

/**
 * TS Watcher class, communicates with the server when things change
 */
class TSWatcher {
     private tsFilesInfo: Record<string, ITSFile> = {}

    constructor() {
        this.initializeTSConfigInfo();

        const handlerFactory = (handler: (path: string) => void) => {
            return (uri: Uri) => {
                const fsPath = uri.fsPath;
                if (!fsPath.toLocaleLowerCase().match(path.sep + "node_modules" + path.sep)) {
                    handler(fsPath);
                }
            };
        };

        const tsConfigWatcher = workspace.createFileSystemWatcher("**/tsconfig.json");
        const tsConfigRefreshHandler = handlerFactory(() => this.refreshTSConfigInfo());
        tsConfigWatcher.onDidCreate(tsConfigRefreshHandler);
        tsConfigWatcher.onDidChange(tsConfigRefreshHandler);
        tsConfigWatcher.onDidDelete(tsConfigRefreshHandler);

        const tsFileWatcher = workspace.createFileSystemWatcher("**/*.ts");
        const onCreateHandler = async (path) => {
            const data = await fs.promises.readFile(path, {encoding: 'utf-8'});
            const fileInfo = TSFormatter.Format(data, path);
            ApplicationGlobals.Client.sendNotification(CommunicationMethods.NAMESPACE_UPDATE, fileInfo);
            this.tsFilesInfo[path] = fileInfo;
        };
        const refreshNamespace = async (namespace: string) => {
            const refreshInfo = {
                namespace,
                files: []
            };
            for (const [key, value] of Object.entries(this.tsFilesInfo)) {
                if (value.namespace === namespace) {
                    const data = await fs.promises.readFile(value.path, {encoding: 'utf-8'});
                    const fileInfo = TSFormatter.Format(data, value.path);
                    refreshInfo.files.push(fileInfo);
                    this.tsFilesInfo[key] = fileInfo;
                }
            }
            ApplicationGlobals.Client.sendNotification(CommunicationMethods.REFRESH_NAMESPACE, refreshInfo);
        };

        tsFileWatcher.onDidCreate(handlerFactory(onCreateHandler));
        tsFileWatcher.onDidChange(handlerFactory(async (path) => {
            const fileInfo = this.tsFilesInfo[path];
            if (fileInfo) {
                refreshNamespace(fileInfo.namespace);
            } else {
                onCreateHandler(path);
            }
        }));
        tsFileWatcher.onDidDelete(handlerFactory(async (path) => {
            const fileInfo = this.tsFilesInfo[path];
            if (fileInfo) {
                refreshNamespace(fileInfo.namespace);
                delete this.tsFilesInfo[path];
            }
        }));
        
        /// save requests from the server
        ApplicationGlobals.Client.onNotification(CommunicationMethods.SAVE_REQUEST, this.onSaveRequest);
        ApplicationGlobals.Client.onNotification(CommunicationMethods.UNDO_SAVE_REQUEST, this.onUndoSaveRequest);
    }

    private async refreshTSConfigInfo() {
        const resyncInfo = {
            frameworksInfo: [],
            namespacesInfo: []
        };

        const tsConfigFiles = (await workspace.findFiles("**/tsconfig.json", "**/node_modules/**")).map(it => it.fsPath);
        resyncInfo.frameworksInfo = await this.getFrameworksInfo(tsConfigFiles);        
        
        this.tsFilesInfo = {};
        this.processTSFiles(fileInfo => {
            resyncInfo.namespacesInfo.push(fileInfo);
            this.tsFilesInfo[fileInfo.path] = fileInfo;
        });

        ApplicationGlobals.Client.sendNotification(CommunicationMethods.RESYNC, resyncInfo);
    }

    private async initializeTSConfigInfo() {
        const tsConfigFiles = (await workspace.findFiles("**/tsconfig.json", "**/node_modules/**")).map(it => it.fsPath);
        for (const response of await this.getFrameworksInfo(tsConfigFiles)) {
            ApplicationGlobals.Client.sendNotification(CommunicationMethods.TSCONFIG_UPDATE, response);
        }

        this.tsFilesInfo = {};
        this.processTSFiles(fileInfo => {
            this.tsFilesInfo[fileInfo.path] = fileInfo;
            ApplicationGlobals.Client.sendNotification(CommunicationMethods.NAMESPACE_UPDATE, fileInfo);
        });
    }

    private async processTSFiles(handler: (data: ITSFile) => void) {
        const tsFiles = (await workspace.findFiles("**/*.ts", "**/node_modules/**")).map(it => it.fsPath);
        for (const item of tsFiles) {
            if(!item.toLocaleLowerCase().endsWith(".d.ts")){
                try {
                    const data = await fs.promises.readFile(item, {encoding: 'utf-8'});
                    const namespaceInfo = TSFormatter.Format(data, item);
                    handler(namespaceInfo);
                } catch (e) {
                    // ...
                }
            }
        }
    }
        
    private async getFrameworksInfo(list: string[]) {
        const exclusionList = (workspace.getConfiguration("StiTSImporter").get("IgnoreListedFolders") as string).split(",").map(it => it.toLocaleLowerCase());
        const result = [];

        for (const item of list) {
            const lowerCaseItem = item.toLocaleLowerCase();
            if (exclusionList.some(it => lowerCaseItem.includes(it))) {
                continue;                
            }

            /// d:/Web/JS/Project/api/database-controller/tsconfig.json
            /// (database-controller)(tsconfig)
            /// Match everything that isn't a forward slash before the tsconfig
            const framework = item.match(/([^\\/]+)([\\/]tsconfig)/);
            /// If we get a match, then assume this is a framework
            if (framework) {                
                /// TSConfig
                let content: {
                    workflowFiles?: string[],
                    compilerOptions?: {
                        module?: string
                    }
                };

                try {
                    const data = await fs.promises.readFile(item, {encoding: 'utf-8'});
                    content = JSON.parse(data);
                } catch (e) {
                    content = undefined;
                }
                
                const response: IFramework = { name: framework[1], dependancies: [] };
                
                /// If the TSConfig has JSON
                if (content) {
                    /// if we have a workflowFiles section, we need to do specific logic. Otherwise, look for the config item
                    if (content.workflowFiles){
                        content.workflowFiles.forEach((item) => {
                            /// {!example}
                            if(item.indexOf("!{") > -1){
                                response.dependancies.push(item.match(/(\w+)/)[1]);
                            }
                        });
                    } else {
                        /// If we have a frameworks section
                        /// This does already return a string, but the compound seems to be confusing the compiler
                        response.dependancies = content[<string>(workspace.getConfiguration("StiTSImporter").get("TSConfigFrameworkName"))] || [];
                    }
                    
                    if (content.compilerOptions && content.compilerOptions.module && content.compilerOptions.module.toLowerCase() === "commonjs") {
                        TSFormatter.CommonJS.push(framework[1]);
                    }
                }
                
                result.push(response);
            }
        }

        return result;
    }

    /**
     * When we request a save
     */
    private onSaveRequest([filePath, fileInfo, lineNumber]){
        const edit = new WorkspaceEdit();
        const target: ITSFile = fileInfo;
        const line: number = lineNumber;
        let input: string;
        
        if(!target.commonJS){
            input = "    import " + target.method + " = " + target.namespace + "." + target.method + ";" + OS.EOL;
        } else {
            input = "import " + target.path + OS.EOL;
        }
        
        workspace.openTextDocument(filePath).then((doc: TextDocument) => {
            const common = target.commonJS;
            const split = doc.getText().split(OS.EOL);
            const textTarget = split[line];
            /// Remove the hidden character
            edit.replace(Uri.file(filePath), new Range(new Position(line, textTarget.indexOf("\u200B\u200B")), new Position(line, textTarget.indexOf("\u200B\u200B") + 2)), "");
            
            if(doc.getText().indexOf(input) === -1){
                if(common) {
                    edit.insert(Uri.file(filePath), new Position(1, 0), input);
                } else {
                    /// Check if we have a namespace or module
                    if(doc.getText().match(/(namespace|module)\s(\w+)/)) {
                        /// Find it
                        for(let i = 0, len = split.length; i < len; i++){
                            if(split[i].match(/(namespace|module)\s(\w+)/)) {
                                /// Insert here
                                edit.insert(Uri.file(filePath), new Position(i + 1, 0), input);
                                break;
                            }
                        }
                    } else {
                        input = input.replace("    import", "import");
                        /// Otherwise put it at the top
                        edit.insert(Uri.file(filePath), new Position(0, 0), input);
                    }
                }
            }
            
            workspace.applyEdit(edit);
        });
    }
    
    /**
     * Undo a save
     */
    private onUndoSaveRequest(file: string):void {
        const edit = new WorkspaceEdit();
        
        workspace.openTextDocument(Uri.file(file)).then((doc: TextDocument) => {
            const split = doc.getText().split(OS.EOL);
            
            for(let i = 0; i < split.length; i++) {
                if(split[i].indexOf("\u200B") > -1) {
                    /// Remove the hidden character
                    edit.replace(Uri.file(file), new Range(new Position(i, split[i].indexOf("\u200B\u200B")), new Position(i, split[i].indexOf("\u200B\u200B") + 2)), "");
                }
            }
            
            workspace.applyEdit(edit);
        });
    }
    
}

export = TSWatcher;