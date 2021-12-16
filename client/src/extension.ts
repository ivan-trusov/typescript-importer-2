/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';

import { workspace, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

import ApplicationGlobals = require('./Application/ApplicationGlobals');
import TSWatcher = require("./Watcher/TSWatcher");

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'javascript' }, { scheme: 'file', language: 'typescript' }],
		synchronize: {
			configurationSection: 'StiTSImporter',			
			fileEvents: workspace.createFileSystemWatcher('**/.ts', false, true, true)
		}
	};

	const serverOptions: ServerOptions = {
		run : { module: serverModule, transport: TransportKind.ipc },
		debug: { 
			module: serverModule, 
			transport: TransportKind.ipc, 
			options: {
				execArgv: ["--nolazy", "--inspect=6009"]
			}
		}
	};
    
    ApplicationGlobals.Client = new LanguageClient('TypeScript Importer', serverOptions, clientOptions);
	ApplicationGlobals.Client.onReady().then(() => {
		new TSWatcher();
	});

	// Push the disposable to the context's subscriptions so that the 
	// client can be deactivated on extension deactivation
	context.subscriptions.push(ApplicationGlobals.Client.start());
}