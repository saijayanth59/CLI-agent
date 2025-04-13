const vscode = require("vscode");
const { AgentViewProvider } = require("./AgentViewProvider");
const dotenv = require("dotenv");
dotenv.config();
function activate(context) {
  console.log(
    'Congratulations, your extension "ai-local-agent" is now active!'
  );

  // console.log(process.env.GEMINI_API_KEY);

  const provider = new AgentViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AgentViewProvider.viewType,
      provider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ai-local-agent.showChat", () => {
      vscode.commands.executeCommand(
        "workbench.view.extension.aiAgentContainer"
      );
    })
  );
}

function deactivate() {
  console.log("AI Local Agent deactivated.");
}

module.exports = {
  activate,
  deactivate,
};
