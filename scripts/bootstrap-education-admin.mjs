import { createRequire } from 'node:module';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const email=process.env.EDUCATION_BOOTSTRAP_EMAIL?.trim().toLowerCase();
if(!email||!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL and EDUCATION_BOOTSTRAP_EMAIL locally. No password is required or printed.');
const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
try{await client.query('BEGIN');await client.query("select pg_advisory_xact_lock(hashtext('education-bootstrap'))");
 if((await client.query("SELECT 1 FROM users WHERE role='SUPERADMIN' AND NOT is_deleted")).rowCount)throw new Error('A Super Admin already exists. Use the existing administrator.');
 const r=await client.query('SELECT id FROM users WHERE email=$1 AND NOT is_deleted AND NOT suspended FOR UPDATE',[email]);if(!r.rowCount)throw new Error('Register and verify ownership of the intended account first.');
 await client.query("UPDATE users SET role='SUPERADMIN',updated_at=now() WHERE id=$1",[r.rows[0].id]);await client.query("INSERT INTO audit_logs(id,user_id,action,summary,details) VALUES(gen_random_uuid()::text,$1,'education.admin.bootstrap','تهيئة أول مدير نظام','{}')",[r.rows[0].id]);await client.query('COMMIT');console.log('First administrator initialized. Existing authentication credentials remain valid.');
}catch(e){await client.query('ROLLBACK');console.error(e.message);process.exitCode=1;}finally{await client.end();}
