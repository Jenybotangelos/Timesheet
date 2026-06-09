import { Router } from "express";
import { getPool } from "../db";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const router = Router();

const TENANT_ID = "b678434e-f26d-4d7f-947b-204156adc399";
const CLIENT_ID = "95623ecf-00bb-4289-a553-a64ae3a22ebb";

// JWKS client for verifying Microsoft tokens
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
});

function getKey(header: jwt.JwtHeader, callback: (err: Error | null, key?: string) => void) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

function verifyToken(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        audience: CLIENT_ID,
        issuer: [
          `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
          `https://sts.windows.net/${TENANT_ID}/`,
        ],
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      }
    );
  });
}

// POST /api/auth/login — Verify Microsoft token and auto-register
// Body: { email: "xxx@botangelos.com", idToken: "..." }
router.post("/login", async (req, res) => {
  try {
    const { email, idToken } = req.body;

    if (!email || !idToken) {
      return res.status(400).json({ error: "email and idToken are required" });
    }

    // Verify the Microsoft ID token
    let decoded: any;
    try {
      decoded = await verifyToken(idToken);
    } catch (err: any) {
      console.error("Token verification failed:", err.message || err);
      return res.status(401).json({ error: "Invalid token: " + (err.message || "verification failed") });
    }

    // Ensure the token email matches the claimed email
    const tokenEmail = (decoded.preferred_username || decoded.email || "").toLowerCase();
    if (tokenEmail !== email.toLowerCase()) {
      return res.status(403).json({ error: "Token email mismatch" });
    }

    // Validate it's a @botangelos.com email
    if (!email.toLowerCase().endsWith("@botangelos.com")) {
      return res.status(403).json({ error: "Only @botangelos.com emails are allowed" });
    }

    const pool = await getPool();

    // Check if employee already exists
    const existing = await pool.request()
      .input("email", email)
      .query("SELECT id, name, email FROM timesheet_employees WHERE email = @email");

    if (existing.recordset.length > 0) {
      // Already registered — return their info
      return res.json(existing.recordset[0]);
    }

    // Extract name from email: "Jeny.M.Jerry@botangelos.com" → "Jeny M Jerry"
    const localPart = email.split("@")[0]; // "Jeny.M.Jerry"
    const name = localPart.replace(/\./g, " "); // "Jeny M Jerry"

    // Insert new employee
    await pool.request()
      .input("name", name)
      .input("email", email)
      .query("INSERT INTO timesheet_employees (name, email) VALUES (@name, @email)");

    // Insert default blocks: 9:00-13:00 & 14:00-18:00 IST → 03:30-07:30 & 08:30-12:30 UTC
    await pool.request()
      .input("email", email)
      .input("from1", "03:30")
      .input("to1", "07:30")
      .input("from2", "08:30")
      .input("to2", "12:30")
      .query(
        `INSERT INTO timesheet_default_blocks (employee_email, from_time_utc, to_time_utc) VALUES 
         (@email, @from1, @to1), 
         (@email, @from2, @to2)`
      );

    // Return the new employee
    const newEmp = await pool.request()
      .input("email", email)
      .query("SELECT id, name, email FROM timesheet_employees WHERE email = @email");

    res.json(newEmp.recordset[0]);
  } catch (err) {
    console.error("Error in login:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

export default router;
