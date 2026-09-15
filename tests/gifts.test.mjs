import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase } from './database-fixture.mjs';

test('Gifts constraints and public read-only RLS', async () => {
  const db = await createDatabase();

  try {
    await db.query(
      `insert into gifts(name,slug,category,price,gift_type,display_order,active)
       values
        ('Presente de festa','presente-festa','party',50,'regular',5,true),
        ('Presente ativo','presente-ativo','house',100,'regular',20,true),
        ('Presente inativo','presente-inativo','travel',200,'regular',10,false),
        ('Moeda teste','moeda-teste','insanos',300,'insanos',30,true)`,
    );

    await assert.rejects(
      db.query("insert into gifts(name,slug,category,price,gift_type) values ('Inválido','preco-invalido','house',0,'regular')"),
    );
    await assert.rejects(
      db.query("insert into gifts(name,slug,category,price,gift_type) values ('Inválido','categoria-invalida','other',10,'regular')"),
    );
    await assert.rejects(
      db.query("insert into gifts(name,slug,category,price,gift_type) values ('Inválido','categoria-antiga','clothing',10,'regular')"),
    );
    await assert.rejects(
      db.query("insert into gifts(name,slug,category,price,gift_type) values ('Inválido','tipo-incompativel','insanos',10,'regular')"),
    );

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      const visible = await db.query('select slug from gifts order by display_order,id');
      assert.deepEqual(visible.rows.map((gift) => gift.slug), ['presente-festa', 'presente-ativo', 'moeda-teste']);
      await assert.rejects(db.query("insert into gifts(name,slug,category,price) values ('Novo','novo','house',10)"));
      await assert.rejects(db.query("update gifts set name='Alterado' where slug='presente-ativo'"));
      await assert.rejects(db.query("delete from gifts where slug='presente-ativo'"));
      await db.exec('reset role');
    }

    await db.exec('set role service_role');
    assert.equal((await db.query('select count(*)::int as count from gifts')).rows[0].count, 4);
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});

test('Development gift seed stays separate and preserves the approved catalog split', async () => {
  const db = await createDatabase();

  try {
    const seed = await readFile(new URL('../supabase/seeds/gifts-development.sql', import.meta.url), 'utf8');
    await db.exec(seed);
    const counts = await db.query(
      `select gift_type, count(*)::int as count
       from gifts
       group by gift_type
       order by gift_type`,
    );
    assert.deepEqual(counts.rows, [
      { gift_type: 'insanos', count: 3 },
      { gift_type: 'regular', count: 9 },
    ]);
  } finally {
    await db.close();
  }
});
