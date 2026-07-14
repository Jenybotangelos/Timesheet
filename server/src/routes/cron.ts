import { Router } from "express";
import { getPool } from "../db";

const router = Router();

const MAIL_FROM = "Jeny.M.Jerry@botangelos.com";

// Get access token using client credentials flow
async function getGraphToken(): Promise<string> {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET must be set");
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to get token: ${err}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

// Send email via Microsoft Graph API
async function sendMail(
  accessToken: string,
  to: string[],
  subject: string,
  htmlBody: string
) {
  const url = `https://graph.microsoft.com/v1.0/users/${MAIL_FROM}/sendMail`;

  const message = {
    message: {
      subject,
      body: {
        contentType: "HTML",
        content: htmlBody,
      },
      toRecipients: to.map((email) => ({
        emailAddress: { address: email },
      })),
    },
    saveToSentItems: true,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to send mail: ${response.status} ${err}`);
  }
}

// --- Teams Chat via Delegated Permissions (Refresh Token) ---

const TEAMS_SCOPES = "ChatMessage.Send Chat.ReadWrite offline_access";

// Get delegated access token using stored refresh token
async function getDelegatedToken(): Promise<string | null> {
  const pool = await getPool();
  const result = await pool.request()
    .input("key", "teams_refresh_token")
    .query("SELECT token_value FROM timesheet_tokens WHERE token_key = @key");

  if (result.recordset.length === 0) return null;

  const refreshToken = result.recordset[0].token_value;
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId!,
    client_secret: clientSecret!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: TEAMS_SCOPES,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Failed to refresh delegated token:", err);
    return null;
  }

  const data = await response.json() as { access_token: string; refresh_token?: string };

  // Store the new refresh token (keeps the 90-day window rolling)
  if (data.refresh_token) {
    await pool.request()
      .input("key", "teams_refresh_token")
      .input("value", data.refresh_token)
      .query(`
        MERGE timesheet_tokens AS target
        USING (SELECT @key AS token_key) AS source ON target.token_key = source.token_key
        WHEN MATCHED THEN UPDATE SET token_value = @value, updated_at = GETDATE()
        WHEN NOT MATCHED THEN INSERT (token_key, token_value) VALUES (@key, @value);
      `);
  }

  return data.access_token;
}

// Send 1:1 Teams chat message using delegated token
async function sendTeamsChat(delegatedToken: string, appToken: string, recipientEmail: string, messageHtml: string) {
  // Get recipient user ID using app token (has User.Read.All)
  const userRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(recipientEmail)}?$select=id`,
    { headers: { Authorization: `Bearer ${appToken}` } }
  );
  if (!userRes.ok) throw new Error(`Could not find user: ${recipientEmail}`);
  const userData = await userRes.json() as { id: string };

  // Get sender user ID using delegated token (/me)
  const senderRes = await fetch(
    `https://graph.microsoft.com/v1.0/me?$select=id`,
    { headers: { Authorization: `Bearer ${delegatedToken}` } }
  );
  if (!senderRes.ok) throw new Error("Could not get sender info");
  const senderData = await senderRes.json() as { id: string };

  // Skip if sender and recipient are the same person
  if (senderData.id === userData.id) {
    return;
  }

  // Create 1:1 chat using delegated token
  const chatRes = await fetch("https://graph.microsoft.com/v1.0/chats", {
    method: "POST",
    headers: { Authorization: `Bearer ${delegatedToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      chatType: "oneOnOne",
      members: [
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: ["owner"],
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${senderData.id}')`,
        },
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: ["owner"],
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${userData.id}')`,
        },
      ],
    }),
  });

  if (!chatRes.ok) {
    const err = await chatRes.text();
    throw new Error(`Failed to create chat: ${chatRes.status} ${err}`);
  }

  const chatData = await chatRes.json() as { id: string };

  // Send message
  const msgRes = await fetch(`https://graph.microsoft.com/v1.0/chats/${chatData.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${delegatedToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: { contentType: "html", content: messageHtml } }),
  });

  if (!msgRes.ok) {
    const err = await msgRes.text();
    throw new Error(`Failed to send message to ${recipientEmail}: ${msgRes.status} ${err}`);
  }
}

// --- One-time setup: OAuth login to get initial refresh token ---

// Step 1: GET /api/cron/teams-setup — redirects to Microsoft login
router.get("/teams-setup", (req, res) => {
  const clientId = process.env.AZURE_CLIENT_ID;
  const tenantId = process.env.AZURE_TENANT_ID;
  const redirectUri = `${req.protocol}://${req.get("host")}/api/cron/teams-callback`;

  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
    `client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(TEAMS_SCOPES)}&response_mode=query`;

  res.redirect(authUrl);
});

