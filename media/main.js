(function () {
  const vscode = acquireVsCodeApi();

  const messagesContainer = document.getElementById("messages");
  const messageInput = document.getElementById("message-input");
  const sendButton = document.getElementById("send-button");
  const promptsContainer = document.getElementById("prompts-container");
  const restartContainer = document.getElementById("restart-container");
  const restartButton = document.getElementById("restart-agent-button");
  const executionOutputContainer = document.getElementById(
    "execution-output-container"
  );
  const executionOutputPre = document.getElementById("execution-output");

  function addMessage(type, text) {
    if (!messagesContainer) return;
    const messageDiv = document.createElement("div");
    const safeType = [
      "user",
      "bot",
      "error",
      "log",
      "status",
      "success",
      "warning",
    ].includes(type)
      ? type
      : "log";
    messageDiv.classList.add("message", safeType);
    messageDiv.textContent = text || "(empty message)";
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
  }

  function clearPrompts() {
    if (promptsContainer) promptsContainer.innerHTML = "";
  }

  function clearExecutionOutput() {
    if (executionOutputContainer)
      executionOutputContainer.style.display = "none";
    if (executionOutputPre) executionOutputPre.innerHTML = "";
  }

  function clearChat() {
    if (messagesContainer) messagesContainer.innerHTML = "";
    clearPrompts();
    clearExecutionOutput();
    if (restartContainer) restartContainer.style.display = "none";
  }

  function scrollToBottom() {
    setTimeout(() => {
      if (messagesContainer)
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      if (
        executionOutputPre &&
        executionOutputContainer &&
        executionOutputContainer.style.display !== "none"
      ) {
        executionOutputPre.scrollTop = executionOutputPre.scrollHeight;
      }
    }, 50);
  }

  function createButton(id, text, onClick) {
    const button = document.createElement("button");
    button.id = id;
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  if (messageInput) {
    messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !messageInput.disabled) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
  if (sendButton) sendButton.addEventListener("click", sendMessage);
  if (restartButton)
    restartButton.addEventListener("click", () => {
      vscode.postMessage({ command: "requestAgentRestart" });
    });

  function sendMessage() {
    if (!messageInput || messageInput.disabled) return;
    const text = messageInput.value.trim();
    if (text) {
      vscode.postMessage({ command: "sendMessage", text: text });
      messageInput.value = "";
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    const command = message.command;
    const data = message.data || {};

    console.log("WebView Received:", command, data);

    switch (command) {
      case "addBotMessage":
        addMessage("bot", data.text);
        break;
      case "addUserMessage":
        addMessage("user", data.text);
        break;
      case "addErrorMessage":
        addMessage("error", data.text);
        break;
      case "addLogMessage":
        addMessage(data.type || "log", data.message);
        break;

      // Input control
      case "enableUserInput":
        if (messageInput) messageInput.disabled = false;
        if (sendButton) sendButton.disabled = false;
        if (messageInput)
          messageInput.placeholder = data.placeholder || "Enter input...";
        if (messageInput) messageInput.focus();
        break;
      case "disableUserInput":
        if (messageInput) messageInput.disabled = true;
        if (sendButton) sendButton.disabled = true;
        if (messageInput)
          messageInput.placeholder =
            data.placeholder || "Agent is processing...";
        break;

      // Complex UI Updates
      case "displayPlan":
        clearPrompts();
        if (data && data.code && messagesContainer) {
          const planDiv = document.createElement("div");
          planDiv.classList.add("message", "bot"); // Display plan within a 'bot' message container
          const planContainer = document.createElement("div");
          planContainer.classList.add("plan-container"); // Specific styling for the plan box
          const title = document.createElement("h4");
          title.textContent = "Execution Plan:";
          const pre = document.createElement("pre");
          pre.textContent = data.code; // Safer: use textContent directly
          planContainer.appendChild(title);
          planContainer.appendChild(pre);
          planDiv.appendChild(planContainer);
          messagesContainer.appendChild(planDiv);
          scrollToBottom();
        } else {
          addMessage("bot", "(Agent did not provide a valid plan to display)");
        }
        break;

      case "showConfirmationPrompt":
        clearPrompts();
        const confirmPromptText = data.promptText || "Confirm?";
        if (promptsContainer) {
          promptsContainer.appendChild(
            document.createTextNode(confirmPromptText + " ")
          ); // Label for buttons
          promptsContainer.appendChild(
            createButton("confirm-yes", "Yes", () => {
              vscode.postMessage({
                command:
                  data.type === "success"
                    ? "confirmSuccess"
                    : "confirmExecution",
                confirm: true,
              });
              clearPrompts(); // Clear immediately after clicking
            })
          );
          promptsContainer.appendChild(
            createButton("confirm-no", "No", () => {
              vscode.postMessage({
                command:
                  data.type === "success"
                    ? "confirmSuccess"
                    : "confirmExecution",
                confirm: false,
              });
              clearPrompts(); // Clear immediately after clicking
            })
          );
        }
        scrollToBottom(); // Ensure prompts are visible
        break;

      case "hideConfirmationPrompt":
        clearPrompts();
        break;

      case "showFailureReasonPrompt":
        clearPrompts();
        const reasonPromptText = data.promptText || "Please provide feedback:";
        if (promptsContainer) {
          promptsContainer.appendChild(
            document.createTextNode(reasonPromptText + " ")
          );
          const reasonInput = document.createElement("input");
          reasonInput.type = "text";
          reasonInput.id = "failure-reason-input";
          reasonInput.placeholder = "Enter reason or leave blank to cancel...";
          promptsContainer.appendChild(reasonInput);
          promptsContainer.appendChild(
            createButton("submit-reason", "Submit Feedback", () => {
              vscode.postMessage({
                command: "sendFailureReason",
                reason: reasonInput.value,
              });
              clearPrompts();
            })
          );
          promptsContainer.appendChild(
            createButton("cancel-reason", "Cancel Retry", () => {
              vscode.postMessage({ command: "sendFailureReason", reason: "" }); // Empty string signals cancellation
              clearPrompts();
            })
          );
          reasonInput.focus();
        }
        scrollToBottom();
        break;

      case "hideFailureReasonPrompt":
        clearPrompts();
        break;

      // --- Execution Handling ---
      case "executionStart": // Command received from AgentLogic
        clearExecutionOutput(); // Clear previous output *AND hide* the container
        if (executionOutputContainer)
          executionOutputContainer.style.display = "block"; // *** Explicitly show the container ***
        addMessage(
          "log",
          `🚀 Executing ${data.commandCount || "?"} commands...`
        );
        break;

      case "addExecutionOutput": // Command received from AgentLogic
        if (executionOutputContainer && executionOutputPre) {
          if (executionOutputContainer.style.display === "none") {
            executionOutputContainer.style.display = "block";
          }
          const lineSpan = document.createElement("span");
          lineSpan.textContent = (data.text || "") + "\n";
          if (data.isError) {
            lineSpan.classList.add("error-line"); // Apply error styling
          }
          executionOutputPre.appendChild(lineSpan);
          scrollToBottom(); // Scroll the output area
        }
        break;

      case "executionEnd": // Command received from AgentLogic
        const endMsg = data.success
          ? `✅ Execution finished (Code: ${data.exitCode})`
          : `❌ Execution failed (Code: ${data.exitCode})`;
        addMessage(data.success ? "success" : "error", endMsg);
        // Keep the output container visible so the user can see the final state
        break;

      // --- Other Commands ---
      case "showRestartButton":
        if (restartContainer) restartContainer.style.display = "block";
        if (messageInput) messageInput.disabled = true;
        if (sendButton) sendButton.disabled = true;
        if (messageInput)
          messageInput.placeholder = "Agent stopped. Please Restart.";
        break;

      case "resetChat": // Usually called on restart request
        clearChat();
        break;

      default:
        console.warn("WebView received unknown command:", command, data);
    }
  });

  addMessage("status", "Initializing Agent Interface...");
  vscode.postMessage({ command: "webviewLoaded" });
  console.log("Webview script loaded, posted 'webviewLoaded' to extension.");
})();
