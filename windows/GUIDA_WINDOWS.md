# Manuale d'uso — Avviare FireTracker su Windows 11

Guida per far girare il progetto akatlon-2026 (FireTracker) come server locale su un PC Windows 11.

Il codice va modificato?

- `server.js` e tutti i file `.html/.css/.js`: **no**. Sono scritti in Node.js puro (nessuna dipendenza esterna), usano `path.join` per i percorsi e funzionano identici su Windows, macOS e Linux.
- `scripts/make-certs.sh`: **sì**, su Windows non va. In questa cartella trovi due alternative pronte:
  - `scripts/make-certs.sh` — versione **portabile**: funziona sia su Linux sia su Windows **Git Bash** (niente più percorso fisso autore, rileva gli IP con `ipconfig`).
  - `scripts/make-certs.ps1` — versione **PowerShell**: `powershell -ExecutionPolicy Bypass -File scripts\make-certs.ps1`
  Entrambe generano la CA + certificato HTTPS in `certs/` (stesso risultato dello script Linux).
- `config.json`: non richiede modifiche di codice, è solo un file di configurazione (vedi punto 4). In questa cartella trovi già `config.json` di default (`"password": "admin123"`).

## 1. Prerequisiti

- **Node.js 18 o superiore** — il server usa `fetch` nativo (per interrogare i servizi meteo), disponibile solo da Node 18 in poi. Scaricalo da nodejs.org (versione LTS) e installalo con le opzioni di default. Verifica in PowerShell:
  ```powershell
  node -v
  ```
  Deve restituire v18.x o superiore.

- **OpenSSL** — serve per generare il certificato HTTPS (il server non parte senza). Il modo più semplice è installare **Git for Windows** (git-scm.com), che include `openssl.exe` e aggiunge "Git Bash" al menu Start — comodo perché supporta anche i comandi in stile Linux usati sotto.

- Il codice del progetto scaricato/clonato in una cartella, es. `C:\FireTracker`.

## 2. Generare il certificato HTTPS

Dalla cartella del progetto, una delle due opzioni:

- **Git Bash** (consigliato):
  ```bash
  bash scripts/make-certs.sh
  ```
- **PowerShell**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\make-certs.ps1
  ```

Esegue: crea la cartella `certs/`, genera la CA (`ca-cert.pem`, da installare sui dispositivi se vuoi la posizione GPS dal telefono) e il certificato del server firmato con SAN per gli IP della rete e localhost.

## 3. Avviare il server

Da PowerShell, nella cartella del progetto:

```powershell
node server.js
```

Il server resta in esecuzione. Atteso in output:

```
Server su https://localhost:3443
Admin su https://localhost:3443/admin
IP LAN <interfaccia>: https://<IP>:3443
```

Il server ascolta **solo** sulla porta https **3443** (la porta http 3000 è disabilitata).

## 4. config.json

File di configurazione nella cartella del progetto (già incluso qui):

```json
{
  "password": "admin123"
}
```

La password serve per l'accesso alla pagina admin (`https://localhost:3443/admin`).

## 5. Uso dal telefono / altri dispositivi

1. Sul PC installa `certs/ca-cert.pem` come Certificato CA (Chrome: `chrome://settings/certificates` → Autorità → Importa).
2. Sulle pagine di Windows installa `certs\ca-cert.pem`:
   - **Android**: Impostazioni → Sicurezza → Crittografia e credenziali → Installa un certificato → Certificato CA.
   - **iPhone**: scarica il `.pem` → apri → Installa profilo → Impostazioni → Generali → Info → "Impostazioni di attestazione del certificato" → attiva affidamento completo.
3. Apri dal dispositivo `https://<IP-del-PC>:3443` (es. `https://192.168.1.13:3443`).
4. Senza l'installazione della CA puoi comunque aprire il sito con "Avanzate → Continua", ma la **geolocalizzazione 📍 non sarà attiva** (browser la blocca su certificati non fidati).

## 6. Consigli

- Firewall Windows: permetti l'accesso a `node.exe` su porte private, altrimenti il telefono non raggiunge il server.
- L'IP del PC può cambiare: in tal caso rigenera il certificato (punto 2) per aggiornare il SAN.