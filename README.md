# 🎬 YouTube Video Chat

Chat with any YouTube video using AI. This app fetches a video’s transcript, stores it in Firestore, and lets users ask questions about the video content. Answers are generated using OpenAI and displayed with markdown formatting in a clean chat UI.

---

## ✨ Features

- 📹 **Fetch Transcript** - Paste any YouTube URL and get its transcript
- 💬 **Ask Questions** - Ask any question about the video content
- 🤖 **AI Answers** - Get smart answers powered by OpenAI (GPT-4o-mini)
- ⚡ **Real-time Chat** - Chat history updates instantly
- 📝 **Markdown Support** - AI answers are formatted with headings, lists, and bold text
- 🔒 **Secure** - API keys stored safely, XSS protection enabled
- 📱 **Responsive** - Works on desktop and mobile
> **⚠️ Note:** This app works **only** with YouTube videos that have closed captions (CC) or subtitles enabled. If a video does not have a transcript available, the app cannot process it.
---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML, CSS, JavaScript |
| Backend | Firebase Cloud Functions (Node.js 20) |
| Database | Firebase Firestore |
| AI | OpenAI GPT-4o-mini |
| Transcript API | RapidAPI (youtube-transcript3) |
| Hosting | Firebase Hosting |
| Markdown | Marked.js + DOMPurify |

---

## 📁 Project Structure

```text
youtube-video-chat/
├── public/
│   └── index.html              # Frontend (HTML + CSS + JS)
├── functions/
│   ├── index.js                # Cloud Functions (backend)
│   ├── package.json            # Node.js dependencies
│   └── .env.local              # Local secrets (not in git)
├── firebase.json               # Firebase configuration
├── firestore.rules             # Database security rules
├── firestore.indexes.json      # Database indexes
├── .gitignore                  # Files to ignore in git
└── README.md                   # This file
```
---

## 🗄️ Database Structure

This app uses **Firebase Firestore** to store data.

### Collection: `videos`
Each video has its own document.
**Path:** `/videos/{videoId}`

| Field | Type | Description |
|-------|------|-------------|
| videoId | string | YouTube video ID |
| videoUrl | string | Full YouTube URL |
| transcript | string | Full transcript text |
| lang | string | Transcript language |
| updatedAt | timestamp | When it was last updated |

### Subcollection: `messages`
Each video has a subcollection of chat messages.
**Path:** `/videos/{videoId}/messages/{messageId}`

| Field | Type | Description |
|-------|------|-------------|
| question | string | User's question |
| answer | string | AI's answer |
| createdAt | timestamp | When message was created |

---

## ⚙️ How It Works

1. User pastes a YouTube URL
2. Backend fetches transcript from RapidAPI
3. Transcript is saved in Firestore
4. User asks a question
5. Backend finds relevant parts of transcript
6. Backend sends context + question to OpenAI
7. AI generates an answer
8. Answer is saved in Firestore and shown to user

---

## 🔧 Local Development Setup

### Prerequisites

- **Node.js 20** (recommended)
- **Firebase CLI** installed: `npm install -g firebase-tools`
- **Firebase account** with a project created

### Step 1: Clone the repository

`git clone https://github.com/YOUR_USERNAME/youtube-video-chat.git`
`cd youtube-video-chat`

### Step 2: Install dependencies

`cd functions`
`npm install`
`cd ..`

### Step 3: Create local environment file
Create a file called .env.local inside the functions folder:
functions/.env.local

Add your API keys:

`OPENAI_API_KEY=sk-your-openai-api-key-here`
`RAPIDAPI_KEY=your-rapidapi-key-here`

### Step 4: Start the emulators

`firebase emulators:start`

### Step 5: Open the app
Open your browser and go to: `http://127.0.0.1:5000`

## 🚀 Production Deployment

### Step 1: Set production secrets

Run these commands (you'll be asked to paste your keys):

`firebase functions:secrets:set OPENAI_API_KEY`
`firebase functions:secrets:set RAPIDAPI_KEY`

### Step 2: Deploy everything

`firebase deploy`

**Or deploy specific parts:**

#### Deploy only functions
`firebase deploy --only functions`

#### Deploy only hosting (frontend)
`firebase deploy --only hosting`

#### Deploy only database rules
`firebase deploy --only firestore:rules`

### Step 3: Open your live site

`https://yt-assignment-001.web.app`

## ⚠️ Important Configuration

Cloud Functions Region
This project deploys Cloud Functions to asia-south2 (Delhi, India).

**The frontend must use the same region:**

`const functions = getFunctions(app, "asia-south2");`

If you change the region in `functions/index.js`, update the frontend too.

## 🔒 Security

| Security Feature | Description |
|------------------|-------------|
| **Firestore Rules** | Frontend can only read, not write |
| **Secret Manager** | API keys stored securely (not in code) |
| **DOMPurify** | Prevents XSS attacks in AI responses |
| **Input Validation** | All user input is validated |
| **Error Handling** | Internal errors are hidden from users |

## 🐛 Troubleshooting
### Error: "You are not subscribed to this API"
**Cause:** RapidAPI subscription issue
**Fix:**
1. Go to RapidAPI → My Apps
2. Check that your app is subscribed to youtube-transcript3
3. Make sure you're using the API key from the subscribed app
   
### Error: CORS / "Failed to fetch"
**Cause:** Frontend calling wrong region
**Fix:** Make sure your frontend has: `const functions = getFunctions(app, "asia-south2");` then redeploy hosting.

### Error: "Transcript too short"
**Cause:** Video doesn't have captions enabled
**Fix:** Try a different video that has captions/subtitles

## 📝 Environment Variables
### For Local Development
File: `functions/.env.local`

Variable	Description
OPENAI_API_KEY	Your OpenAI API key
RAPIDAPI_KEY	Your RapidAPI key for transcript API

### For Production
Set using Firebase Secret Manager:
`firebase functions:secrets:set VARIABLE_NAME`

## 📜 License
**MIT License** - feel free to use this project for learning or your own projects.

## 👤 Author
### Garima Chouhan


