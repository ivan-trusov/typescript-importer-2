import ICacheFile = require('../../src/Cache/ICacheFile');
import { GetCommonJSPath } from "./Helper/CommonPathFinder";
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';

export class CompletionItemFactory {
    /**
     * Show namespace
     */
    public static ShowNamespace = true;
    
    /**
     * Gets an item
     */
    public static getItem(inner: ICacheFile):CompletionItem {
        return {
            label: inner.method,
            detail: this.ShowNamespace ? inner.namespace : undefined,
            kind: CompletionItemKind.Function,
            insertText: `${inner.method} = ${inner.namespace}.${inner.method};`,
            data: 365
        };
    }
    
    /**
     * Gets an item, including an import at the top if required
     */
    public static getInlineItem(inner: ICacheFile): CompletionItem {
        return {
            label: inner.method,
            detail: this.ShowNamespace ? inner.namespace : undefined,
            kind: CompletionItemKind.Function,
            insertText: `${inner.method}\u200B\u200B`,
            data: 365
        };
    }
    
    /**
     * Gets a cmmon JS implementation of an import
     */
    public static getItemCommonJS(inner: ICacheFile):CompletionItem {
        let label: string;
        let insertText: string;
        let detail: string | undefined = undefined;
        
        /// Need to deal with legacy and ES6
        if(inner.method){
            label = inner.method;
            if (this.ShowNamespace) {
                detail = inner.namespace;
            }
            insertText = `{ ${inner.method} } from "${GetCommonJSPath(inner)}";`;
        } else {
            /// Ignore the flag otherwise we've got nothing to show
            label = inner.namespace;
            insertText = `${inner.namespace} = require("${GetCommonJSPath(inner)}")`;
        }
        
        return {
            label,
            kind: CompletionItemKind.Function,
            insertText: insertText,
            detail
        };
    }
    
    
    /**
     * Gets a cmmon JS implementation of an import
     */
    public static getInlineItemCommonJS(inner: ICacheFile):CompletionItem {
        let label: string;
        let insertText: string;
        let detail: string | undefined = undefined;
        
        /// Need to deal with legacy and ES6
        if(inner.method){
            label = inner.method;
            insertText = `${inner.method}\u200B\u200B`;
            detail = this.ShowNamespace ? inner.namespace : undefined;
        } else {
            /// Ignore the flag otherwise we've got nothing to show
            label = inner.namespace;
            insertText = `${inner.namespace}\u200B\u200B`;
        }
        
        return {
            label: label,
            kind: CompletionItemKind.Function,
            insertText: insertText,
            detail
        };
    }
}