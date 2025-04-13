# 🧠 AI Local Agent — Natural Language to Terminal Commands

**AI Local Agent** is a CLI + VS Code extension that allows you to describe tasks in natural language and automatically turns them into executable shell commands. It leverages a generative AI model to plan and run terminal tasks with interactive feedback and retries — all from your terminal or editor.

🎥 **Video Demo:** [Watch it](https://drive.google.com/drive/folders/1i6q3jk_jFcRPtlxC0JeTruQQJhYGQNiA?usp=sharing)

---

## ✨ Features

- 🚣️ **Natural language to commands**: Type your goal in plain English.
- 🧠 **AI-powered planning**: Uses Google Gemini API to plan terminal commands.
- ⟳ **Interactive execution flow**:
  - Displays the plan for approval.
  - Runs the commands on your local system after confirmation.
  - Asks whether the task was successful.
  - If not, takes feedback and refines the plan with AI.
- 🧪 **Handles retries**: Automatically retries failed plans up to 3 times.
- 🔄 **Cross-platform**: Works on macOS, Linux, and Windows.
- ✨ **Optional VS Code Extension**: Chat with the agent directly in your editor.

---

## 📚 How It Works

1. You start by describing a task like:

   > "Generate a Python script that prints numbers 1 to 10 and run it."

2. The agent will:

   - Analyze your input
   - Ask Gemini AI to create a terminal command plan
   - Show you the plan (e.g. writing and running a script)

3. After your confirmation:

   - It creates and executes the command/script
   - Shows the output

4. If the result is not what you expected:
   - Give feedback (e.g. "It failed because of a syntax error")
   - The AI will fix the plan and retry

---

## ⚙️ Installation

### 1. Clone the Repo

```bash
git clone https://github.com/saijayanth59/CLI-agent.git
cd CLI-agent
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up API Key

This project uses [Gemini API](https://ai.google.dev/). Set your API key in a `.env` file:

```env
GEMINI_API_KEY=your_api_key_here
```

### 4. Run and Debug extension.js present in src

```bash
- Press `F5` to launch the extension in a new window.
- In the new window, open the "AI Agent Chat" view.
```

## (Currently, it is integrated within VS Code UI. Direct CLI-only mode support coming soon)

## 🎨 Example Task

> "Create a Node.js script that reads a file and logs its contents. Then run it."

The AI will generate something like:

```bash
cat <<EOF > readFile.js
const fs = require('fs');
fs.readFile('sample.txt', 'utf8', (err, data) => {
  if (err) throw err;
  console.log(data);
});
EOF
node readFile.js
```

You can review, approve, and execute with one click or reply.

---

## 🚀 Technologies Used

- [VS Code Extensions API](https://code.visualstudio.com/api)
- [Google Generative AI (Gemini)](https://ai.google.dev/)
- Node.js + Webview

---

## 📆 Roadmap

- [ ] Better CLI-only interface
- [ ] Task persistence & history panel
- [ ] Multi-step task support with context
- [ ] Add support for other AI providers (e.g., OpenAI, Claude)

---

## 🙌 Contributing

PRs and suggestions welcome! File an issue or drop feedback if something doesn't work as expected.

---

## 📁 Project Structure

```
.
├── src
│   ├── agentLogic.js          # Core AI agent logic
│   ├── AgentViewProvider.js   # VS Code view integration
│   └── extension.js           # VS Code extension entry point
├── media
│   └── main.js                # Webview JS for chat UI
├── .env
├── package.json
└── README.md
```

---

## 💪 License

MIT License

---

## 🚀 Get Started Now

Start talking to your terminal like it's your developer assistant. Type a task and let the AI do the rest!
