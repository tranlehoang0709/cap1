const { migratePaSoftDelete } = require('../src/database/migrations/20261120_pa_soft_delete.cjs');
const { migratePaCalendarCompat } = require('../src/database/migrations/20261120_pa_calendar_compat.cjs');

describe('PA migrations refuse incompatible schemas before any DDL', () => {
  it('validates both soft-delete definitions before adding a missing column', async () => {
    const connection = { execute:jest.fn()
      .mockResolvedValueOnce([[{name:'personal_tasks',engine:'InnoDB'},{name:'personal_plans',engine:'InnoDB'}]])
      .mockResolvedValueOnce([[{tableName:'personal_plans',type:'varchar(50)',nullable:'YES',defaultValue:null,extra:''}]]),
      query:jest.fn() };
    await expect(migratePaSoftDelete(connection,{apply:true})).rejects.toThrow('Incompatible existing personal_plans.deleted_at');
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('does not treat a missing table as permission to invent a replacement', async () => {
    const connection = {execute:jest.fn().mockResolvedValue([[]]),query:jest.fn()};
    await expect(migratePaSoftDelete(connection,{apply:true})).rejects.toThrow('Expected existing InnoDB table');
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('refuses legacy Calendar title/delivery_channel schemas without altering them', async () => {
    const connection = {execute:jest.fn()
      .mockResolvedValueOnce([['personal_events','personal_reminders','reminder_deliveries'].map(name=>({name,engine:'InnoDB'}))])
      .mockResolvedValueOnce([[{tableName:'personal_events',name:'start_at',type:'datetime'}]]),query:jest.fn()};
    await expect(migratePaCalendarCompat(connection,{apply:true})).rejects.toThrow('Canonical PA prerequisite mismatch');
    expect(connection.query).not.toHaveBeenCalled();
  });
});
