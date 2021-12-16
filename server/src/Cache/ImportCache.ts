import ICacheFile = require('../../src/Cache/ICacheFile');
import IFramework = require('./IFramework');
import { CompletionItem } from 'vscode-languageserver';
import { GetCommonJSPath } from "./../Factory/Helper/CommonPathFinder";
import { CompletionGlobals } from "./../Factory/Helper/CompletionGlobals";
import { CompletionItemFactory } from "./../Factory/CompletionItemFactory";

type CompletionType = (inner: ICacheFile) => CompletionItem;
type FarmeworkInfo = {
    dependencies: Set<string>,
    elements: ICacheFile[]
};

class ImportCache {
    
    private _namespaceCache: Record<string, ICacheFile[]> = {};
    
    private _frameworkList: Record<string, FarmeworkInfo> = {};
    
    private _cache: Record<string, ICacheFile[]> | null = null;
    
    public reset(params: {frameworksInfo: IFramework[], namespacesInfo: ICacheFile[]}) {
        this._frameworkList = {};
        this._namespaceCache = {};
        this._cache = null;
        
        for (const item of params.frameworksInfo) {
            this.registerFramework(item);
        }
        
        for (const item of params.namespacesInfo) {
            this.register(item);
        }
    }
    
    /**
     * Registers a framework
     */
    public registerFramework(framework: IFramework):void {
        if(!this._frameworkList[framework.name]){
            this._frameworkList[framework.name] = {
                dependencies: new Set(),
                elements: []
            };
        }
        
        /// Register the dependencies
        if(framework.dependancies){
            for(const element of framework.dependancies){
                this._frameworkList[framework.name].dependencies.add(element);
            }
        }
    }

    public refreshNamespace(namespace: string, files: ICacheFile[]) {
        this._namespaceCache[namespace] = [];
        for (const element in this._frameworkList) {
            this._frameworkList[element].elements = this._frameworkList[element].elements.filter(it => it.namespace !== namespace);
        }
        for (const item of files) {
            this.register(item);
        }
    }    
    
    /**
     * Registers a namespace and method list
     */
    public register(file: ICacheFile): void{
        /// Ensure the namespace exists
        if(!this._namespaceCache[file.namespace]) {
            this._namespaceCache[file.namespace] = [];
        }

        if (file.methods) {
            for (const method of file.methods) {
                const cacheFile: ICacheFile = {  
                    namespace: file.namespace,
                    method,
                    path: file.path?.replace(/(\.ts|\.js)/, ""),
                    commonJS: file.commonJS
                };
                
                /// file.path = "/e:/2016/Web/JS/SnowStorm/src/SnowStormLauncher/src/AvatarBuilder/Events/ProgressEvent.ts"
                /// Here we add the namespace to our framework path
                for(const element in this._frameworkList){
                    if(file.path && file.path.indexOf(element) > -1){                        
                        this._frameworkList[element].elements.push(cacheFile);
                        break;
                    }
                }
                
                /// Store the info in a namespace cache
                this._namespaceCache[file.namespace].push(cacheFile);
            }
        }        
    }
    
    /**
     * Gets items for when we're typing "import"
     */
    public getOnImport(commonJsMethod: CompletionType, namespaceJsMethod: CompletionType): CompletionItem[] {
        const fullList = this.getAll();
        let method: CompletionType | null = null;
        
        if (!fullList) {
            return [];
        }
        
        /// TODO: This blows, surely we can use CompletionGlobals here?
        /// We're looking to find our framework to see if it's common or not
        for(const element in this._frameworkList){
            if(CompletionGlobals.Uri.indexOf(element)){
                const target = this._frameworkList[element].elements[this._frameworkList[element].elements.length - 1];
                method = target.commonJS ? commonJsMethod : namespaceJsMethod;
                break;
            }
        }
        
        const list: CompletionItem[] = [];
        const alreadySeen: Set<string> = new Set();
        
        if (method) {
            for(const element of fullList){
                /// Don't show hints for the current file, otherwise we end up importing into ourselves
                if(element.path && CompletionGlobals.Uri.indexOf(element.path)) {
                    const item = method.call(CompletionItemFactory, element);
                    if (!alreadySeen.has(item.label)) {
                        list.push(item);
                        alreadySeen.add(item.label);
                    }                    
                }
            }
        }        
        
        return list;
    }
    
    /**
     * Gets a cacheFile from method name
     */
    public getFromMethodName(name: string): ICacheFile | null {
        const fullList = this.getAll();
        
        /// Find our target, then link it up as required
        for(const element of fullList){
            if(element.method === name || element.namespace === name){
                /// Rewrite it for commonJS
                if(element.commonJS){
                    return {
                        commonJS: true,
                        namespace: element.namespace,
                        /// ES6 vs legacy
                        path: element.method ? `{ ${element.method} } from "${GetCommonJSPath(element)}";` : `${element.namespace} = require("${GetCommonJSPath(element)}")`,
                        method: ""
                    };
                }
                
                return element;
            }
        }
        
        /// Not found
        return null;
    }
    
    /**
     * Returns all entries, including those from the framework
     */
    private getAll(): ICacheFile[] {
        let element: string | null = null;
        let list: ICacheFile[] = [];
        let target: FarmeworkInfo | null = null;
        
        /// file.path = "/e:/2016/Web/JS/SnowStorm/src/SnowStormLauncher/src/AvatarBuilder/Events/ProgressEvent.ts"
        /// Here we add the namespace to our framework path
        for(element in this._frameworkList){
            if(CompletionGlobals.Uri.indexOf(element) > -1){
                /// Try to return a cached value, can't do this any sooner, need the framework name
                if(this._cache && this._cache[element]){
                    return this._cache[element];
                }
                
                target = this._frameworkList[element];
                list = [...this._frameworkList[element].elements];
                
                break;
            }
        }

        if (target) {
            for (const depName of target.dependencies) {
                const frameworkInfo = this._frameworkList[depName];
                if (frameworkInfo) {
                    list = list.concat(frameworkInfo.elements);
                }
            }

        }
        
        /// Setup the cache for this
        if (element) {
            if (!this._cache) {
                this._cache = {};
            }
            this._cache[element] = list;
        }        
        
        /// Pass across
        return list;
    }
    
}

export = ImportCache;