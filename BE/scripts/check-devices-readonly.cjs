// Run from BE after npm.cmd run build. No schema changes, fixtures or writes.
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const { parse } = require('dotenv');
const { DevicesRepository } = require('../dist/modules/devices/devices.repository');
const { DeviceQueryDto } = require('../dist/modules/devices/dto/device-query.dto');

async function main() {
  const env = { ...parse(fs.readFileSync('.env')), ...process.env };
  const pool = mysql.createPool({host:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USER,
    password:env.DB_PASSWORD,database:env.DB_NAME,supportBigNumbers:true,bigNumberStrings:true,
    timezone:'Z',connectionLimit:2,connectTimeout:5000});
  try {
    for (const table of ['devices','device_assignments','users','roles','user_roles','auth_sessions',
      'device_credentials','device_pairing_codes','device_pairing_requests','device_telemetry','ai_providers']) {
      const [columns] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
      const [indexes] = await pool.query(`SHOW INDEX FROM \`${table}\``);
      console.log(table, JSON.stringify({columns:columns.map(c=>({name:c.Field,type:c.Type,nullable:c.Null})),
        indexes:indexes.map(i=>({name:i.Key_name,column:i.Column_name,unique:!i.Non_unique}))}));
    }
    const repository = new DevicesRepository(pool);
    for (const input of [{}, {page:'2',limit:'1'}, {search:'__readonly_probe__',connectionStatus:'offline'}]) {
      const result = await repository.list(DeviceQueryDto.parse(input));
      assert.equal(new Set(result.items.map(d=>d.id)).size, result.items.length);
      for (const device of result.items) {
        assert.equal((await repository.findById(device.id)).id,device.id);
        assert.doesNotMatch(JSON.stringify(device),/credential_hash|password_hash|secret_ciphertext/);
      }
      console.log('Read-only list passed:', JSON.stringify({input,pagination:result.pagination}));
    }
    assert.equal(await repository.findById('9223372036854775807'),null);
    const [plan] = await pool.execute(`EXPLAIN SELECT d.id FROM devices d
      LEFT JOIN device_assignments a ON a.device_id=d.id LEFT JOIN users u ON u.id=a.user_id
      ORDER BY d.id LIMIT 20`);
    console.log('Query plan:', JSON.stringify(plan));
    console.log('PASS: live read-only smoke; populated cases depend on existing rows.');
  } finally { await pool.end(); }
}
main().catch(error => { console.error('Read-only check failed:',error.code || error.name); process.exitCode=1; });
