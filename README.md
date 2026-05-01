# Payback Checker

Built with a gateway, AES-256-GCM end-to-end encryption, HWID binding, TLS fingerprinting, and automated captcha solving.

This repository includes **all components**:

* **Server** → Gateway
* **Client** → Checker
* **TLS Binary** → Forwarder[](https://workupload.com/file/PpukxLkr7xt)

---

## 🚀 Features

* Advanced TLS Fingerprinting using `Chrome 146`, with random TLS `Extension` order and set `Header Order` in `http 1`
* End-to-end encryption using AES-256-GCM
* Hardware ID (HWID) binding – one device per API key
* Automatic client updates
* Support for NextCaptcha & CapMonster
* Sticky & rotating proxy support with automatic session rotation
* High concurrency (up to 3000 threads)
* Real-time statistics + optional Discord webhook integration
* Clustered server architecture for maximum performance

---

## 📁 Project Structure

```
Checker/
├── server/                  # Gateway Server
│   ├── server.js
│   ├── crypto.js
│   ├── hwid.js
│   ├── keygen.js
│   ├── forwarder_client.0   # tls-client forwarder binary
│   ├── config.dist.yml
│   ├── package.json
│   ├── .env.example
│   └── files/
│       └── updatedChecker.mjs
├── client/                  # Checker Client
│   ├── index.js
│   ├── configloader.js
│   ├── tls.js
│   ├── crypto.js
│   ├── hwid.js
│   ├── updater.js
│   ├── helper.js
│   ├── captcha.js
│   ├── stats.js
│   ├── writer.js
│   ├── constants.js
│   ├── start.bat
│   ├── package.json
│   └── input.txt            # Email:Password combinations
├── README.md
└── .gitignore
```

---

## 🔧 Server Setup (Gateway + TLS Forwarder)

### ⚠️ Important

The gateway forwards **all TLS requests** to the `tls-client` forwarder.
The Node.js server (`server.js`) acts as a secure encrypted proxy.
All decrypted traffic is forwarded to the **tls-client forwarder** (`forwarder_client.0`), which must run on:

```
http://127.0.0.1:8080
```

---

### 1. Navigate to the server directory

```bash
cd server
npm install
```

---

### 2. Generate Encryption Key

```bash
node keygen.js
```

Copy the generated 64-character hex string.

---

### 3. Create `.env` file

```
ENCRYPTION_KEY=YOUR_64_CHARACTER_HEX_STRING
```

---

### 4. Add API Keys

Edit `server.js`:

```js
const VALID_API_KEYS = new Set([
  "YOUR_API_KEY_HERE",
]);
```

---

### 5. Start TLS Forwarder (`forwarder_client.0`)

The forwarder must run alongside the gateway.

#### Linux / macOS

```bash
chmod +x forwarder_client.0
./forwarder_client.0
```

#### Windows

```bash
forwarder_client.0
```

---

### 6. Start Gateway Server

```bash
node server.js
```

Gateway runs on:

```
http://localhost:3000
```

💡 **Production Tip:**
Use `pm2` or system services to run both:
`forwarder_client.0` + `server.js`

---

## 🔧 Client Setup (Checker)

### 1. Navigate to client directory

```bash
cd client
npm install
```

---

### 2. Required Configuration

#### a) Encryption Key (must match server)

Edit `helper.js`:

```js
const ENCRYPTION_KEY = "YOUR_64_CHARACTER_HEX_STRING";
```

---

#### b) Gateway Server URL

Edit in:

* `tls.js`
* `updater.js`

```js
const API_BASE = "http://YOUR_SERVER_IP:3000";
```

---

### 3. Configure `config.json5`

* Automatically created on first launch
* Customize settings as needed

---

### 4. Add Input & Start

Fill `input.txt`:

```
email:password
```

Run:

```bash
node index.js
```

Or on Windows:

```
start.bat
```

---

## 📤 Output

Results are stored in:

```
client/output/results_xx-xx_xx-xx-xx/
```

Files:

* `results.txt` → Successful accounts + data
* `faileds.txt` → Failed attempts
* `skips.txt` → Skipped entries
