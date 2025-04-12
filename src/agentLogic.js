const os = require("os");
const cp = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");

dotenv.config();

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-2.0-flash-lite";
const MAX_RETRIES = 3;

const CMD_ADD_BOT_MESSAGE = "addBotMessage";
const CMD_ADD_USER_MESSAGE = "addUserMessage";
const CMD_ADD_ERROR_MESSAGE = "addErrorMessage";
const CMD_ADD_LOG_MESSAGE = "addLogMessage";
const CMD_ENABLE_USER_INPUT = "enableUserInput";
const CMD_DISABLE_USER_INPUT = "disableUserInput";
const CMD_DISPLAY_PLAN = "displayPlan";
const CMD_SHOW_CONFIRMATION_PROMPT = "showConfirmationPrompt";
const CMD_HIDE_CONFIRMATION_PROMPT = "hideConfirmationPrompt";
const CMD_SHOW_FAILURE_REASON_PROMPT = "showFailureReasonPrompt";
const CMD_HIDE_FAILURE_REASON_PROMPT = "hideFailureReasonPrompt";
const CMD_EXECUTION_START = "executionStart";
const CMD_ADD_EXECUTION_OUTPUT = "addExecutionOutput";
const CMD_EXECUTION_END = "executionEnd";
const CMD_RESET_CHAT = "resetChat";

