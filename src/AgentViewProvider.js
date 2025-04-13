const vscode = require("vscode");
const { AgentLogic } = require("./agentLogic");

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

class AgentViewProvider {
  static viewType = "aiAgentChatView";

  _view;
  _extensionUri;
  _agentLogic;

  constructor(context) {
    this._extensionUri = context.extensionUri;
    this._workspacePath =
      vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
    this._chatHistory = [];
  }

  resolveWebviewView(webviewView, context, _token) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    if (!this._agentLogic) {
      try {
        console.log(
          "Initializing AgentLogic with workspace:",
          this._workspacePath
        );
        this._agentLogic = new AgentLogic(
          this.sendMessageToWebview.bind(this),
          this._workspacePath
        );
        if (this._agentLogic.isInitialized) {
          this._agentLogic.start();
        } else {
          console.error("AgentLogic failed to initialize.");
        }
      } catch (error) {
        console.error("Error initializing AgentLogic:", error);
        this.sendMessageToWebview("addErrorMessage", {
          text: `Initialization Error: ${error.message}`,
        });
      }
    }

    webviewView.webview.onDidReceiveMessage((message) => {
      console.log("Message received from webview:", message);

      if (!this._agentLogic || !this._agentLogic.isInitialized) {
        this.sendMessageToWebview("addErrorMessage", {
          text: "Agent is not ready. Please wait or restart.",
        });
        return;
      }

      switch (message.command) {
        case "sendMessage":
          this._agentLogic.handleUserInput(message.text);
          break;
        case "confirmExecution":
          this._agentLogic.handleConfirmation(message.confirm, "execute");
          break;
        case "confirmSuccess":
          this._agentLogic.handleConfirmation(message.confirm, "success");
          break;
        case "sendFailureReason":
          this._agentLogic.handleFailureReason(message.reason);
          break;
        case "webviewLoaded": {
          console.log(
            "[AgentViewProvider] Webview loaded. Replaying chat history..."
          );

          this._chatHistory.forEach(({ command, data }) => {
            this._view?.webview.postMessage({ command, data });
          });

          break;
        }
        case "requestAgentRestart":
          console.log("Restart requested by user.");
          this.sendMessageToWebview("resetChat", {});
          this.sendMessageToWebview("addBotMessage", {
            text: "Restarting agent...",
          });

          try {
            this._agentLogic = new AgentLogic(
              this.sendMessageToWebview.bind(this),
              this._workspacePath
            );
            if (this._agentLogic.isInitialized) {
              this._agentLogic.start();
            } else {
              console.error("AgentLogic failed to initialize on restart.");
            }
          } catch (error) {
            console.error("Error restarting AgentLogic:", error);
            this.sendMessageToWebview("addErrorMessage", {
              text: `Restart Error: ${error.message}`,
            });
          }
          break;
      }
    });

    webviewView.onDidDispose(() => {
      console.log("Webview disposed.");
      this._view = undefined;
    });
  }
  sendMessageToWebview(command, data) {
    const message = { command, data: data || {} };
    this._chatHistory.push(message);

    if (this._view) {
      this._view.webview.postMessage(message);
    } else {
      console.error(
        "Cannot send message: Webview not available.",
        command,
        data
      );
    }
  }

  _getHtmlForWebview(webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "style.css")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="${styleUri}" rel="stylesheet">
          <title>AI Agent Chat</title>
      </head>
      <body>
          <div id="chat-container">
              <div id="messages"></div>
              <div id="execution-output-container" style="display: none;">
                  <h4>Execution Output:</h4>
                  <pre id="execution-output"></pre>
              </div>
              <div id="prompts-container" style="margin-top: 10px;"></div>
              <div id="restart-container" style="margin-top: 10px; display: none;">
                  <button id="restart-agent-button">Restart Agent</button>
              </div>
          </div>
          <div id="input-area">
              <textarea id="message-input" rows="2" placeholder="Agent is initializing..." disabled></textarea>
              <button id="send-button" disabled>Send</button>
          </div>
          <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

module.exports = { AgentViewProvider };
