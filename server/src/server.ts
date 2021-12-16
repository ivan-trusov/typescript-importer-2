import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, TextDocumentSyncKind,
	TextDocuments, TextDocumentPositionParams,
	InitializeResult, CompletionItem, DidChangeTextDocumentParams
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompletionItemFactory } from "./Factory/CompletionItemFactory";
import { TypescriptImporter } from "./Settings/TypeScriptImporterSettings";
import ImportCache = require('./Cache/ImportCache');
import ICacheFile = require('./Cache/ICacheFile');
import CommunicationMethods = require('./Methods/CommunicationMethods');
import IFramework = require('./Cache/IFramework');
import { CompletionGlobals } from "./Factory/Helper/CompletionGlobals";
import OS = require('os');

// Create a connection for the server. The connection uses 
// stdin / stdout for message passing
const connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

// After the server has started the client sends an initilize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilites. 
connection.onInitialize((params): InitializeResult => {
    if (params.rootPath) {
        CompletionGlobals.Root = params.rootPath.replace(/\\/g, '/');
    }    
	return {
		capabilities: {
			// Tell the client that the server support code complete
			completionProvider: {
				resolveProvider: true
			},
            /// Need full sync
            textDocumentSync: TextDocumentSyncKind.Full
		}
	};
});

/// Show namespace on imports
let showNamespaceOnImports: boolean;

// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((change) => {
	const settings = change.settings.StiTSImporter as TypescriptImporter;
    showNamespaceOnImports = settings.showNamespaceOnImports || true;
    
    CompletionItemFactory.ShowNamespace = showNamespaceOnImports;
});

const _importCache = new ImportCache();
let _targetString: string | null;
let _targetLine: number;
const _fileArray: Record<string, string> = {};
const documents = new TextDocuments<TextDocument>(TextDocument);
documents.listen(connection);


/// Listen for when we get a notification for a namespace update
connection.onNotification(CommunicationMethods.NAMESPACE_UPDATE, (params: ICacheFile) => {
    if(params){
        _importCache.register(params);
    }
});

/// Listen for when we get a notification for a tsconfig update
connection.onNotification(CommunicationMethods.TSCONFIG_UPDATE, (params: IFramework) => {
    if(params){
        _importCache.registerFramework(params);
    }
});

/// Listen for when we get a notification for a tsconfig update
connection.onNotification(CommunicationMethods.RESYNC, (params: any) => {
    _importCache.reset(params);
});

connection.onNotification(CommunicationMethods.REFRESH_NAMESPACE, ({namespace, files}: {namespace: string, files: ICacheFile[]}) => {
    _importCache.refreshNamespace(namespace, files);
});

/**
 * When a completion is requested, see if it's an import
 */
connection.onCompletion((textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    try {
        // There's no quick way of getting this information without keeping the files permanently in memory...
        // TODO: Can we add some validation here so that we bomb out quicker?
        let text;
        
        /// documents doesn't automatically update
        if(_fileArray[textDocumentPosition.textDocument.uri]){
            text = _fileArray[textDocumentPosition.textDocument.uri];
        } else {
            /// Get this if we don't have anything in cache
            text = documents.get(textDocumentPosition.textDocument.uri)?.getText();
        }
        
        if (text) {
            const input = text.split(OS.EOL);
            _targetLine = textDocumentPosition.position.line;
            _targetString = input[_targetLine];
            
            CompletionGlobals.Uri = decodeURIComponent(textDocumentPosition.textDocument.uri).replace("file:///", "");
            
            /// If we are not on an import, we don't care
            if(_targetString.indexOf("import") !== -1){
                return _importCache.getOnImport(CompletionItemFactory.getItemCommonJS, CompletionItemFactory.getItem);
            /// Make sure it's not a comment (i think?)
            } else if(!_targetString.match(/(\/\/|\/\*|\w\.$)/)) {
                return _importCache.getOnImport(CompletionItemFactory.getInlineItemCommonJS, CompletionItemFactory.getInlineItem);
            }
        }
    } catch(e) {
        console.warn("Typescript Import: Unable to creation completion items");
    }

    return [];
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    if(item.data && item.data === 365) {
        item.detail ||= item.label;
    }
    
    return item;
});

connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
    /// We have to manually remember this on the server
    /// NOTE: don't query doucments if this isn't available
    _fileArray[params.textDocument.uri] = params.contentChanges[0].text;
    
    /// If we have no target, make sure the user hasn't tried to undo and left behind our hidden characters, otherwise the plugin appears to stop working
    if(!_targetString) {
        if(_fileArray[params.textDocument.uri].indexOf("\u200B\u200B") > -1) {
            /// Inform the client to do the change (faster than node FS)
            connection.sendNotification(
                CommunicationMethods.UNDO_SAVE_REQUEST,
                /// CompletionGlobals.Uri?
                [decodeURIComponent(params.textDocument.uri.replace("file:///", ""))]
            );
        }
    } else {
        const content = params.contentChanges[0].text;        
        const contentString = content.split(OS.EOL)[_targetLine];

        /// If there has been a change, aka the user has selected the option
        if(contentString && contentString !== _targetString && !contentString.match(/(\/\/|\*|\w\.$)/)) {
            /// Get the type if we're typing inline
            let result: RegExpExecArray | null;
            let subString = contentString;
            /// May be multiple results, loop over to see if any match
            // eslint-disable-next-line no-cond-assign
            while(result = /([:|=]\s*?)?(\w+)[\u200B\u200B]/.exec(subString)) {
                if(result.length >= 3) {
                    const target = _importCache.getFromMethodName(result[2]);
                
                    if(target){
                        /// Inform the client to do the change (faster than node FS)
                        connection.sendNotification(
                            CommunicationMethods.SAVE_REQUEST,
                            /// CompletionGlobals.Uri?
                            [decodeURIComponent(params.textDocument.uri.replace("file:///", "")),
                            target,
                            _targetLine]
                        );
                        
                        _targetString = null;
                        _targetLine = 0;
                        break;
                    }
                }
                
                /// shorten
                subString = subString.slice(result.index + result.length);
            }
            
            if(!contentString.match(/(\w+)[)|\s]?/)) {
                _targetString = null;
                _targetLine = 0;
            }
        }
    }
});

// Listen on the connection
connection.listen();