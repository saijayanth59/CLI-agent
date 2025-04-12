// --- START OF FILE src/agentLogic.js ---
const os = require('os');
const cp = require('child_process');
const fs = require('fs/promises'); // Use promises version of fs
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');

// Load .env file if present
dotenv.config();

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-2.0-flash-lite"; // Or "gemini-pro", etc.
const MAX_RETRIES = 3;

// --- Markers for Webview Communication ---
// Used as the 'command' field when sending messages TO the webview
const CMD_ADD_BOT_MESSAGE = "addBotMessage"; // Standard bot message
const CMD_ADD_USER_MESSAGE = "addUserMessage"; // Echo user input (sent from viewProvider)
const CMD_ADD_ERROR_MESSAGE = "addErrorMessage"; // Show an error message
const CMD_ADD_LOG_MESSAGE = "addLogMessage";   // Show informational/status log message
const CMD_ENABLE_USER_INPUT = "enableUserInput"; // Allow user typing
const CMD_DISABLE_USER_INPUT = "disableUserInput"; // Prevent user typing
const CMD_DISPLAY_PLAN = "displayPlan";       // Show the formatted execution plan
const CMD_SHOW_CONFIRMATION_PROMPT = "showConfirmationPrompt"; // Ask Yes/No
const CMD_HIDE_CONFIRMATION_PROMPT = "hideConfirmationPrompt"; // Hide Yes/No buttons
const CMD_SHOW_FAILURE_REASON_PROMPT = "showFailureReasonPrompt"; // Ask for text input
const CMD_HIDE_FAILURE_REASON_PROMPT = "hideFailureReasonPrompt"; // Hide text input
const CMD_EXECUTION_START = "executionStart";   // Signal execution is beginning
const CMD_ADD_EXECUTION_OUTPUT = "addExecutionOutput"; // Stream execution output/error
const CMD_EXECUTION_END = "executionEnd";       // Signal execution finished
const CMD_RESET_CHAT = "resetChat";           // Tell UI to clear itself (sent from viewProvider on restart)