// Step 2: GET /api/cron/teams-callback — exchanges code for tokens, stores refresh token
router.get("/teams-callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) return res.status(400).send("No code received");

    const clientId = process.env.AZURE_CLIENT_ID!;
    const clientSecret = process.env.AZURE_CLIENT_SECRET!;
    const tenantId = process.env.AZURE_TENANT_ID!;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/cron/teams-callback`;

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: TEAMS_SCOPES,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).send(`Token exchange failed: ${err}`);
    }

    const data = await response.json() as { access_token: string; refresh_token: string };

    // Store refresh token in DB
    const pool = await getPool();
    await pool.request()
      .input("key", "teams_refresh_token")
      .input("value", data.refresh_token)
      .query(`
        MERGE timesheet_tokens AS target
        USING (SELECT @key AS token_key) AS source ON target.token_key = source.token_key
        WHEN MATCHED THEN UPDATE SET token_value = @value, updated_at = GETDATE()
        WHEN NOT MATCHED THEN INSERT (token_key, token_value) VALUES (@key, @value);
      `);

    res.send("✅ Teams setup complete! Refresh token saved. You can close this page. The cron jobs will now send Teams chat messages automatically.");
  } catch (err: any) {
    console.error("Teams callback error:", err);
    res.status(500).send("Setup failed: " + err.message);
  }
});

// Helper: get yesterday's date and non-submitters
async function getNonSubmitters() {
  const pool = await getPool();

  // Get yesterday's date in YYYY-MM-DD format (IST = UTC+5:30)
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const yesterday = new Date(istNow.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  // Get all employees (exclude Kokul)
  const employees = await pool.request().query(
    "SELECT name, email FROM timesheet_employees WHERE LOWER(name) NOT LIKE '%kokul%'"
  );

  // Get employees who submitted yesterday
  const submitted = await pool.request()
    .input("date", yesterdayStr)
    .query(
      `SELECT DISTINCT employee_email 
       FROM timesheet_task_entries 
       WHERE task_date = @date AND status = 'submitted'`
    );

  const submittedEmails = new Set(
    submitted.recordset.map((r: any) => r.employee_email.toLowerCase())
  );

  // Find non-submitters
  const nonSubmitters = employees.recordset.filter(
    (emp: any) => !submittedEmails.has(emp.email.toLowerCase())
  );

  return { pool, yesterdayStr, nonSubmitters };
}

// GET /api/cron/remind-employees
// Called by Vercel Cron daily at 9 AM IST (3:30 UTC)
// Sends reminder emails to non-submitters + posts to Teams channel
router.get("/remind-employees", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { yesterdayStr, nonSubmitters } = await getNonSubmitters();

    if (nonSubmitters.length === 0) {
      return res.json({ message: "All employees submitted yesterday's tasks", date: yesterdayStr });
    }

    // Get access token for Graph API
    const accessToken = await getGraphToken();

    // Send individual reminder email to each non-submitter
    for (const emp of nonSubmitters) {
      const subject = `Reminder: Task not submitted for ${yesterdayStr}`;
      const html = `
        <p>Hi ${emp.name},</p>
        <p>This is a reminder that you have <strong>not submitted</strong> your task sheet for <strong>${yesterdayStr}</strong>.</p>
        <p>Please submit your tasks as soon as possible.</p>
        <br/>
        <p>— Tasksheet System</p>
      `;
      await sendMail(accessToken, [emp.email], subject, html);
    }

    // Send Teams 1:1 chat to each non-submitter
    const teamsChatResults: string[] = [];
    const delegatedToken = await getDelegatedToken();
    if (delegatedToken) {
      for (const emp of nonSubmitters) {
        try {
          const chatHtml = `<p>Hi <b>${emp.name}</b>,</p><p>⚠️ You have <b>not submitted</b> your task sheet for <b>${yesterdayStr}</b>.</p><p>Please submit your tasks as soon as possible.</p>`;
          await sendTeamsChat(delegatedToken, accessToken, emp.email, chatHtml);
          teamsChatResults.push(emp.email);
        } catch (chatErr: any) {
          console.error(`Teams chat failed for ${emp.email}:`, chatErr.message);
        }
      }
    } else {
      console.error("No delegated token available — run /api/cron/teams-setup first");
    }

    res.json({
      message: "Employee reminder emails + Teams chats sent",
      date: yesterdayStr,
      nonSubmitters: nonSubmitters.map((e: any) => e.email),
      teamsChatsSent: teamsChatResults,
    });
  } catch (err: any) {
    console.error("Cron remind-employees error:", err);
    res.status(500).json({ error: err.message || "Failed to run cron job" });
  }
});

// GET /api/cron/notify-kokul
// Called by Vercel Cron daily at 10 AM IST (4:30 UTC)
// Sends summary email to Kokul
router.get("/notify-kokul", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { pool, yesterdayStr, nonSubmitters } = await getNonSubmitters();

    if (nonSubmitters.length === 0) {
      return res.json({ message: "All employees submitted — no report needed", date: yesterdayStr });
    }

    // Get Kokul's email from DB
    const kokuResult = await pool.request().query(
      "SELECT email FROM timesheet_employees WHERE LOWER(name) LIKE '%kokul%'"
    );
    const kokulEmail = kokuResult.recordset.length > 0
      ? kokuResult.recordset[0].email
      : null;

    if (!kokulEmail) {
      return res.json({ message: "Kokul email not found in DB", date: yesterdayStr });
    }

    // Get access token for Graph API
    const accessToken = await getGraphToken();

    // Send summary email to Kokul
    const nonSubmitterNames = nonSubmitters.map((e: any) => e.name);
    const subject = `Task Submission Report - ${yesterdayStr}`;
    const html = `
      <p>Hi Kokul,</p>
      <p>The following employees have <strong>not submitted</strong> their tasks for <strong>${yesterdayStr}</strong>:</p>
      <ul>
        ${nonSubmitterNames.map((n: string) => `<li>${n}</li>`).join("")}
      </ul>
      <p>Total: ${nonSubmitters.length} employee(s) pending.</p>
      <br/>
      <p>— Tasksheet System</p>
    `;
    await sendMail(accessToken, [kokulEmail], subject, html);

    // Also send Teams chat to Kokul
    try {
      const delegatedToken = await getDelegatedToken();
      if (delegatedToken) {
        const chatHtml = `<p>Hi <b>Kokul</b>,</p><p>📋 <b>Task Submission Report - ${yesterdayStr}</b></p><p>Not submitted:</p><ul>${nonSubmitterNames.map((n: string) => `<li>${n}</li>`).join("")}</ul><p><b>Total: ${nonSubmitters.length} pending.</b></p>`;
        await sendTeamsChat(delegatedToken, accessToken, kokulEmail, chatHtml);
      }
    } catch (teamsErr: any) {
      console.error("Teams chat to Kokul failed:", teamsErr.message);
    }

    res.json({
      message: "Kokul summary email + Teams chat sent",
      date: yesterdayStr,
      nonSubmitters: nonSubmitters.map((e: any) => e.email),
    });
  } catch (err: any) {
    console.error("Cron notify-kokul error:", err);
    res.status(500).json({ error: err.message || "Failed to run cron job" });
  }
});

// Keep old endpoint for backward compatibility
router.get("/check-submissions", async (req, res) => {
  res.redirect("/api/cron/remind-employees");
});

export default router;
