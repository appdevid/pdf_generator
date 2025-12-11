const express = require("express");
const bodyParser = require("body-parser");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// Route untuk generate PDF dari HTML string
app.post("/generate", async (req, res) => {
    const html = req.body.html;
    if (!html) return res.status(400).send("Missing HTML in body");

    const tmpHtml = path.join("/tmp", `input-${Date.now()}.html`);
    const tmpPdf = path.join("/tmp", `output-${Date.now()}.pdf`);

    fs.writeFileSync(tmpHtml, html);

    exec(`wkhtmltopdf ${tmpHtml} ${tmpPdf}`, (err) => {
        fs.unlinkSync(tmpHtml); // hapus HTML sementara
        if (err) return res.status(500).send(err.message);

        res.sendFile(tmpPdf, (err) => {
            fs.unlinkSync(tmpPdf); // hapus PDF setelah dikirim
        });
    });
});

// Route untuk generate PDF dari URL
app.get("/generate-url", (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("Missing url parameter");

    const tmpPdf = path.join("/tmp", `output-${Date.now()}.pdf`);
    exec(`wkhtmltopdf ${url} ${tmpPdf}`, (err) => {
        if (err) return res.status(500).send(err.message);

        res.sendFile(tmpPdf, (err) => {
            fs.unlinkSync(tmpPdf);
        });
    });
});

app.listen(3000, () => console.log("HTML → PDF API running on port 3000"));