class AgentLogic {
    constructor(sendMessageToWebviewCallback, workspacePath) {
        // Assign callback *first* so we can use it immediately for errors
        this.sendMessageToWebview = sendMessageToWebviewCallback;
        this.workspacePath = workspacePath || process.cwd();

        if (!API_KEY) {
            this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, { text: 'Missing API Key: GEMINI_API_KEY environment variable not set!' });
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
                 this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, { text: "Unsupported operating system detected." });
                this.isInitialized = false;
             }
        } catch (error) {
            console.error("Failed to initialize GenerativeAI:", error);
             // Make sure sendMessageToWebview is assigned before this point
            if(this.sendMessageToWebview){
                 this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, { text: `Failed to initialize AI: ${error.message}` });
            }
            this.isInitialized = false;
        }
    }

    // Called when the webview is ready and agent should start interaction
    start() {
        if (!this.isInitialized) {
             console.warn("AgentLogic start called, but not initialized.");
             // Error message likely sent during construction
             return;
         }
        console.log("AgentLogic started. Requesting initial task.");
         // Send initial welcome message using the appropriate command
        this.sendMessageToWebview(CMD_ADD_BOT_MESSAGE, { text: `🖥️ AI Agent ready. Detected OS: ${this.osType}. Waiting for task...` });
         this._requestTaskInput();
    }

    // Reset state and ask for new task input
    _requestTaskInput() {
        this.currentTask = null;
        this.currentPlan = null;
        this.history = [];
        this.retries = 0;
        this.isBusy = false;
         // Enable input in the webview
        this.sendMessageToWebview(CMD_ENABLE_USER_INPUT, { placeholder: 'Enter task (or type "exit")' });
    }

    // --- Public methods called by AgentViewProvider ---

    handleUserInput(input) {
         if (!this.isInitialized) return; // Do nothing if not setup correctly
         if (this.isBusy) {
             this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, { text: "Agent is busy processing a previous request. Please wait." });
            return;
         }
         input = input.trim();
         if (!input) return; // Ignore empty input

         // User wants to exit
         if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
            this.sendMessageToWebview(CMD_ADD_BOT_MESSAGE, { text: "👋 Goodbye!" });
             this.isBusy = true; // Prevent further actions after exit
             this.sendMessageToWebview(CMD_DISABLE_USER_INPUT, {}); // Disable input
             // In a real app, might trigger view closure or other cleanup
            return;
         }

        // Process as a new task
        this.sendMessageToWebview(CMD_DISABLE_USER_INPUT, {}); // Disable input during processing
        this.isBusy = true;
        this.currentTask = input;
        this.history = []; // Clear history for new task
        this.retries = 0;
         this._getAIPlan(); // Start the workflow
    }

    // Handle Yes/No confirmation from webview
    handleConfirmation(confirmed, type) {
        if (!this.isInitialized || !this.isBusy) return;

        this.sendMessageToWebview(CMD_HIDE_CONFIRMATION_PROMPT, {}); // Hide the prompt UI

        if (type === 'execute') { // Confirmation for plan execution
            if (confirmed && this.currentPlan) {
                 this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, { type: 'info', message: "Plan approved. Executing commands..." });
                 this._executeCommands(this.currentPlan); // Proceed with execution
            } else {
                this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, { type: 'info', message: "Execution cancelled by user." });
                this._requestTaskInput(); // Cancelled, ask for a new task
            }
        } else if (type === 'success') { // Confirmation for task success
            if (confirmed) {
                 this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, { type: 'success', message: "🎉 Task marked as successful by user!" });
                this._requestTaskInput(); // Success, ask for a new task
            } else {
                 // User said it wasn't successful, proceed to failure/retry logic
                this._handleTaskFailure("User indicated the goal was not met or task was unsuccessful.");
            }
        }
    }

    // Handle failure reason text submitted from webview
    handleFailureReason(reason) {
        if (!this.isInitialized || !this.isBusy) return;

        this.sendMessageToWebview(CMD_HIDE_FAILURE_REASON_PROMPT, {}); // Hide the prompt UI

        reason = reason.trim();
        if (reason) {
            // Add user feedback to history and attempt retry
            this.history.push({ role: 'user', parts: [{ text: `The previous attempt failed or was insufficient. Reason: ${reason}` }] });
            // Use Log Message for status updates
            this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, { type: 'info', message: `🔄 Retrying based on feedback (Attempt ${this.retries + 1}/${MAX_RETRIES})...` });
             this._getAIPlan(); // Generate a revised plan
        } else {
            // No reason given, user wants to cancel retries
            this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, { type: 'info', message: "Retry cancelled by user (no feedback provided)." });
            this._requestTaskInput(); // Cancelled, ask for a new task
        }
    }

    // --- Private helper methods ---

    _getOsType() {
        const platform = os.platform();
        if (platform === 'win32') return "Windows";
        if (platform === 'linux' || platform === 'darwin') return "Linux/macOS";
        return "Unknown";
    }

    // Prepare history for inclusion in the AI prompt
    _formatHistoryForPrompt() {
        let historyText = "";
        if (this.history.length > 0) {
            historyText += "\n--- Previous Attempt History ---";
             this.history.forEach(entry => {
                 if (entry.role === 'user' && entry.parts && entry.parts[0]) {
                     historyText += `\nUser Feedback: ${entry.parts[0].text}`;
                 } else if (entry.role === 'model' && entry.planExecuted) {
                     // Use textContent consistently for parts from the model side as well if applicable
                    historyText += `\nPreviously Proposed Plan:\n\`\`\`\n${entry.planExecuted}\n\`\`\``;
                     if (entry.executionLog) {
                         // Limit log size in history to avoid excessive prompt length?
                         const logPreview = entry.executionLog.length > 500 ? entry.executionLog.substring(0, 497) + "..." : entry.executionLog;
                        historyText += `\nExecution Log:\n${logPreview}\n`;
                    }
                 }
             });
            historyText += "\n--- End of History ---";
        }
        return historyText;
    }

    // Get plan from Gemini AI
    async _getAIPlan() {
        try {
             // Use Log message for status
            this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, { type: 'status', message: "🤖 Thinking..." });

            const promptHistory = this._formatHistoryForPrompt();
            const shellType = this.osType === 'Windows' ? 'cmd' : 'bash';

             // Build the prompt carefully
            const promptParts = [
                 `You are an AI assistant that helps execute tasks on a user's local computer.`,
                 `The user's operating system is: ${this.osType}.`,
                 `The user wants to achieve the following task: '${this.currentTask}'`,
                promptHistory,
                 (this.history.length > 0
                    ? `\nPlease provide a *new*, *revised* sequence of shell commands based on the feedback to achieve the original task.`
                    : `\nGenerate a sequence of shell commands to accomplish this task.`),
                `IMPORTANT: Output *only* the commands, each on a new line, enclosed in a single code block. Do not add explanation or commentary before or after the block.`,
                 `The code block should look like this:\n\`\`\`${shellType}\ncommand 1\ncommand 2\n...\n\`\`\``
             ];

             const fullPrompt = promptParts.filter(p => p).join('\n');
             console.log("Sending prompt to AI:\n", fullPrompt); // For debugging

             const result = await this.model.generateContent(fullPrompt);
             const response = result.response; // Use optional chaining if needed: await result.response;
            const responseText = response.text();

             console.log("AI Raw Response:\n", responseText); // For debugging

            if (!responseText) throw new Error("AI returned an empty response.");

             this.currentPlan = this._parseAIResponse(responseText); // Parse the commands
            const planCode = this.currentPlan ? this.currentPlan.join('\n') : ''; // Ensure currentPlan is not null

             // Record this attempt in history *before* asking for confirmation
             // Store the parsed plan (planCode) rather than raw AI response
             this.history.push({
                role: 'model',
                parts: [], // Representing the AI's plan generation action
                planExecuted: planCode, // Store the structured plan code
                executionLog: null // Will be filled after execution attempt
            });

            if (this.currentPlan && this.currentPlan.length > 0) {
                 // Send the plan details to the webview for display
                this.sendMessageToWebview(CMD_DISPLAY_PLAN, {
                    plan: this.currentPlan,
                    code: planCode,
                    syntax: shellType
                });
                // Ask for confirmation to execute
                this.sendMessageToWebview(CMD_SHOW_CONFIRMATION_PROMPT, { type: 'execute', promptText: "Review the plan above. Do you want to execute these commands?" });
            } else {
                // Parsed plan is empty, treat as failure
                throw new Error("Failed to parse a valid command plan from the AI response. Response received:\n" + responseText);
            }

         } catch (error) {
             console.error("Error getting AI plan:", error);
             // Use specific error command
             this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, { text: `Failed to get or parse plan from AI: ${error.message}` });
            // Trigger the task failure logic, allowing for retry if possible
             this._handleTaskFailure("Failed to get or parse a plan from the AI.");
        }
    }

    // Parse commands from ```code blocks``` in AI response
    _parseAIResponse(responseText) {
        const shellType = this.osType === "Windows" ? "cmd" : "bash";
        const pattern = new RegExp(`\`\`\`(?:${shellType}|sh|bat|batch|shell)?\\s*([\\s\\S]+?)\\s*\`\`\``, 'i');
        const match = responseText.match(pattern);

         let commands = [];
        if (match && match[1]) {
             commands = match[1].trim().split('\n')
                 .map(line => line.trim())
                 .map(line => line.replace(/^\s*(\d+\.|\-|\*)\s+/, '')) // Remove list markers more reliably
                 .filter(line => line && !/^\s*(#|\/\/)/.test(line)); // Filter empty lines & comments (start of line)
         } else {
             console.warn("Could not find code block in AI response. Trying fallback parsing.");
            // Fallback might be less reliable, attempt to split by newline
            commands = responseText.trim().split('\n')
                .map(line => line.trim())
                .map(line => line.replace(/^\s*(\d+\.|\-|\*)\s+/, ''))
                 .filter(line => line && !/^\s*(#|\/\/)/.test(line));
            if (commands.length > 0) {
                this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, {type: 'warning', message: "Warning: Parsed commands directly from response text (no code block found). Review plan carefully."});
             }
        }

         if (commands.length === 0 && responseText.trim().length > 0) {
            // If parsing failed but there *was* text, let the user know
             console.warn("Parsing failed to extract any commands from:", responseText);
            // Do not send a warning here, the caller (_getAIPlan) handles the empty plan error.
        }

         console.log("Parsed commands:", commands);
         return commands;
    }


    // Execute the list of commands
    async _executeCommands(commands) {
        this.sendMessageToWebview(CMD_DISABLE_USER_INPUT, {}); // Ensure disabled during execution
        // Signal start of execution
        this.sendMessageToWebview(CMD_EXECUTION_START, { commandCount: commands.length });

        let scriptContent = commands.join(os.EOL); // OS-specific line endings
        let scriptPath = '';
        let success = false;
        let fullLog = ''; // Capture both stdout and stderr
        let exitCode = -1; // Default to error

        const tempDir = os.tmpdir();
        const fileSuffix = this.osType === 'Windows' ? '.bat' : '.sh';
        scriptPath = path.join(tempDir, `vscode_agent_script_${process.pid}${Date.now()}${fileSuffix}`); // Added timestamp for more uniqueness

        try {
            // Write the script file
            await fs.writeFile(scriptPath, scriptContent, { encoding: 'utf-8' });
            console.log(`Temporary script written to: ${scriptPath}`);

            // Set executable permissions (non-Windows)
            if (this.osType === 'Linux/macOS') {
                await fs.chmod(scriptPath, 0o755); // rwxr-xr-x
            }

            // Determine command and arguments
            let cmd, args, options;
            if (this.osType === 'Windows') {
                cmd = 'cmd.exe'; // Use cmd.exe
                args = ['/c', scriptPath]; // /c runs the command then terminates
                options = { windowsHide: true, encoding: 'utf-8', shell: false, cwd: this.workspacePath, }; // Important: shell: false when specifying .exe
            } else { // Linux/macOS
                cmd = '/bin/bash'; // Specify bash (or potentially 'sh')
                args = [scriptPath];
                options = { cwd: this.workspacePath, encoding: 'utf-8', shell: false }; // Execute script directly
            }
            console.log(`Executing: ${cmd} ${args.join(' ')}`);

            // Spawn the child process
            const child = cp.spawn(cmd, args, options);

            // --- Stream Output & Errors to Webview ---
            // Fixed typo here: stdoutData instead of sttoutData
            let stdoutData = '';
            let stderrData = '';
       

            child.stdout.on('data', (data) => {
                const text = data.toString();
                stdoutData += text;
                fullLog += `[STDOUT] ${text}`; // Prefix log entries for clarity
                // Send chunked output lines to webview
                text.split('\n').forEach(line => {
                    if (line.trim()) {
                        this.sendMessageToWebview(CMD_ADD_EXECUTION_OUTPUT, { text: line, isError: false });
                    }
                });
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                stderrData += text;
                fullLog += `[STDERR] ${text}`; // Prefix log entries
                text.split('\n').forEach(line => {
                    if (line.trim()) {
                        this.sendMessageToWebview(CMD_ADD_EXECUTION_OUTPUT, { text: line, isError: true });
                    }
                });
            });

            // --- Wait for Process Exit ---
            exitCode = await new Promise((resolve, reject) => {
                child.on('close', (code) => {
                    console.log(`Script execution finished with code: ${code}`);
                    resolve(code); // Resolve promise with the exit code
                });
                child.on('error', (err) => {
                    console.error('Failed to start subprocess.', err);
                    fullLog += `\n[ERROR] Spawning process failed: ${err.message}`;
                    reject(err); // Reject promise on spawn error
                });
            });

             // Determine success based on exit code
            success = (exitCode === 0);
             if (!success && !stderrData) { // Log error even if stderr was empty but exit code != 0
                 const failureMsg = `Script exited with non-zero code ${exitCode} but no specific error output.`;
                fullLog += `\n[ERROR] ${failureMsg}`;
                 console.warn(failureMsg);
            }

         } catch (error) {
             // Catch errors from file operations, chmod, or process spawning errors rejected by the promise
             console.error('Error during command execution phase:', error);
             success = false;
             exitCode = -1; // Indicate execution error
             fullLog += `\n[ERROR] Execution failed: ${error.message || error}`;
            // Send explicit error message to UI
            this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, { text: `Execution setup failed: ${error.message}` });
        } finally {
            // --- Cleanup Temporary File ---
             if (scriptPath) {
                try {
                    await fs.unlink(scriptPath); // Delete file asynchronously
                     console.log(`Temporary script deleted: ${scriptPath}`);
                 } catch (unlinkError) {
                    console.warn(`Could not delete temporary script ${scriptPath}:`, unlinkError);
                     // Optionally inform the user?
                     this.sendMessageToWebview(CMD_ADD_LOG_MESSAGE, { type: 'warning', message: `Warning: Failed to delete temp file ${scriptPath}` });
                 }
             }

            // --- Update History ---
            const lastHistoryEntry = this.history[this.history.length - 1];
             if (lastHistoryEntry && lastHistoryEntry.role === 'model') {
                 lastHistoryEntry.executionLog = fullLog.trim(); // Add the captured log
             } else {
                 console.warn("Could not find matching history entry to store execution log.");
             }

             // --- Signal End of Execution ---
            this.sendMessageToWebview(CMD_EXECUTION_END, { success, exitCode, log: fullLog.trim() });

             // --- Decide Next Step (Success Confirmation or Failure Handling) ---
             if (success) {
                this.sendMessageToWebview(CMD_SHOW_CONFIRMATION_PROMPT, { type: 'success', promptText: "Commands executed successfully (exit code 0). Did this achieve your overall goal?" });
             } else {
                 // Pass a relevant reason based on captured info
                 const failureReason = stderrData.trim() || `Script failed with exit code ${exitCode}.`;
                 this._handleTaskFailure(failureReason);
             }
         }
     } // end _executeCommands

    // Handle failure logic (check retries, ask for reason)
    _handleTaskFailure(reason) {
        this.retries++; // Increment retry count for this task
        const logMessage = reason ? `Failure details: ${reason}` : "Task failed or was unsuccessful.";

         // Use the error message command for clear indication
        this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, { text: `Task failed (Attempt ${this.retries}/${MAX_RETRIES}). ${logMessage}` });

        if (this.retries >= MAX_RETRIES) {
            this.sendMessageToWebview(CMD_ADD_ERROR_MESSAGE, { text: `❌ Maximum retries (${MAX_RETRIES}) reached. Task abandoned.` });
             this._requestTaskInput(); // Give up and ask for a new task
         } else {
             // Ask user for feedback/reason
             this.sendMessageToWebview(CMD_SHOW_FAILURE_REASON_PROMPT, { promptText: `Attempt ${this.retries} failed. Please describe why or what needs to change (leave blank to stop retrying):` });
             // isBusy remains true, waiting for user input via handleFailureReason
         }
    }

} // End of AgentLogic class

module.exports = { AgentLogic }; // Export the class
// --- END OF FILE src/agentLogic.js ---