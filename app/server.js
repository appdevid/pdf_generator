// server.js
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require("express");
const bodyParser = require("body-parser");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(bodyParser.json({ limit: "20mb" }));

console.log("process.env.BASIC_AUTH_USER");
console.log(process.env.BASIC_AUTH_USER);


// ----- Configuration via environment variables -----
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3020;
const BASIC_USER = process.env.BASIC_AUTH_USER || "admin";
const BASIC_PASS = process.env.BASIC_AUTH_PASS || "password";
// ALLOWED_IPS can be "*" or comma separated list of exact IPs or prefixes (e.g. "10.0.,192.168.1.,1.2.3.4")
const ALLOWED_IPS = (process.env.ALLOWED_IPS || "*").split(",").map(s => s.trim()).filter(Boolean);

// ----- Helpers -----
function getClientIp(req) {
    // Try X-Forwarded-For first (may contain comma list)
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        // take first IP in list
        const first = xff.split(",")[0].trim();
        return normalizeIp(first);
    }
    // fallback to connection remote address
    const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
    return normalizeIp(remote);
}

function normalizeIp(ip) {
    if (!ip) return "";
    // strip IPv6 mapped IPv4 prefix if present
    if (ip.startsWith("::ffff:")) return ip.substring(7);
    // strip IPv6 zone id if present
    const percent = ip.indexOf("%");
    if (percent !== -1) ip = ip.substring(0, percent);
    return ip;
}

function ipAllowed(ip) {
    if (!ALLOWED_IPS || ALLOWED_IPS.length === 0) return false;
    if (ALLOWED_IPS.length === 1 && ALLOWED_IPS[0] === "*") return true;
    for (const rule of ALLOWED_IPS) {
        if (rule === "*") return true;
        // exact match
        if (rule === ip) return true;
        // allow prefix match (simple subnet style), e.g. "192.168.1." allows "192.168.1.5"
        if (rule.endsWith(".") && ip.startsWith(rule)) return true;
    }
    return false;
}

// Basic auth middleware
function basicAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.set('WWW-Authenticate', 'Basic realm="Restricted"');
        return res.status(401).send('Authentication required');
    }
    const base64Credentials = auth.split(' ')[1] || '';
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [user, pass] = credentials.split(':');
    if (user === BASIC_USER && pass === BASIC_PASS) return next();
    res.set('WWW-Authenticate', 'Basic realm="Restricted"');
    return res.status(401).send('Invalid credentials');
}

// IP allowlist middleware
function ipAllowlist(req, res, next) {
    const clientIp = getClientIp(req);
    if (!ipAllowed(clientIp)) {
        console.warn(`Blocked request from IP: ${clientIp} path:${req.path}`);
        return res.status(403).send('Forbidden');
    }
    return next();
}

// Apply security middlewares to all routes
app.use((req, res, next) => {
    // log brief info
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} from ${getClientIp(req)}`);
    next();
});
app.use(ipAllowlist);
app.use(basicAuth);

// ----- Routes -----
// POST /generate  => accept JSON { html: "<...>" }
app.post("/generate", async (req, res) => {
    const html = req.body.html;
    if (!html) return res.status(400).send("Missing HTML in body");

    const tmpHtml = path.join("/tmp", `input-${Date.now()}.html`);
    const tmpPdf = path.join("/tmp", `output-${Date.now()}.pdf`);

    try {
        fs.writeFileSync(tmpHtml, html);

        exec(`wkhtmltopdf ${tmpHtml} ${tmpPdf}`, (err, stdout, stderr) => {
            try { fs.unlinkSync(tmpHtml); } catch (e) { }
            if (err) {
                console.error("wkhtmltopdf error:", err, stderr);
                return res.status(500).send("PDF generation failed: " + (stderr || err.message));
            }

            res.sendFile(tmpPdf, (err) => {
                try { fs.unlinkSync(tmpPdf); } catch (e) { }
                if (err) console.error("sendFile error:", err);
            });
        });
    } catch (e) {
        console.error(e);
        return res.status(500).send("Internal error");
    }
});

// GET /generate-url?url=...
app.get("/generate-url", (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("Missing url parameter");

    const tmpPdf = path.join("/tmp", `output-${Date.now()}.pdf`);
    exec(`wkhtmltopdf ${url} ${tmpPdf}`, (err, stdout, stderr) => {
        if (err) {
            console.error("wkhtmltopdf error:", err, stderr);
            return res.status(500).send("PDF generation failed: " + (stderr || err.message));
        }

        res.sendFile(tmpPdf, (err) => {
            try { fs.unlinkSync(tmpPdf); } catch (e) { }
            if (err) console.error("sendFile error:", err);
        });
    });
});

// health
app.get("/health", (req, res) => res.json({ ok: true, port: PORT }));

app.listen(PORT, () => console.log(`HTML → PDF API running on port ${PORT}`));
