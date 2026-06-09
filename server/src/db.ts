import dotenv from "dotenv";
import sql from "mssql";

// Load .env file
dotenv.config();

// Build config from environment variables
const dbConfig: sql.config = {
  server: process.env.DB_SERVER || "",
  database: process.env.DB_NAME || "",
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || "",
  port: parseInt(process.env.DB_PORT || "1433"),
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    pool = await sql.connect(dbConfig);
    console.log("Connected to Azure SQL");
  }
  return pool;
}
