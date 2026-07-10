require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`MailCraft AI backend listening on http://localhost:${PORT}`);
});