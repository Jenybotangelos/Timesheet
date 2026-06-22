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

// GET /api/cron/check-submissions
// Called by Vercel Cron daily at 10 AM IST
router.get("/check-submissions", async (req, res) => {
  try {
    // Verify cron secret (Vercel sends this header)
    const authHeader = req.headers["authorization"];
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

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

    if (nonSubmitters.length === 0) {
      return res.json({ message: "All employees submitted yesterday's tasks", date: yesterdayStr });
    }

    // Get Kokul's email from DB
    const kokuResult = await pool.request().query(
      "SELECT email FROM timesheet_employees WHERE LOWER(name) LIKE '%kokul%'"
    );
    const kokulEmail = kokuResult.recordset.length > 0
      ? kokuResult.recordset[0].email
      : null;

    // Get access token for Graph API
    const accessToken = await getGraphToken();

    // Send individual reminder to each non-submitter
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

    // Send summary to Kokul
    if (kokulEmail) {
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
    }

    res.json({
      message: "Reminder emails sent",
      date: yesterdayStr,
      nonSubmitters: nonSubmitters.map((e: any) => e.email),
      notifiedKokul: !!kokulEmail,
    });
  } catch (err: any) {
    console.error("Cron check-submissions error:", err);
    res.status(500).json({ error: err.message || "Failed to run cron job" });
  }
});

export default router;
