// --- START OF FILE src/extension.js ---
// Using require for consistency if not using ES Modules type in package.json
// If using "type": "module" in package.json, stick with import
const vscode = require('vscode');
const { AgentViewProvider } = require('./AgentViewProvider'); // Use require

function activate(context) {
    console.log('Congratulations, your extension "ai-local-agent" is now active!');

    // Register the Webview View Provider
    const provider = new AgentViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(AgentViewProvider.viewType, provider)
    );

     // Command to manually show the view
    context.subscriptions.push(vscode.commands.registerCommand('ai-local-agent.showChat', () => {
         vscode.commands.executeCommand('workbench.view.extension.aiAgentContainer');
    }));
}

function deactivate() {
     console.log("AI Local Agent deactivated.");
}

module.exports = { // Use module.exports for CommonJS
    activate,
    deactivate
};
// --- END OF FILE src/extension.js ---