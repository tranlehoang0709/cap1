"use strict";

// Read-only production readiness audit. Never prints credential material.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const backendRoot = path.resolve(__dirname, "..", "..", "BE");
const dotenv = require(path.join(backendRoot, "node_modules", "dotenv"));
dotenv.config({
  path: path.join(backendRoot, ".env"),
});
const mysql = require(path.join(backendRoot, "node_modules", "mysql2", "promise"));

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    await connection.query("SET SESSION TRANSACTION READ ONLY");
    await connection.beginTransaction();
    const [version] = await connection.query("SELECT VERSION() version, DATABASE() db");
    const [tables] = await connection.query(
      "SELECT TABLE_NAME table_name FROM information_schema.tables " +
      "WHERE table_schema=DATABASE() ORDER BY TABLE_NAME",
    );
    const wanted = new Set([
      "users", "devices", "device_credentials", "device_assignments", "ai_profiles", "ai_providers",
      "ai_models", "api_credentials", "quota_policies", "usage_records",
      "ai_request_admissions",
    ]);
    const present = tables.map((row) => row.table_name).filter((name) => wanted.has(name));
    const counts = {};
    for (const table of present) {
      const [rows] = await connection.query(`SELECT COUNT(*) count FROM \`${table}\``);
      counts[table] = Number(rows[0].count);
    }
    const [deviceColumns] = await connection.query(
      "SELECT COLUMN_NAME name FROM information_schema.columns " +
      "WHERE table_schema=DATABASE() AND table_name='devices' ORDER BY ORDINAL_POSITION",
    );
    const names = new Set(deviceColumns.map((row) => row.name));
    const selected = ["id", "device_uid", "status", "owner_user_id", "credential_hash", "credential_revoked_at"]
      .filter((name) => names.has(name));
    let devices = [];
    if (selected.length) {
      const expressions = selected.map((name) => {
        if (name === "credential_hash") return "(credential_hash IS NOT NULL) credential_configured";
        return `\`${name}\``;
      });
      [devices] = await connection.query(`SELECT ${expressions.join(",")} FROM devices ORDER BY id`);
    }
    const [readiness] = await connection.query(`SELECT
      CAST(d.id AS CHAR) device_id,d.device_uid,d.lifecycle_status,d.connection_status,
      CAST(a.user_id AS CHAR) owner_user_id,
      (pr.status='approved') pairing_approved,
      (u.status='active' AND u.email_verified_at IS NOT NULL) owner_active_verified,
      (SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=a.user_id AND r.code='USER') user_role_count,
      (SELECT COUNT(*) FROM device_credentials dc WHERE dc.device_id=d.id
        AND dc.status='active' AND dc.revoked_at IS NULL
        AND (dc.expires_at IS NULL OR dc.expires_at>UTC_TIMESTAMP())) active_credentials,
      (SELECT COUNT(*) FROM device_unlink_operations x WHERE x.device_id=d.id
        AND (x.status<>'completed' OR x.revoked_at IS NULL OR x.completed_at IS NULL)) blocking_unlinks,
      (SELECT COUNT(*) FROM device_reset_jobs j WHERE j.device_id=d.id
        AND j.id=(SELECT MAX(j2.id) FROM device_reset_jobs j2 WHERE j2.device_id=d.id)
        AND (j.status<>'acknowledged' OR j.acknowledged_at IS NULL)) blocking_reset
      FROM devices d
      LEFT JOIN device_assignments a ON a.device_id=d.id
      LEFT JOIN device_pairing_requests pr ON pr.id=a.pairing_request_id
      LEFT JOIN users u ON u.id=a.user_id ORDER BY d.id`);
    const [providers] = await connection.query(
      "SELECT CAST(id AS CHAR) id,code,is_enabled FROM ai_providers ORDER BY id",
    );
    const [credentials] = await connection.query(`SELECT CAST(provider_id AS CHAR) provider_id,
      owner_scope,CAST(owner_user_id AS CHAR) owner_user_id,is_active,(revoked_at IS NULL) not_revoked,
      (secret_ciphertext IS NOT NULL AND secret_ciphertext<>'') encrypted_secret_present
      FROM api_credentials ORDER BY id`);
    const [profiles] = await connection.query(`SELECT CAST(user_id AS CHAR) user_id,
      CAST(preferred_provider_id AS CHAR) preferred_provider_id,
      CAST(preferred_llm_model_id AS CHAR) preferred_llm_model_id FROM ai_profiles ORDER BY user_id`);
    const [admin] = await connection.execute(`SELECT COUNT(*) count FROM users u
      JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
      WHERE u.email=? AND r.code='ADMIN'`,[process.env.ADMIN_EMAIL]);
    const aiEnvironment = dotenv.parse(fs.readFileSync(path.resolve(__dirname, "..", ".env")));
    let provisionedProofs = [];
    try {
      const local = JSON.parse(aiEnvironment.AI_SERVER_ROBOT_LOCAL_DEVICE_CREDENTIALS || "{}");
      for (const [uid, credential] of Object.entries(local)) {
        if (typeof credential !== "string") continue;
        const digest = crypto.createHash("sha256").update(credential, "utf8").digest("hex");
        const [matches] = await connection.execute(`SELECT COUNT(*) count FROM devices d
          JOIN device_credentials dc ON dc.device_id=d.id WHERE d.device_uid=?
          AND dc.credential_hash=? AND dc.status='active' AND dc.revoked_at IS NULL
          AND (dc.expires_at IS NULL OR dc.expires_at>UTC_TIMESTAMP())`,[uid,digest]);
        provisionedProofs.push({device_uid:uid,credential_format_valid:/^[A-Za-z0-9_-]{43,128}$/.test(credential),active_db_match:Number(matches[0].count)===1});
      }
    } catch { provisionedProofs = [{configuration_invalid:true}]; }
    console.log(JSON.stringify({
      mysql: { database: version[0].db, version: version[0].version },
      tables: present,
      counts,
      device_columns: [...names].filter((name) => !/hash|secret|token|credential/i.test(name)),
      devices,
      device_readiness: readiness,
      providers,
      ai_credentials: credentials,
      ai_profiles: profiles,
      configured_admin_exists: Number(admin[0].count) === 1,
      provisioned_proofs: provisionedProofs,
    }));
    await connection.rollback();
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`READ_ONLY_DB_CHECK_FAILED:${error.code || error.name}`);
  process.exitCode = 1;
});