class AgentLogic {
  constructor(sendMessageToWebviewCallback, workspacePath) {
    this.sendMessageToWebview = sendMessageToWebviewCallback;
    this.workspacePath = workspacePath || process.cwd();

    if (!API_KEY) {
      this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, {
        text: "Missing API Key: GEMINI_API_KEY environment variable not set!",
      });
      this.isInitialized = false;
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(API_KEY);
      this.model = this.genAI.getGenerativeModel({ model: MODEL_NAME });
      this.osType = this._getOsType();
      this.history = [];
      this.currentTask = null;
      this.currentPlan = null;
      this.retries = 0;
      this.isBusy = false;
      this.isInitialized = true;
      console.log("AgentLogic initialized. OS:", this.osType);

      if (this.osType === "Unknown") {
        this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, {
          text: "Unsupported operating system detected.",
        });
        this.isInitialized = false;
      }
    } catch (error) {
      console.error("Failed to initialize GenerativeAI:", error);
      if (this.sendMessageToWebview) {
        this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, {
          text: `Failed to initialize AI: ${error.message}`,
        });
      }
      this.isInitialized = false;
    }
  }

  start() {
    if (!this.isInitialized) {
      console.warn("AgentLogic start called, but not initialized.");
      return;
    }
    console.log("AgentLogic started. Requesting initial task.");
    this.sendMessageToWebview(CMD_ADD_BOT_MESSAGE, {
      text: `🖥️ AI Agent ready. Detected OS: ${this.osType}. Waiting for task...`,
    });
    this._requestTaskInput();
  }

  _requestTaskInput() {
    this.currentTask = null;
    this.currentPlan = null;
    this.history = [];
    this.retries = 0;
    this.isBusy = false;
    this.sendMessageToWebview(CMD_ENABLE_USER_INPUT, {
      placeholder: 'Enter task (or type "exit")',
    });
  }

  handleUserInput(input) {
    if (!this.isInitialized) return;
    if (this.isBusy) {
      this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, {
        text: "Agent is busy processing a previous request. Please wait.",
      });
      return;
    }
    input = input.trim();
    if (!input) return;

    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      this.sendMessageToWebview(CMD_ADD_BOT_MESSAGE, { text: "👋 Goodbye!" });
      this.isBusy = true;
      this.sendMessageToWebview(CMD_DISABLE_USER_INPUT, {});
      return;
    }

    this.sendMessageToWebview(CMD_DISABLE_USER_INPUT, {});
    this.isBusy = true;
    this.currentTask = input;
    this.history = [];
    this.retries = 0;
    this._getAIPlan();
  }

  handleConfirmation(confirmed, type) {
    if (!this.isInitialized || !this.isBusy) return;

    this.sendMessageToWebview(CMD_HIDE_CONFIRMATION_PROMPT, {});

    if (type === "execute") {
      if (confirmed && this.currentPlan) {
        this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, {
          type: "info",
          message: "Plan approved. Executing commands...",
        });
        this._executeCommands(this.currentPlan);
      } else {
        this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, {
          type: "info",
          message: "Execution cancelled by user.",
        });
        this._requestTaskInput();
      }
    } else if (type === "success") {
      if (confirmed) {
        this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, {
          type: "success",
          message: "🎉 Task marked as successful by user!",
        });
        this._requestTaskInput();
      } else {
        this._handleTaskFailure(
          "User indicated the goal was not met or task was unsuccessful."
        );
      }
    }
  }

  handleFailureReason(reason) {
    if (!this.isInitialized || !this.isBusy) return;

    this.sendMessageToWebview(CMD_HIDE_FAILURE_REASON_PROMPT, {}); // Hide the prompt UI

    reason = reason.trim();
    if (reason) {
      this.history.push({
        role: "user",
        parts: [
          {
            text: `The previous attempt failed or was insufficient. Reason: ${reason}`,
          },
        ],
      });
      this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, {
        type: "info",
        message: `🔄 Retrying based on feedback (Attempt ${
          this.retries + 1
        }/${MAX_RETRIES})...`,
      });
      this._getAIPlan();
    } else {
      this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, {
        type: "info",
        message: "Retry cancelled by user (no feedback provided).",
      });
      this._requestTaskInput();
    }
  }

  _getOsType() {
    const platform = os.platform();
    if (platform === "win32") return "Windows";
    if (platform === "linux" || platform === "darwin") return "Linux/macOS";
    return "Unknown";
  }

  _formatHistoryForPrompt() {
    let historyText = "";
    if (this.history.length > 0) {
      historyText += "\n--- Previous Attempt History ---";
      this.history.forEach((entry) => {
        if (entry.role === "user" && entry.parts && entry.parts[0]) {
          historyText += `\nUser Feedback: ${entry.parts[0].text}`;
        } else if (entry.role === "model" && entry.planExecuted) {
          historyText += `\nPreviously Proposed Plan:\n\`\`\`\n${entry.planExecuted}\n\`\`\``;
          if (entry.executionLog) {
            const logPreview =
              entry.executionLog.length > 500
                ? entry.executionLog.substring(0, 497) + "..."
                : entry.executionLog;
            historyText += `\nExecution Log:\n${logPreview}\n`;
          }
        }
      });
      historyText += "\n--- End of History ---";
    }
    return historyText;
  }

  async _getAIPlan() {
    try {
      this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, {
        type: "status",
        message: "🤖 Thinking...",
      });

      const promptHistory = this._formatHistoryForPrompt();
      const shellType = this.osType === "Windows" ? "cmd" : "bash";

      const promptParts = [
        `You are an AI assistant that helps execute tasks on a user's local computer.`,
        `The user's operating system is: ${this.osType}.`,
        `The user wants to achieve the following task: '${this.currentTask}'`,
        promptHistory,
        this.history.length > 0
          ? `\nPlease provide a *new*, *revised* sequence of shell commands based on the feedback to achieve the original task.`
          : `\nGenerate a sequence of shell commands to accomplish this task.`,
        `IMPORTANT: Output *only* the commands, each on a new line, enclosed in a single code block. Do not add explanation or commentary before or after the block.`,
        `The code block should look like this:\n\`\`\`${shellType}\ncommand 1\ncommand 2\n...\n\`\`\``,
      ];

      const fullPrompt = promptParts.filter((p) => p).join("\n");
      console.log("Sending prompt to AI:\n", fullPrompt);

      const result = await this.model.generateContent(fullPrompt);
      const response = result.response;
      const responseText = response.text();

      console.log("AI Raw Response:\n", responseText);

      if (!responseText) throw new Error("AI returned an empty response.");

      this.currentPlan = this._parseAIResponse(responseText);
      const planCode = this.currentPlan ? this.currentPlan.join("\n") : "";

      this.history.push({
        role: "model",
        parts: [],
        planExecuted: planCode,
        executionLog: null,
      });

      if (this.currentPlan && this.currentPlan.length > 0) {
        this.sendMessageToWebview(CMD_DISPLAY_PLAN, {
          plan: this.currentPlan,
          code: planCode,
          syntax: shellType,
        });

        this.sendMessageToWebview(CMD_SHOW_CONFIRMATION_PROMPT, {
          type: "execute",
          promptText:
            "Review the plan above. Do you want to execute these commands?",
        });
      } else {
        // Parsed plan is empty, treat as failure
        throw new Error(
          "Failed to parse a valid command plan from the AI response. Response received:\n" +
            responseText
        );
      }
    } catch (error) {
      console.error("Error getting AI plan:", error);
      this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, {
        text: `Failed to get or parse plan from AI: ${error.message}`,
      });
      this._handleTaskFailure("Failed to get or parse a plan from the AI.");
    }
  }

  _parseAIResponse(responseText) {
    const shellType = this.osType === "Windows" ? "cmd" : "bash";
    const pattern = new RegExp(
      `\`\`\`(?:${shellType}|sh|bat|batch|shell)?\\s*([\\s\\S]+?)\\s*\`\`\``,
      "i"
    );
    const match = responseText.match(pattern);

    let commands = [];
    if (match && match[1]) {
      commands = match[1]
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .map((line) => line.replace(/^\s*(\d+\.|\-|\*)\s+/, ""))
        .filter((line) => line && !/^\s*(#|\/\/)/.test(line));
    } else {
      console.warn(
        "Could not find code block in AI response. Trying fallback parsing."
      );
      commands = responseText
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .map((line) => line.replace(/^\s*(\d+\.|\-|\*)\s+/, ""))
        .filter((line) => line && !/^\s*(#|\/\/)/.test(line));
      if (commands.length > 0) {
        this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, {
          type: "warning",
          message:
            "Warning: Parsed commands directly from response text (no code block found). Review plan carefully.",
        });
      }
    }

    if (commands.length === 0 && responseText.trim().length > 0) {
      console.warn(
        "Parsing failed to extract any commands from:",
        responseText
      );
    }

    console.log("Parsed commands:", commands);
    return commands;
  }

  async _executeCommands(commands) {
    this.sendMessageToWebview(CMD_DISABLE_USER_INPUT, {});
    this.sendMessageToWebview(CMD_EXECUTION_START, {
      commandCount: commands.length,
    });

    let scriptContent = commands.join(os.EOL);
    let scriptPath = "";
    let success = false;
    let fullLog = "";
    let exitCode = -1;

    const tempDir = os.tmpdir();
    const fileSuffix = this.osType === "Windows" ? ".bat" : ".sh";
    scriptPath = path.join(
      tempDir,
      `vscode_agent_script_${process.pid}${Date.now()}${fileSuffix}`
    );

    try {
      await fs.writeFile(scriptPath, scriptContent, { encoding: "utf-8" });
      console.log(`Temporary script written to: ${scriptPath}`);

      if (this.osType === "Linux/macOS") {
        await fs.chmod(scriptPath, 0o755); // rwxr-xr-x
      }

      let cmd, args, options;
      if (this.osType === "Windows") {
        cmd = "cmd.exe"; // Use cmd.exe
        args = ["/c", scriptPath];
        options = {
          windowsHide: true,
          encoding: "utf-8",
          shell: false,
          cwd: this.workspacePath,
        };
      } else {
        // Linux/macOS
        cmd = "/bin/bash";
        args = [scriptPath];
        options = { cwd: this.workspacePath, encoding: "utf-8", shell: false };
      }
      console.log(`Executing: ${cmd} ${args.join(" ")}`);
      const child = cp.spawn(cmd, args, options);

      let stdoutData = "";
      let stderrData = "";

      child.stdout.on("data", (data) => {
        const text = data.toString();
        stdoutData += text;
        fullLog += `[STDOUT] ${text}`;
        text.split("\n").forEach((line) => {
          if (line.trim()) {
            this.sendMessageToWebview(CMD_ADD_EXECUTION_OUTPUT, {
              text: line,
              isError: false,
            });
          }
        });
      });

      child.stderr.on("data", (data) => {
        const text = data.toString();
        stderrData += text;
        fullLog += `[STDERR] ${text}`;
        text.split("\n").forEach((line) => {
          if (line.trim()) {
            this.sendMessageToWebview(CMD_ADD_EXECUTION_OUTPUT, {
              text: line,
              isError: true,
            });
          }
        });
      });

      exitCode = await new Promise((resolve, reject) => {
        child.on("close", (code) => {
          console.log(`Script execution finished with code: ${code}`);
          resolve(code);
        });
        child.on("error", (err) => {
          console.error("Failed to start subprocess.", err);
          fullLog += `\n[ERROR] Spawning process failed: ${err.message}`;
          reject(err);
        });
      });

      success = exitCode === 0;
      if (!success && !stderrData) {
        const failureMsg = `Script exited with non-zero code ${exitCode} but no specific error output.`;
        fullLog += `\n[ERROR] ${failureMsg}`;
        console.warn(failureMsg);
      }
    } catch (error) {
      console.error("Error during command execution phase:", error);
      success = false;
      exitCode = -1;
      fullLog += `\n[ERROR] Execution failed: ${error.message || error}`;
      this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, {
        text: `Execution setup failed: ${error.message}`,
      });
    } finally {
      if (scriptPath) {
        try {
          await fs.unlink(scriptPath);
          console.log(`Temporary script deleted: ${scriptPath}`);
        } catch (unlinkError) {
          console.warn(
            `Could not delete temporary script ${scriptPath}:`,
            unlinkError
          );
          this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, {
            type: "warning",
            message: `Warning: Failed to delete temp file ${scriptPath}`,
          });
        }
      }

      const lastHistoryEntry = this.history[this.history.length - 1];
      if (lastHistoryEntry && lastHistoryEntry.role === "model") {
        lastHistoryEntry.executionLog = fullLog.trim();
      } else {
        console.warn(
          "Could not find matching history entry to store execution log."
        );
      }

      this.sendMessageToWebview(CMD_EXECUTION_END, {
        success,
        exitCode,
        log: fullLog.trim(),
      });

      if (success) {
        this.sendMessageToWebview(CMD_SHOW_CONFIRMATION_PROMPT, {
          type: "success",
          promptText:
            "Commands executed successfully (exit code 0). Did this achieve your overall goal?",
        });
      } else {
        const failureReason =
          stderrData.trim() || `Script failed with exit code ${exitCode}.`;
        this._handleTaskFailure(failureReason);
      }
    }
  }

  _handleTaskFailure(reason) {
    this.retries++;
    const logMessage = reason
      ? `Failure details: ${reason}`
      : "Task failed or was unsuccessful.";

    this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, {
      text: `Task failed (Attempt ${this.retries}/${MAX_RETRIES}). ${logMessage}`,
    });

    if (this.retries >= MAX_RETRIES) {
      this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, {
        text: `❌ Maximum retries (${MAX_RETRIES}) reached. Task abandoned.`,
      });
      this._requestTaskInput();
    } else {
      this.sendMessageToWebview(CMD_SHOW_FAILURE_REASON_PROMPT, {
        promptText: `Attempt ${this.retries} failed. Please describe why or what needs to change (leave blank to stop retrying):`,
      });
    }
  }
}

module.exports = { AgentLogic };
