import 'reflect-metadata';
import { createConnection, Connection, Pool } from 'mysql2/promise';
import { CalendarRepository } from '../src/modules/calendar/calendar.repository';
import { PersonalAssistantRepository } from '../src/modules/personal-assistant/personal-assistant.repository';

const mysqlSuite = process.env.PA_SWEEP_TEST_DATABASE ? describe : describe.skip;
mysqlSuite('Calendar compatibility on canonical PA MySQL tables (rollback only)', () => {
  let conn: Connection;
  let calendar: CalendarRepository;
  let pa: PersonalAssistantRepository;
  let owner: string;
  const sql = async (q: string, v: any[] = []): Promise<any> => (await conn.execute(q, v))[0];
  beforeAll(async () => {
    const database = process.env.PA_SWEEP_TEST_DATABASE;
    if (!database || !/^aiva_pa_sweep_test_[a-z0-9_]+$/.test(database) ||
        !process.env.PA_TEST_HOST || !process.env.PA_TEST_USER) throw new Error('Explicit isolated test connection required');
    conn = await createConnection({host:process.env.PA_TEST_HOST,port:Number(process.env.PA_TEST_PORT||3306),
      user:process.env.PA_TEST_USER,password:process.env.PA_TEST_PASSWORD,database,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true});
    await conn.beginTransaction();
    const user = await sql(`INSERT INTO users (email,password_hash,display_name,status,created_at,updated_at)
      VALUES ('calendar-schema@example.invalid','fixture','Calendar','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())`);
    owner = String(user.insertId);
    const adapter = {
      execute:(q:string,v:any[])=>conn.execute(q,v),
      beginTransaction:()=>conn.query('SAVEPOINT calendar_test'),
      commit:()=>conn.query('RELEASE SAVEPOINT calendar_test'),
      rollback:()=>conn.query('ROLLBACK TO SAVEPOINT calendar_test'),release:()=>{},
    };
    const pool = {execute:adapter.execute,getConnection:async()=>adapter} as unknown as Pool;
    calendar = new CalendarRepository(pool);
    pa = new PersonalAssistantRepository(pool);
  });
  afterAll(async()=>{
    if(!conn)return;
    try {
      await conn.rollback();
      const rows=await sql("SELECT COUNT(*) total FROM users WHERE email='calendar-schema@example.invalid'");
      expect(Number(rows[0].total)).toBe(0);
    } finally { await conn.end(); }
  });

  it('round-trips RFC5545 strings through JSON, preserves updates and honors shared event soft deletion',async()=>{
    const start=new Date('2030-01-01T10:00:00Z'),end=new Date('2030-01-01T11:00:00Z');
    const id=await calendar.createEvent(owner,{title:'Calendar',starts_at:start,ends_at:end,
      timezone:'Asia/Bangkok',recurrence_rule:'FREQ=WEEKLY;BYDAY=MO'});
    expect(await calendar.findEvent(owner,id)).toMatchObject({title:'Calendar',timezone:'Asia/Bangkok',recurrence_rule:'FREQ=WEEKLY;BYDAY=MO'});
    expect(await calendar.overlaps(owner,start,end)).toBe(true);
    expect(await calendar.overlaps(owner,start,end,id)).toBe(false);
    await calendar.updateEvent(owner,id,{title:'Updated',starts_at:start,ends_at:end,recurrence_rule:'FREQ=DAILY'});
    expect(await calendar.findEvent(owner,id)).toMatchObject({title:'Updated',recurrence_rule:'FREQ=DAILY'});
    expect((await calendar.listEvents(owner,start,end)).map(row=>String(row.id))).toContain(id);
    await calendar.deleteEvent(owner,id);
    expect(await calendar.findEvent(owner,id)).toBeNull();
    expect(await calendar.overlaps(owner,start,end)).toBe(false);
    expect(await calendar.listEvents(owner,start,end)).toEqual([]);
    expect(await pa.findEventByIdRaw(id)).toBeNull();
    expect((await pa.listEvents(owner,{page:1,limit:10})).total).toBe(0);
    expect(await pa.findConflictingEventIds(owner,start,end)).toEqual([]);
    const row=await sql('SELECT title,deleted_at FROM personal_events WHERE id=?',[id]);
    expect(row[0].title).toBe('Updated');
    expect(row[0].deleted_at).not.toBeNull();
  });

  it('creates a Unicode reminder, rejects duplicates atomically, claims, retries and acknowledges using canonical columns',async()=>{
    const message='Nhắc việc 🗓️ '.repeat(25);
    const when=new Date('2000-01-01T00:00:00Z');
    const key=owner+':standalone:'+when.toISOString()+':'+message;
    const id=await calendar.createReminder(owner,{message,remind_at:when,timezone:'Asia/Bangkok'},key);
    expect(await calendar.findReminder(id)).toMatchObject({message,timezone:'Asia/Bangkok',status:'pending',attempt_count:0});
    await expect(calendar.createReminder(owner,{message,remind_at:when},key)).rejects.toMatchObject({code:'ER_DUP_ENTRY'});
    const totals=await sql('SELECT COUNT(*) total FROM personal_reminders WHERE user_id=?',[owner]);
    expect(Number(totals[0].total)).toBe(1);
    expect(await calendar.listReminders(owner,'pending')).toHaveLength(1);
    expect(await calendar.claimDue(20)).toHaveLength(1);
    expect(await calendar.claimDue(20)).toHaveLength(0);
    expect(await calendar.findReminder(id)).toMatchObject({status:'queued',attempt_count:1});
    await calendar.acknowledge(id,'failed','TEST_RETRY');
    expect(await calendar.findReminder(id)).toMatchObject({status:'failed',last_error:'TEST_RETRY'});
    expect(await calendar.claimDue(20)).toHaveLength(0);
    await sql('UPDATE reminder_deliveries SET next_retry_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 MINUTE) WHERE reminder_id=?',[id]);
    expect(await calendar.claimDue(20)).toHaveLength(1);
    await calendar.acknowledge(id,'delivered');
    expect(await calendar.findReminder(id)).toMatchObject({status:'acknowledged',attempt_count:2,last_error:null});
    expect(await calendar.claimDue(20)).toHaveLength(0);
    expect((await pa.findReminderByIdRaw(id))?.message).toBe(message);
  });
});
