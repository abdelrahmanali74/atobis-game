# 🎮 online-games (Atobis & Spy Game)

A robust, real-time multiplayer game platform featuring two popular social games:
1. **Atobis Complete (Bus Complete):** A classic word game where players race to find words starting with a specific letter across various categories.
2. **Spy Game:** A social deduction game where players try to identify the spy among them based on a secret word.

## ✨ Features

### 🔌 Connectivity & Resilience
- **Smart Reconnection:** Players can refresh or disconnect and rejoin exactly where they left off (same screen, score, and timer).
- **Timer Synchronization:** Game timers are synced with the server, ensuring fairness even if a client disconnects.
- **Host Migration:** If the host disconnects, leadership is automatically transferred to the next active player.
- **Room Management:** Inactive rooms are automatically cleaned up to save server resources.
- **Rate Limiting:** Protection against spam and abuse.

### 🚌 Atobis Complete
- Multiple rounds with customizable categories.
- Real-time scoring updates.
- Interactive scoring phase where the host can adjust points.
- Leaderboard and podium finish.

### 🕵️ Spy Game
- Role assignment (Spy vs. Civilians).
- Dynamic discussion timer.
- Voting system to eliminate suspects.
- Location/Word guessing for the Spy.
- Complete game state recovery on reconnection.

## 🚀 Getting Started

### Prerequisites
- Node.js (v14+ recommended)
- npm

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/REPO_NAME.git
   cd atobis-spy-game
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Server
```bash
npm start
```
The server will start on port `3000` (default) or the port specified in `.env`.

Open your browser and navigate to: `http://localhost:3000`

## 🛠️ Tech Stack
- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Real-time Communication:** Socket.IO

## 🤝 Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License
This project is open-source and available under the MIT License.
